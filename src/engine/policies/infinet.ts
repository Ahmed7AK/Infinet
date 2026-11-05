/**
 * Infinet = coverage-map prediction (Feature 1) + trust gate (Feature 2) + always-on tunnel
 *         + deadline-aware selective duplication + RTT-aware liveness + LEO pattern learner.
 * Reads only Observations + its own belief map + its own probe results (never truth; plan P5/P6).
 * Security spec v1.0: verdicts route, encryption never stops. Every frame goes through the tunnel on every
 * network; Trusted is the primary path, Tunnel only a backup, Unreachable and Blocked never. Duplication (D3)
 * is one tunnel per path, each with its own handshake, and the receiver drops copies by sequence number.
 * Anchor down: fail closed (D2). Nothing goes outside the tunnel; the phone says so and holds messages.
 */
import { v } from '../params';
import type { Flag, HandshakeResult, LinkType, PolicyId, ScanEntry, Tier, TrustView, Vec2 } from '../types';
import { Agent, isWifiPath, netOf, NET_LABEL, probeTimeoutS, type Ctx } from './agent';

const netOfKind = (pathId: string): LinkType => (pathId.startsWith('cell:') ? '5g' : pathId === 'wifi:site-net' ? 'sat' : 'wifi');
import { Predictor, type TtlResult } from '../predict/predict';
import { LeoLearner } from '../predict/leoPattern';
import { decideTier, isEnrolled, redFlags, screen, SEC_LABEL, SEC_RANK, verdictText } from '../trust/trust';
import { rttOf, sampleProbeRtt } from '../links/paths';
import { LAYOUT } from '../world/layout';

interface Rto { srtt?: number; rttvar?: number; rto: number; timeouts: number; nextAt: number; pending?: { due: number; rtt: number }; slot: number; dead: boolean; samples: number[] }

export interface InfinetOpts { predict: boolean; trust: boolean }

const VERDICT_EVENT: Partial<Record<Tier, 'trust.blocked' | 'trust.tunnel' | 'trust.trusted' | 'trust.unreachable'>> = {
  blocked: 'trust.blocked', tunnel: 'trust.tunnel', trusted: 'trust.trusted', unreachable: 'trust.unreachable',
};

export class Infinet extends Agent {
  readonly opts: InfinetOpts;
  trust = new Map<string, TrustView>();    // key: bssid | path id for cellular
  predictor = new Predictor();
  leo = new LeoLearner();
  last: TtlResult = { confidence: 0, forecast: [], vel: [0, 0] };
  candidate: string | null = null;
  candidateState: 'idle' | 'checking' | 'ready' = 'idle';
  private candReadyAt = 0;
  private candStartT = 0;
  private headsUpFor: string | null = null;
  private rto = new Map<string, Rto>();
  checkTarget: string | null = null;
  private goodWifiSince: number | null = null;
  private switchedAt = -100;
  /** prediction bookkeeping for the batch metric (lead time and error vs truth) */
  predLog: Array<{ switchT: number; predictedCrossT?: number; net: string }> = [];
  pattern?: { periodS: number; confidence: number };
  /** environment: beacon-flood alert (spec §6) and the anchor (spec §5) */
  flood = false;
  anchorLost = false;
  private liveProbeAt = new Map<string, number>();
  /** live hotspots this phone has checked: learned BSSID set and security per raw name (its own memory) */
  private learned = new Map<string, { bssids: Set<string>; security: import('../types').Security; name: string }>();
  // spec §2 metrics (the batch harness reads these; the phone never does)
  fakeAccepted = new Set<string>();
  realUnreachable = new Set<string>();
  verdictLog: Array<{ linkType: LinkType; ms: number; tier: Tier }> = [];
  protected osPortalCheck = false;

  constructor(seed: number, id: PolicyId = 'infinet', opts: InfinetOpts = { predict: true, trust: true }) {
    super(id, seed, true);
    this.opts = opts;
  }

  /** a check join runs the probe and the canaries in parallel: the slowest canary (TLS) takes 2 round trips */
  protected checkRtts(purpose: 'use' | 'check') { return purpose === 'check' ? v('canaryRtts') : 1; }

  // ───────────── initial trust state for a scenario ─────────────
  preTrust(ctx: Ctx, keys: string[]) {
    for (const k of keys) {
      if (k.startsWith('cell:')) this.trust.set(k, this.cellTrust(ctx, k, 'trusted'));
      else for (const tx of LAYOUT.transmitters.filter((x) => x.kind === 'wifi' && x.net === k && !x.attacker)) {
        this.trust.set(tx.bssid!, this.enrolledView(tx.bssid!, tx.ssid!, tx.net, ctx.t));
      }
    }
  }

  private enrolledView(bssid: string, ssid: string, net: string, t: number): TrustView {
    const tv: TrustView = {
      bssid, ssid, net, tier: 'trusted', flags: [], handshake: 'pass', authFailed: 0, canaries: { tls: 'ok', dns: 'ok', portal: 'ok' },
      linkType: net === 'site-net' ? 'sat' : 'wifi', firstSeenT: t, decidedT: t, stage: 'verdict', reason: '', mayCarry: '', steps: [],
    };
    tv.steps = this.stepsFor(tv, t);
    Object.assign(tv, verdictText(tv));
    return tv;
  }

  private cellTrust(ctx: Ctx, key: string, tier: 'checking' | 'trusted'): TrustView {
    const net = netOf(key);
    const tv: TrustView = {
      bssid: key, ssid: NET_LABEL[net] ?? net, net, tier, flags: [], handshake: tier === 'trusted' ? 'pass' : 'pending', authFailed: 0, linkType: '5g',
      firstSeenT: ctx.t, decidedT: tier === 'trusted' ? ctx.t : undefined, stage: tier === 'trusted' ? 'verdict' : 'quarantine',
      reason: '', mayCarry: '', steps: [],
    };
    this.refresh(tv, ctx.t);
    if (tier === 'trusted') tv.reason = `${NET_LABEL[net]} (SIM-authenticated), as expected. Handshake passed.`;
    return tv;
  }

  /** the hologram's checklist: the passive screen, then the quarantine probe and its canaries */
  private stepsFor(tv: TrustView, t: number): TrustView['steps'] {
    const out: TrustView['steps'] = [];
    const hs = tv.handshake;
    if (tv.linkType === '5g') {
      out.push({ text: 'SIM-authenticated (5G AKA, mutual)', ok: true, t });
      out.push({ text: hs === 'pass' ? 'Probe handshake with the anchor: passed' : hs === 'timeout' ? 'Probe: no answer yet · retrying' : 'Probe handshake with the anchor (1 round trip)', ok: hs === 'pass' ? true : null, t });
      return out;
    }
    if (!tv.flags.length) out.push({ text: 'Screen: no red flags', ok: true, t });
    for (const f of tv.flags) out.push({ text: `${f.text} · ${f.weight}`, ok: false, t });
    if (tv.tier === 'blocked' && (hs === undefined || hs === 'pending')) {
      out.push({ text: 'Blocked on its red flags · nothing sent to it', ok: false, t });
      return out;
    }
    const sim = tv.live ? ' (simulated)' : '';
    const probe =
      hs === 'pass' ? { text: `Probe handshake passed${sim}`, ok: true as boolean | null }
      : hs === 'authfail' ? { text: `${tv.authFailed ?? 1} probe packet failed authentication`, ok: false }
      : hs === 'timeout' ? { text: `No answer within ${probeTimeoutS(tv.linkType).toFixed(1)} s · retry later`, ok: null }
      : hs === 'portal' ? { text: 'Sign-in page: sandboxed sign-in only', ok: null }
      : { text: 'Probe with its own key · the call stays put', ok: null };
    out.push({ ...probe, t });
    const c = tv.canaries;
    if (c && c.tls !== 'skip') out.push({ text: c.tls === 'ok' ? 'TLS canary: certificate as pinned' : c.tls === 'bad' ? 'TLS canary: certificate mismatch' : 'TLS canary', ok: c.tls === 'wait' ? null : c.tls === 'ok', t });
    if (c && c.dns !== 'skip') out.push({ text: c.dns === 'ok' ? 'DNS canary: answers match' : c.dns === 'bad' ? 'DNS canary: answers differ' : 'DNS canary', ok: c.dns === 'wait' ? null : c.dns === 'ok', t });
    return out;
  }

  private refresh(tv: TrustView, t: number) {
    tv.steps = this.stepsFor(tv, t);
    const staying = this.route ? (NET_LABEL[netOf(this.route)] ?? '5G') : '5G';
    Object.assign(tv, verdictText(tv, staying));
  }

  /** one verdict reached: tell the phone (event), keep the spec §2 metrics */
  private report(ctx: Ctx, tv: TrustView) {
    const type = VERDICT_EVENT[tv.tier];
    if (!type || tv.decidedT === undefined) return;
    const ms = Math.max(v('radioTickS') * 1000, (tv.decidedT - tv.firstSeenT) * 1000);
    ctx.emit({ t: ctx.t, type, bssid: tv.bssid, ssid: tv.ssid, flags: tv.flags, reason: tv.reason, handshake: tv.handshake, verdictMs: Math.round(ms) });
    this.verdictLog.push({ linkType: tv.linkType, ms, tier: tv.tier });
    const fake = tv.net === 'twin';
    if (tv.tier === 'blocked' && !fake && !tv.live) this.wronglyBlocked++;
    if (tv.tier === 'unreachable' && !fake) this.realUnreachable.add(tv.bssid);
    if ((tv.tier === 'tunnel' || tv.tier === 'trusted') && fake) this.fakeAccepted.add(tv.bssid);
  }

  // ───────────── admission: the invariant (plan §9.7) ─────────────
  tierOfPath(ctx: Ctx, pathId: string): TrustView | undefined {
    if (!isWifiPath(pathId)) return this.trust.get(pathId);
    const b = this.wifi.net === netOf(pathId) ? this.wifi.bssid : null;
    if (b && this.trust.get(b)) return this.trust.get(b);
    // ESS: any trusted BSSID of the same enrolled network
    for (const tv of this.trust.values()) if (tv.net === netOf(pathId) && tv.tier === 'trusted') return tv;
    return undefined;
    void ctx;
  }

  /** what may carry the tunnel: Trusted (primary) or Tunnel only (backup). Unreachable, Blocked, Checking: never. */
  isAdmissible(ctx: Ctx, pathId: string): boolean {
    if (!this.opts.trust) return true;
    const tv = this.tierOfPath(ctx, pathId);
    return !!tv && (tv.tier === 'trusted' || tv.tier === 'tunnel');
  }

  private usableTrusted(ctx: Ctx, pathId: string): boolean {
    if (!this.pathUsable(ctx, pathId)) return false;
    if (!this.opts.trust) return true;
    const tv = this.tierOfPath(ctx, pathId);
    if (!tv) return false;
    if (tv.tier === 'trusted') return true;
    return tv.tier === 'tunnel' && tv.handshake === 'pass';
  }

  routeChecked(ctx: Ctx): boolean {
    return !!this.route && this.isAdmissible(ctx, this.route);
  }

  // ───────────── the trust gate: appears → screen ─────────────
  private trustBookkeeping(ctx: Ctx) {
    if (!ctx.radioTick) return;
    this.floodCheck(ctx);
    for (const e of ctx.obs.scan) {
      if (e.anon) continue;                         // other people's networks: anonymous dots, never joined
      if (e.rssiDbm < -82 && !e.live) continue;
      const tv = this.trust.get(e.bssid);
      if (tv) { this.rescreen(ctx, tv, e); continue; }
      if (this.opts.trust && !e.live && isEnrolled(e.net, e) && [...this.trust.values()].some((x) => x.net === e.net && x.tier === 'trusted')) {
        // another access point of an enrolled network we already checked (same 802.1X/SAE domain, in our profile)
        this.trust.set(e.bssid, this.enrolledView(e.bssid, e.ssid, e.net, ctx.t));
        continue;
      }
      const flags: Flag[] = this.opts.trust ? redFlags(e, ctx.obs.pos, e.live ? null : ctx.maps, { learned: this.learned }) : [];
      const view: TrustView = {
        bssid: e.bssid, ssid: e.ssid, net: e.net, tier: 'checking', flags, security: e.security, handshake: 'pending', linkType: e.net === 'site-net' ? 'sat' : 'wifi',
        firstSeenT: ctx.t, stage: 'quarantine', reason: '', mayCarry: '', steps: [], live: e.live,
        canaries: { tls: 'wait', dns: 'wait', portal: 'wait' },
      };
      this.trust.set(e.bssid, view);
      if (screen(flags) === 'block') {
        // two high flags, or one high and one medium: blocked before anything is sent
        view.tier = 'blocked'; view.handshake = undefined; view.canaries = undefined; view.decidedT = ctx.t; view.stage = 'verdict';
        this.refresh(view, ctx.t);
        this.report(ctx, view);
        continue;
      }
      this.refresh(view, ctx.t);
      ctx.emit({ t: ctx.t, type: 'trust.checking', bssid: e.bssid, ssid: e.ssid, flags, reason: view.reason });
      if (e.live) this.liveProbeAt.set(e.bssid, ctx.t + v('liveProbeS'));
    }
    // live hotspots: the screen is real; the quarantine probe is simulated (the laptop never joins venue Wi-Fi)
    for (const [b, at] of this.liveProbeAt) {
      if (ctx.t < at) continue;
      this.liveProbeAt.delete(b);
      const tv = this.trust.get(b);
      if (!tv || tv.tier !== 'checking') continue;
      this.verdict(ctx, tv, 'pass');
      // first sight teaches the phone this network (trust on first use): its BSSID and security become what it
      // remembers, so a second device with the same name is "new device", and a weaker one a "downgrade". Weak
      // crypto or a loud signal don't stop it learning; a flag about who it is (a copy, a look-alike) does.
      const e = ctx.obs.byBssid.get(b);
      const tier = tv.tier as Tier;
      const identity = tv.flags.some((f) => f.id === 'new-device' || f.id === 'downgrade' || f.id === 'look-alike' || f.id === 'dns');
      if (e && !identity && (tier === 'tunnel' || tier === 'trusted')) {
        const l = this.learned.get(e.ssidHex) ?? { bssids: new Set<string>(), security: e.security, name: tv.ssid };
        l.bssids.add(b);
        this.learned.set(e.ssidHex, l);
      }
    }
  }

  /** a known BSSID that comes back weaker (the downgrade variant: same BSSID, no password) is checked again */
  private rescreen(ctx: Ctx, tv: TrustView, e: ScanEntry) {
    if (tv.linkType === '5g' || !this.opts.trust) return;
    if (tv.net !== e.net) {
      tv.net = e.net;                            // the radio now hears another transmitter under this BSSID
      // a perfect copy (same name, security and BSSID) inherits the real network's verdict: counted, never hidden
      if (tv.net === 'twin' && (tv.tier === 'tunnel' || tv.tier === 'trusted')) this.fakeAccepted.add(tv.bssid);
    }
    const was = tv.security;
    if (!was || e.security === was) return;
    if (SEC_RANK[e.security] >= SEC_RANK[was]) return;
    if (tv.tier === 'blocked') return;
    const flags = redFlags(e, ctx.obs.pos, ctx.maps);
    if (!flags.some((f) => f.id === 'downgrade')) {
      flags.push({ id: 'downgrade', weight: 'high', text: e.security === 'OPEN' ? `Security downgrade: no password (was ${SEC_LABEL[was]})` : `Security downgrade: ${SEC_LABEL[e.security]} (was ${SEC_LABEL[was]})` });
    }
    Object.assign(tv, {
      tier: 'checking', flags, security: e.security, handshake: 'pending', authFailed: 0, canaries: { tls: 'wait', dns: 'wait', portal: 'wait' },
      firstSeenT: ctx.t, decidedT: undefined, retryAt: undefined, stage: 'quarantine',
    } satisfies Partial<TrustView>);
    if (this.wifi.bssid === tv.bssid) this.disassociate(ctx, 'security changed');
    if (screen(flags) === 'block') {
      tv.tier = 'blocked'; tv.handshake = undefined; tv.canaries = undefined; tv.decidedT = ctx.t; tv.stage = 'verdict';
      this.refresh(tv, ctx.t);
      this.report(ctx, tv);
      return;
    }
    this.refresh(tv, ctx.t);
    ctx.emit({ t: ctx.t, type: 'trust.checking', bssid: tv.bssid, ssid: tv.ssid, flags, reason: tv.reason });
  }

  /** spec §6: many new names per scan raise an environment alert that freezes trust upgrades */
  private floodCheck(ctx: Ctx) {
    const win = v('floodWindowS');
    const names = new Set<string>();
    for (const e of ctx.obs.scan) {
      const f = ctx.obs.firstSeen.get(e.bssid);
      if (f !== undefined && f > 0.5 && ctx.t - f <= win) names.add(e.ssidHex || e.bssid);
    }
    const on = names.size >= v('floodNewNames');
    if (on !== this.flood) {
      this.flood = on;
      ctx.emit({ t: ctx.t, type: on ? 'flood.on' : 'flood.off', newNames: names.size });
    }
  }

  /** Pick a network to probe with the (single) Wi-Fi radio, if the radio is not carrying the call. */
  private maybeProbeCandidate(ctx: Ctx) {
    const carrying = isWifiPath(this.route) || (this.dup?.paths.some(isWifiPath) ?? false);
    if (carrying) return;
    if (this.wifi.net && this.wifi.phase !== 'up') return; // a join is in progress
    const due = (tv: TrustView) => (tv.tier === 'checking' || tv.tier === 'unreachable') && (tv.retryAt ?? -1) <= ctx.t;
    const pending = [...this.trust.values()].filter((tv) => !tv.bssid.startsWith('cell:') && !tv.live && due(tv) && ctx.obs.byBssid.has(tv.bssid))
      .sort((a, b) => a.firstSeenT - b.firstSeenT);
    if (!pending.length) {
      // nothing to check: if associated to something unusable, leave it
      if (this.wifi.bssid) {
        const tv = this.trust.get(this.wifi.bssid);
        if (tv?.tier === 'blocked') this.disassociate(ctx, 'blocked', 30);
      }
      // join an enrolled network we trust, for use
      if (!this.wifi.net) {
        const enr = ctx.obs.scan.filter((e) => this.trust.get(e.bssid)?.tier === 'trusted' && e.rssiDbm > v('wifiVoiceDbm')).sort((a, b) => b.rssiDbm - a.rssiDbm)[0];
        if (enr) { this.checkTarget = null; this.joinWifi(ctx, enr.net, enr.bssid, 'use'); }
      }
      return;
    }
    const tgt = pending[0];
    if (this.wifi.bssid === tgt.bssid) return;
    if (this.wifi.net) this.disassociate(ctx, 'probe another network');
    if (tgt.tier === 'unreachable') {
      // the retry: back into quarantine
      Object.assign(tgt, { tier: 'checking', handshake: 'pending', retryAt: undefined, stage: 'quarantine', canaries: { tls: 'wait', dns: 'wait', portal: 'wait' } } satisfies Partial<TrustView>);
      this.refresh(tgt, ctx.t);
    }
    this.checkTarget = tgt.bssid;
    this.joinWifi(ctx, tgt.net, tgt.bssid, 'check');
  }

  // ───────────── quarantine → verdict ─────────────
  protected onJoinDone(ctx: Ctx) {
    const b = this.wifi.bssid;
    if (!b) return;
    const tv = this.trust.get(b);
    const e = ctx.obs.byBssid.get(b);
    if (!tv || !e) return;
    if (tv.tier !== 'checking' && tv.decidedT !== undefined && this.wifi.purpose === 'use') return;
    this.verdict(ctx, tv, this.wifi.handshake ?? 'timeout', e);
  }

  private verdict(ctx: Ctx, tv: TrustView, hs: HandshakeResult, e?: ScanEntry) {
    // the probe and canaries ran in parallel: a tampering path fails authentication and swaps the TLS certificate
    const tampering = hs === 'authfail';
    tv.handshake = hs;
    tv.authFailed = tampering ? v('authFailPackets') : 0;
    tv.canaries = hs === 'pass' || tampering ? { tls: tampering ? 'bad' : 'ok', dns: 'ok', portal: 'ok' } : { tls: 'skip', dns: 'skip', portal: hs === 'portal' ? 'bad' : 'skip' };
    const known = !!e && isEnrolled(e.net, e);
    const tier: Tier = this.opts.trust
      ? decideTier({ known, flags: tv.flags, handshake: hs, authFailed: tv.authFailed, tls: tv.canaries.tls, flood: this.flood })
      : hs === 'pass' ? 'trusted' : hs === 'timeout' ? 'unreachable' : hs === 'portal' ? 'checking' : 'blocked';
    tv.tier = tier;
    tv.stage = tier === 'checking' ? 'quarantine' : 'verdict';
    tv.decidedT = tier === 'checking' ? undefined : ctx.t;
    tv.retryAt = tier === 'unreachable' || tier === 'checking' ? ctx.t + v('unreachableRetryS') : undefined;
    this.refresh(tv, ctx.t);
    this.report(ctx, tv);
    if (this.wifi.bssid === tv.bssid) {
      if (tier === 'blocked') this.disassociate(ctx, 'blocked', 60);
      else if (tier === 'unreachable' || tier === 'checking') this.disassociate(ctx, tier, 0);
    }
    if (this.checkTarget === tv.bssid) this.checkTarget = null;
  }

  // ───────────── RTT-aware liveness (RFC 6298-style per path) ─────────────
  private liveness(ctx: Ctx, pathId: string): Rto {
    let r = this.rto.get(pathId);
    if (!r) { r = { rto: 1000, timeouts: 0, nextAt: ctx.t, slot: 0, dead: false, samples: [] }; this.rto.set(pathId, r); }
    if (r.pending && ctx.t >= r.pending.due) {
      const ok = r.pending.rtt <= r.rto;
      if (ok) {
        const R = r.pending.rtt;
        if (r.srtt === undefined) { r.srtt = R; r.rttvar = R / 2; }
        else { r.rttvar = 0.75 * r.rttvar! + 0.25 * Math.abs(r.srtt - R); r.srtt = 0.875 * r.srtt + 0.125 * R; }
        r.rto = Math.min(v('rtoMaxMs'), Math.max(v('rtoMinMs'), r.srtt + 4 * r.rttvar!));
        r.timeouts = 0;
        r.dead = false;
        r.samples.push(R);
        if (r.samples.length > 60) r.samples.shift();
      } else {
        r.timeouts++;
        r.rto = Math.min(v('rtoMaxMs'), r.rto * 2); // exponential back-off: never mistakes a slow link for a dead one
        r.samples.push(Infinity);
        if (r.samples.length > 60) r.samples.shift();
        if (r.timeouts >= v('rtoDeadAfter')) r.dead = true;
      }
      r.pending = undefined;
      r.nextAt = ctx.t + (netOf(pathId) === 'site-net' ? v('satProbeMs') : v('keepaliveMs')) / 1000;
    }
    if (!r.pending && ctx.t >= r.nextAt) {
      const p = ctx.paths.get(pathId);
      const rtt = p && this.pathUsable(ctx, pathId) ? sampleProbeRtt(ctx.seed, p, Math.floor(ctx.t * 10) + 7 * r.slot++, true) : Infinity;
      r.pending = { due: ctx.t + Math.min(rtt, r.rto) / 1000, rtt };
    }
    return r;
  }

  // ───────────── main decision loop ─────────────
  decide(ctx: Ctx) {
    this.trustBookkeeping(ctx);
    this.predictor.observePos(ctx.t, ctx.obs.pos);
    if (isWifiPath(this.route) && ctx.radioTick) this.predictor.observeRssi(ctx.t, this.measuredWifiRssi(ctx));

    // cellular candidates: SIM-authenticated, need only the tunnel handshake
    for (const c of ctx.obs.cell.values()) {
      const key = `cell:${c.net}`;
      if (!this.trust.has(key) && c.attached) this.trust.set(key, this.cellTrust(ctx, key, 'checking'));
    }

    if (this.route) {
      const r = this.liveness(ctx, this.route);
      if (netOf(this.route) === 'site-net') this.leoLogic(ctx, r);
      else { this.redundancy = false; this.rx.stretchMs = 0; }
    }
    if (this.candidate) this.liveness(ctx, this.candidate);
    this.anchorWatch(ctx);

    if (isWifiPath(this.route)) this.onWifi(ctx);
    else this.onCell(ctx);

    this.maybeProbeCandidate(ctx);
    this.progressCandidateCheck(ctx);
    this.checking = this.candidateState === 'checking' || (!!this.wifi.net && this.wifi.phase !== 'up' && this.wifi.purpose === 'check');
  }

  /** Fail closed (spec §5, D2). The phone's own inference: the tunnel is silent on a link whose radio looks
   *  healthy, while the network itself still answers the DNS canary (outside the tunnel). So the anchor, not the
   *  radio or the uplink, is down. A satellite failover fails the canary too, so it never reads as "anchor down".
   *  Nothing is sent outside the tunnel meanwhile; the phone says so and holds messages. */
  private anchorWatch(ctx: Ctx) {
    const r = this.route ? this.rto.get(this.route) : undefined;
    const p = this.route ? ctx.paths.get(this.route) : undefined;
    let radioOk = false;
    if (this.route && isWifiPath(this.route)) radioOk = this.measuredWifiRssi(ctx) > v('wifiDataDbm');
    else if (this.route) { const c = ctx.obs.cell.get(netOf(this.route)); radioOk = !!c && c.rsrpDbm > v('nrUsableRsrpDbm') && c.sinrDb > v('nrUsableSinrDb'); }
    const networkAnswers = !!p && p.up && p.loss < 0.9 && p.uplink !== 'none' && !p.udpBlocked;
    const silent = !!r && radioOk && networkAnswers && (r.dead || !this.pathUsable(ctx, this.route!)) && r.timeouts > 0;
    let lost = this.anchorLost;
    if (!silent) { this.anchorProbe = null; lost = false; }
    else if (!this.anchorProbe) {
      // a fresh handshake to the anchor through the answering network: does the anchor itself reply?
      this.anchorProbe = { due: ctx.t + probeTimeoutS(netOfKind(this.route!)), ok: !ctx.lab.anchorDown };
    } else if (ctx.t >= this.anchorProbe.due) {
      lost = !this.anchorProbe.ok;
      this.anchorProbe = null;
    }
    if (lost !== this.anchorLost) {
      this.anchorLost = lost;
      ctx.emit({ t: ctx.t, type: lost ? 'anchor.lost' : 'anchor.back' });
    }
  }
  private anchorProbe: { due: number; ok: boolean } | null = null;

  private bestCell(ctx: Ctx): string | null {
    const cells = [...ctx.obs.cell.values()].filter((c) => c.attached && c.rsrpDbm > v('nrUsableRsrpDbm') && c.sinrDb > v('nrUsableSinrDb')).sort((a, b) => b.rsrpDbm - a.rsrpDbm);
    return cells.length ? `cell:${cells[0].net}` : null;
  }

  private startCheck(ctx: Ctx, pathId: string) {
    if (this.candidate === pathId && this.candidateState !== 'idle') return;
    const known = this.trust.get(pathId);
    if (known?.tier === 'unreachable' && ctx.t < (known.retryAt ?? 0)) return; // no answer last time: wait for the retry
    this.candidate = pathId;
    const p = ctx.paths.get(pathId);
    const tv = known ?? this.cellTrust(ctx, pathId, 'checking');
    this.trust.set(pathId, tv);
    const already = this.tunnelOn.get(pathId);
    if (already && p && already.epoch === p.ipEpoch && ctx.t >= already.readyAt && tv.tier === 'trusted') {
      this.candidateState = 'ready';
      return;
    }
    this.candidateState = 'checking';
    tv.tier = 'checking';
    tv.handshake = 'pending';
    tv.stage = 'quarantine';
    tv.firstSeenT = ctx.t;
    tv.decidedT = undefined;
    this.refresh(tv, ctx.t);
    this.candStartT = ctx.t;
    // 1 round trip (Noise_IKpsk2-style); a path that doesn't answer is given up on after its own patience
    const answers = !!p && p.up && p.loss < 0.9 && !ctx.lab.anchorDown;
    this.candReadyAt = ctx.t + (answers ? (rttOf(p!, true) + v('handshakeExtraMs')) / 1000 : probeTimeoutS('5g'));
    ctx.emit({ t: ctx.t, type: 'check.start', link: pathId, label: NET_LABEL[netOf(pathId)] ?? pathId });
  }

  private progressCandidateCheck(ctx: Ctx) {
    if (!this.candidate || this.candidateState !== 'checking' || ctx.t < this.candReadyAt) return;
    const p = ctx.paths.get(this.candidate);
    const tv = this.trust.get(this.candidate)!;
    tv.decidedT = ctx.t;
    tv.stage = 'verdict';
    if (p && p.up && p.loss < 0.9 && !ctx.lab.anchorDown) {
      this.tunnelOn.set(this.candidate, { epoch: p.ipEpoch, readyAt: ctx.t });
      this.candidateState = 'ready';
      tv.tier = 'trusted';
      tv.handshake = 'pass';
      this.refresh(tv, ctx.t);
      tv.reason = `${NET_LABEL[netOf(this.candidate)]} (SIM-authenticated), as expected. Handshake passed.`;
      this.verdictLog.push({ linkType: '5g', ms: (ctx.t - this.candStartT) * 1000, tier: 'trusted' });
      ctx.emit({ t: ctx.t, type: 'check.pass', link: this.candidate, label: NET_LABEL[netOf(this.candidate)] ?? this.candidate });
    } else {
      // silence is not an attack: Unreachable, tried again shortly (spec §2)
      this.candidateState = 'idle';
      tv.tier = 'unreachable';
      tv.handshake = 'timeout';
      tv.retryAt = ctx.t + 2;
      this.refresh(tv, ctx.t);
      this.report(ctx, tv);
      ctx.emit({ t: ctx.t, type: 'check.fail', link: this.candidate, label: NET_LABEL[netOf(this.candidate)] ?? this.candidate });
    }
  }

  private onWifi(ctx: Ctx) {
    const net = netOf(this.route!);
    const thr = v('wifiDataDbm');
    let ttl: number | undefined;
    if (this.opts.predict) {
      const grids = LAYOUT.transmitters.filter((t) => t.kind === 'wifi' && t.net === net && !t.attacker)
        .map((t) => ({ g: ctx.maps.byTx.get(t.id)!.belief!, eirp: t.eirpDbm ?? 20 })).filter((x) => !!x.g);
      this.last = this.predictor.ttl(ctx.t, grids, thr);
      ttl = this.last.ttlS;
    } else {
      this.last = { confidence: 0, forecast: [], vel: [0, 0] };
    }
    const measured = this.measuredWifiRssi(ctx);
    const r = this.rto.get(this.route!);
    const lossRecent = this.recentLoss(ctx.t, 0.5);
    // the radio itself is gone (a deauth, or the AP vanished): that is certain, not a forecast. Any attached
    // 5G whose tunnel is still up beats a dead Wi-Fi, even a weak one; a fresh check would only add silence.
    if (!this.wifi.net && ctx.t - this.switchedAt > 0.2) {
      const warm = [...ctx.obs.cell.values()].filter((c) => c.attached).sort((a, b) => b.rsrpDbm - a.rsrpDbm)
        .map((c) => `cell:${c.net}`).find((p) => this.pathUsable(ctx, p));
      if (warm) { this.switchTo(ctx, warm, ttl); return; }
    }
    const cand = this.bestCell(ctx);
    if (!cand) return;
    // prepare: check the next network while there is still time
    const prepare = ttl !== undefined && ttl <= Math.max(v('prepareLeadS'), 1.5 + (rttOf(ctx.paths.get(cand)!, true) / 1000));
    if (prepare) {
      if (this.headsUpFor !== cand) {
        this.headsUpFor = cand;
        ctx.emit({ t: ctx.t, type: 'predict.edge', link: this.route!, ttlS: ttl!, label: NET_LABEL[net] ?? net });
      }
      this.startCheck(ctx, cand);
    }
    const reactive = measured < v('wifiDataDbm') - 7 || lossRecent > 0.2 || !!r?.dead || !this.pathUsable(ctx, this.route!);
    const predicted = ttl !== undefined && ttl <= v('switchLeadS');
    if ((predicted || reactive) && this.candidateState === 'idle') this.startCheck(ctx, cand);
    if ((predicted || reactive || measured < thr) && this.candidateState === 'ready' && ctx.t - this.switchedAt > 1) {
      this.switchTo(ctx, cand, ttl);
    }
    if (!prepare && !reactive && ttl === undefined && this.candidateState === 'ready' && this.headsUpFor) {
      // walked away from the edge: stand down (the 5G tunnel stays warm)
      this.headsUpFor = null;
    }
  }

  private switchTo(ctx: Ctx, to: string, ttl?: number) {
    const from = this.route!;
    const pf = ctx.paths.get(from), pt = ctx.paths.get(to);
    const deadline = this.rx.P - v('dupDeadlineMarginMs');
    const fits = (p?: { owdMs: number }) => !!p && p.owdMs + v('anchorDetourMs') <= deadline;
    const dupOk = this.pathUsable(ctx, from) && fits(pf) && fits(pt);
    this.switchedAt = ctx.t;
    if (isWifiPath(from)) this.predLog.push({ switchT: ctx.t, predictedCrossT: ttl !== undefined ? ctx.t + ttl : undefined, net: netOf(from) });
    this.steer(ctx, to, dupOk ? { dupWith: from, dupS: v('dupHoldS') } : {});
    this.predictor.clearRssi();
    this.headsUpFor = null;
    this.candidate = isWifiPath(from) ? null : from;
    this.candidateState = 'idle';
    const startedAt = ctx.t;
    // report frozen time around the switch once the overlap ends
    this.pendingSwitchReport = { at: startedAt + v('dupHoldS') + 0.4, to, frozenBefore: this.rx.frozenS };
  }
  pendingSwitchReport: { at: number; to: string; frozenBefore: number } | null = null;

  private onCell(ctx: Ctx) {
    // return to a trusted Wi-Fi when it is good and stable (make-before-break)
    const w = this.wifi;
    if (w.net && w.phase === 'up') {
      const wp = `wifi:${w.net}`;
      const tv = this.tierOfPath(ctx, wp);
      const good = this.measuredWifiRssi(ctx) > v('wifiVoiceDbm');
      if (tv?.tier === 'trusted' && good && this.usableTrusted(ctx, wp)) {
        this.goodWifiSince ??= ctx.t;
        if (ctx.t - this.goodWifiSince > 2 && ctx.t - this.switchedAt > 4) { this.switchTo(ctx, wp); this.goodWifiSince = null; return; }
      } else this.goodWifiSince = null;
    }
    // current cellular path dying? fall back to the best checked alternative
    const r = this.route ? this.rto.get(this.route) : undefined;
    const cur = this.route ? ctx.obs.cell.get(netOf(this.route)) : undefined;
    const bad = !this.route || !!r?.dead || (cur && (cur.rsrpDbm < v('nrUsableRsrpDbm') || cur.sinrDb < v('nrUsableSinrDb')));
    if (bad) {
      const cell = this.bestCell(ctx);
      if (cell && cell !== this.route) { this.startCheck(ctx, cell); if (this.candidateState === 'ready') this.switchTo(ctx, cell); }
      else if (w.net && w.phase === 'up' && this.usableTrusted(ctx, `wifi:${w.net}`)) this.switchTo(ctx, `wifi:${w.net}`);
      else if (!this.route && cell) this.switchTo(ctx, cell);
    }
  }

  private leoLogic(ctx: Ctx, r: Rto) {
    void r;
    if (this.leo.fit(ctx.t) && !this.leo.announced && this.leo.periodS) {
      this.leo.announced = true;
      this.pattern = { periodS: this.leo.periodS, confidence: this.leo.confidence };
      ctx.emit({ t: ctx.t, type: 'sat.pattern', periodS: this.leo.periodS, confidence: this.leo.confidence });
    }
    const up = ctx.paths.get(this.route!)?.uplink;
    const prot = up === 'LEO' && this.leo.announced && this.leo.protecting(ctx.t);
    this.redundancy = prot;
    this.rx.stretchMs = prot ? v('leoStretchMs') : 0;
  }

  protected onFrame(ctx: Ctx, transitMs: number) {
    if (this.route && netOf(this.route) === 'site-net' && ctx.paths.get(this.route)?.uplink === 'LEO') this.leo.observe(ctx.t, transitMs);
  }

  /** rttMs = the latest measured round trip (what the screen calls "round trip"); srttMs = RFC 6298 smoothed value,
   *  which converges at 1/8 per accepted sample and so lags a GEO failover by many seconds. */
  satPatience(ctx: Ctx): { rttMs: number; srttMs: number; rtoMs: number; normal: boolean } | undefined {
    if (!this.route || netOf(this.route) !== 'site-net') return undefined;
    const r = this.rto.get(this.route);
    if (!r || r.srtt === undefined) return undefined;
    void ctx;
    let last = r.srtt;
    for (let i = r.samples.length - 1; i >= 0; i--) if (Number.isFinite(r.samples[i])) { last = r.samples[i]; break; }
    return { rttMs: last, srttMs: r.srtt, rtoMs: r.rto, normal: !r.dead };
  }

  rttTrace(pathId: string): number[] {
    return this.rto.get(pathId)?.samples ?? [];
  }

  forecastPts(): Vec2[] { return this.last.forecast; }
}
