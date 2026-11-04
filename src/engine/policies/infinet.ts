/**
 * Infinet = coverage-map prediction (Feature 1) + trust gate (Feature 2) + tunnel
 *         + deadline-aware selective duplication + RTT-aware liveness + LEO pattern learner.
 * Reads only Observations + its own belief map + its own probe results (never truth; plan P5/P6).
 */
import { v } from '../params';
import type { Flag, PolicyId, TrustView, Vec2 } from '../types';
import { Agent, isWifiPath, netOf, NET_LABEL, type Ctx } from './agent';
import { Predictor, type TtlResult } from '../predict/predict';
import { LeoLearner } from '../predict/leoPattern';
import { decideTier, ENROLLED, isEnrolled, redFlags, verdictText } from '../trust/trust';
import { rttOf, sampleProbeRtt } from '../links/paths';
import { LAYOUT } from '../world/layout';

interface Rto { srtt?: number; rttvar?: number; rto: number; timeouts: number; nextAt: number; pending?: { due: number; rtt: number }; slot: number; dead: boolean; samples: number[] }

export interface InfinetOpts { predict: boolean; trust: boolean }

export class Infinet extends Agent {
  readonly opts: InfinetOpts;
  trust = new Map<string, TrustView>();    // key: bssid | path id for cellular
  predictor = new Predictor();
  leo = new LeoLearner();
  last: TtlResult = { confidence: 0, forecast: [], vel: [0, 0] };
  candidate: string | null = null;
  candidateState: 'idle' | 'checking' | 'ready' = 'idle';
  private candReadyAt = 0;
  private headsUpFor: string | null = null;
  private rto = new Map<string, Rto>();
  checkTarget: string | null = null;
  private goodWifiSince: number | null = null;
  private switchedAt = -100;
  /** prediction bookkeeping for the batch metric (lead time and error vs truth) */
  predLog: Array<{ switchT: number; predictedCrossT?: number; net: string }> = [];
  pattern?: { periodS: number; confidence: number };

  constructor(seed: number, id: PolicyId = 'infinet', opts: InfinetOpts = { predict: true, trust: true }) {
    super(id, seed, true);
    this.opts = opts;
  }

  // ───────────── initial trust state for a scenario ─────────────
  preTrust(ctx: Ctx, keys: string[]) {
    for (const k of keys) {
      if (k.startsWith('cell:')) this.trust.set(k, this.cellTrust(ctx, k, 'trusted'));
      else for (const tx of LAYOUT.transmitters.filter((x) => x.kind === 'wifi' && x.net === k && !x.attacker)) {
        this.trust.set(tx.bssid!, { bssid: tx.bssid!, ssid: tx.ssid!, net: tx.net, tier: 'trusted', flags: [], score: 0, handshake: 'pass', firstSeenT: ctx.t, decidedT: ctx.t,
          reason: `${tx.ssid}, as expected. Handshake passed.`, mayCarry: 'Everything', steps: this.okSteps(tx.ssid!, ctx.t) });
      }
    }
  }

  private okSteps(_ssid: string, t: number) {
    return [
      { text: 'Known device for this name', ok: true, t },
      { text: 'Security as enrolled', ok: true, t },
      { text: 'Signal matches our map', ok: true, t },
      { text: 'Handshake with anchor server', ok: true, t },
    ];
  }

  private cellTrust(ctx: Ctx, key: string, tier: 'checking' | 'trusted'): TrustView {
    const net = netOf(key);
    return {
      bssid: key, ssid: NET_LABEL[net] ?? net, net, tier, flags: [], score: 0, handshake: tier === 'trusted' ? 'pass' : 'pending', firstSeenT: ctx.t,
      decidedT: tier === 'trusted' ? ctx.t : undefined,
      reason: tier === 'trusted' ? `${NET_LABEL[net]} (SIM-authenticated). Handshake passed.` : `Checking ${NET_LABEL[net]}…`,
      mayCarry: tier === 'trusted' ? 'Everything' : 'Nothing yet',
      steps: [
        { text: 'SIM-authenticated (5G AKA, mutual)', ok: true, t: ctx.t },
        { text: 'Handshake with anchor server', ok: tier === 'trusted' ? true : null, t: ctx.t },
      ],
    };
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

  isAdmissible(ctx: Ctx, pathId: string): boolean {
    if (!this.opts.trust) return true;
    const tv = this.tierOfPath(ctx, pathId);
    return !!tv && (tv.tier === 'trusted' || tv.tier === 'pipe');
  }

  private usableTrusted(ctx: Ctx, pathId: string): boolean {
    if (!this.pathUsable(ctx, pathId)) return false;
    if (!this.opts.trust) return true;
    const tv = this.tierOfPath(ctx, pathId);
    if (!tv) return false;
    if (tv.tier === 'trusted') return true;
    return tv.tier === 'pipe' && tv.handshake === 'pass';
  }

  routeChecked(ctx: Ctx): boolean {
    return !!this.route && this.isAdmissible(ctx, this.route);
  }

  // ───────────── the trust gate ─────────────
  private trustBookkeeping(ctx: Ctx) {
    if (!ctx.radioTick) return;
    for (const e of ctx.obs.scan) {
      if (e.rssiDbm < -82) continue;
      const tv = this.trust.get(e.bssid);
      if (!tv && this.opts.trust && isEnrolled(e.net, e) && [...this.trust.values()].some((x) => x.net === e.net && x.tier === 'trusted')) {
        // another access point of an enrolled network we already checked (same 802.1X/SAE domain, in our profile)
        this.trust.set(e.bssid, { bssid: e.bssid, ssid: e.ssid, net: e.net, tier: 'trusted', flags: [], score: 0, handshake: 'pass', firstSeenT: ctx.t, decidedT: ctx.t,
          reason: `${e.ssid}, as expected. Handshake passed.`, mayCarry: 'Everything', steps: this.okSteps(e.ssid, ctx.t) });
        continue;
      }
      if (!tv) {
        const flags: Flag[] = this.opts.trust ? redFlags(e, ctx.obs.pos, ctx.maps, ctx.obs.firstSeen, ctx.obs.scan) : [];
        const score = flags.reduce((s, f) => s + f.score, 0);
        const steps = flags.length
          ? flags.map((f) => ({ text: f.text, ok: false as boolean | null, t: ctx.t }))
          : [{ text: 'Known device for this name', ok: (LAYOUT.transmitters.some((x) => x.bssid === e.bssid && !x.attacker)) as boolean | null, t: ctx.t },
             { text: 'Security as expected', ok: true as boolean | null, t: ctx.t },
             { text: 'Signal matches our map', ok: true as boolean | null, t: ctx.t }];
        steps.push({ text: 'Handshake with anchor server', ok: null, t: ctx.t });
        const view: TrustView = { bssid: e.bssid, ssid: e.ssid, net: e.net, tier: 'checking', flags, score, handshake: 'pending', firstSeenT: ctx.t, reason: '', mayCarry: 'Nothing yet', steps };
        Object.assign(view, verdictText(view));
        this.trust.set(e.bssid, view);
        ctx.emit({ t: ctx.t, type: 'trust.checking', bssid: e.bssid, ssid: e.ssid, flags, reason: view.reason });
      }
    }
  }

  /** Pick a network to probe with the (single) Wi-Fi radio, if the radio is not carrying the call. */
  private maybeProbeCandidate(ctx: Ctx) {
    const carrying = isWifiPath(this.route) || (this.dup?.paths.some(isWifiPath) ?? false);
    if (carrying) return;
    if (this.wifi.net && this.wifi.phase !== 'up') return; // a join is in progress
    const pending = [...this.trust.values()].filter((tv) => !tv.bssid.startsWith('cell:') && tv.tier === 'checking' && ctx.obs.byBssid.has(tv.bssid))
      .sort((a, b) => a.firstSeenT - b.firstSeenT);
    if (!pending.length) {
      // nothing to check: if associated to something unusable, keep it (no traffic) unless blocked
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
    this.checkTarget = tgt.bssid;
    this.joinWifi(ctx, tgt.net, tgt.bssid, 'check');
  }

  protected onJoinDone(ctx: Ctx) {
    const b = this.wifi.bssid;
    if (!b) return;
    const tv = this.trust.get(b);
    const e = ctx.obs.byBssid.get(b);
    if (!tv || !e) return;
    if (tv.tier !== 'checking' && tv.decidedT !== undefined && this.wifi.purpose === 'use') return;
    const hs = this.wifi.handshake ?? 'timeout';
    const enrolled = isEnrolled(e.net, e) && !!ENROLLED[e.net];
    const res = this.opts.trust ? decideTier({ enrolled, open: e.security === 'OPEN', score: tv.score, handshake: hs, threshold: ctx.lab.blockThreshold })
      : { tier: hs === 'pass' ? 'trusted' as const : 'blocked' as const, usable: hs === 'pass' };
    tv.handshake = hs;
    tv.tier = res.tier;
    tv.decidedT = ctx.t;
    const last = tv.steps[tv.steps.length - 1];
    last.ok = hs === 'pass' ? true : hs === 'portal' ? null : false;
    last.text = hs === 'pass' ? 'Handshake with anchor server: passed' : hs === 'fail' ? 'Handshake with anchor server: failed' : hs === 'portal' ? 'Handshake: blocked by a login page' : 'Handshake: timed out';
    last.t = ctx.t;
    Object.assign(tv, verdictText(tv));
    const type = res.tier === 'blocked' ? 'trust.blocked' : res.tier === 'trusted' ? 'trust.trusted' : 'trust.pipe';
    ctx.emit({ t: ctx.t, type, bssid: b, ssid: tv.ssid, flags: tv.flags, reason: tv.reason, handshake: hs });
    if (res.tier === 'blocked') {
      if (!LAYOUT.transmitters.find((x) => x.bssid === b)?.attacker) this.wronglyBlocked++;
      this.disassociate(ctx, 'blocked', 60);
    }
    this.checkTarget = null;
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

    if (isWifiPath(this.route)) this.onWifi(ctx);
    else this.onCell(ctx);

    this.maybeProbeCandidate(ctx);
    this.progressCandidateCheck(ctx);
    this.checking = this.candidateState === 'checking' || (!!this.wifi.net && this.wifi.phase !== 'up' && this.wifi.purpose === 'check');
  }

  private bestCell(ctx: Ctx): string | null {
    const cells = [...ctx.obs.cell.values()].filter((c) => c.attached && c.rsrpDbm > v('nrUsableRsrpDbm') && c.sinrDb > v('nrUsableSinrDb')).sort((a, b) => b.rsrpDbm - a.rsrpDbm);
    return cells.length ? `cell:${cells[0].net}` : null;
  }

  private startCheck(ctx: Ctx, pathId: string) {
    if (this.candidate === pathId && this.candidateState !== 'idle') return;
    this.candidate = pathId;
    const p = ctx.paths.get(pathId);
    const tv = this.trust.get(pathId) ?? this.cellTrust(ctx, pathId, 'checking');
    this.trust.set(pathId, tv);
    const already = this.tunnelOn.get(pathId);
    if (already && p && already.epoch === p.ipEpoch && ctx.t >= already.readyAt && tv.tier === 'trusted') {
      this.candidateState = 'ready';
      return;
    }
    this.candidateState = 'checking';
    tv.tier = 'checking';
    tv.handshake = 'pending';
    tv.steps[tv.steps.length - 1] = { text: 'Handshake with anchor server', ok: null, t: ctx.t };
    this.candReadyAt = ctx.t + (p ? (rttOf(p, true) + v('handshakeExtraMs')) / 1000 : 1);
    ctx.emit({ t: ctx.t, type: 'check.start', link: pathId, label: NET_LABEL[netOf(pathId)] ?? pathId });
  }

  private progressCandidateCheck(ctx: Ctx) {
    if (!this.candidate || this.candidateState !== 'checking' || ctx.t < this.candReadyAt) return;
    const p = ctx.paths.get(this.candidate);
    const tv = this.trust.get(this.candidate)!;
    if (p && p.up && p.loss < 0.9) {
      this.tunnelOn.set(this.candidate, { epoch: p.ipEpoch, readyAt: ctx.t });
      this.candidateState = 'ready';
      tv.tier = 'trusted';
      tv.handshake = 'pass';
      tv.decidedT = ctx.t;
      tv.steps[tv.steps.length - 1] = { text: 'Handshake with anchor server: passed', ok: true, t: ctx.t };
      Object.assign(tv, verdictText(tv));
      ctx.emit({ t: ctx.t, type: 'check.pass', link: this.candidate, label: NET_LABEL[netOf(this.candidate)] ?? this.candidate });
    } else {
      this.candidateState = 'idle';
      tv.tier = 'blocked';
      tv.handshake = 'timeout';
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
