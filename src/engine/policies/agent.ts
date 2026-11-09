/**
 * Phone mechanics shared by every policy (plan §9.5). A policy is "the same phone, different brain":
 *  - ONE Wi-Fi radio (trap #1): a single association at a time; cellular stays attached in parallel.
 *  - Joining Wi-Fi costs seconds (trap #2): scan → auth/assoc → DHCP → captive-portal check (→ tunnel handshake).
 *  - Without a tunnel, a new network/IP breaks the call session: the app reconnects (UMons distribution).
 *  - With a tunnel, the session survives; the tunnel needs 1 RTT to (re)establish on a new path.
 */
import { v } from '../params';
import { Rng, crn, hashString } from '../rng';
import type { LabState, LaneState, LinkType, PacketVis, PolicyId, SimEvent, Vec2 } from '../types';
import type { Observations } from '../observe/observe';
import { rttOf, samplePacket, type PathTruth } from '../links/paths';
import type { MapSet } from '../maps/rfmaps';
import { LaneRecorder, Receiver } from '../session/voice';

export interface Ctx {
  t: number;
  seed: number;
  lab: LabState;
  paths: Map<string, PathTruth>;
  obs: Observations;
  maps: MapSet;
  truthPos: Vec2;
  emit(e: SimEvent): void;
  recordPacket(p: PacketVis): void;
  /** shared memory of trust verdicts is per-policy; this is the sim time when the attacker last sent deauths */
  radioTick: boolean;
}

export type JoinPhase = 'none' | 'scan' | 'assoc' | 'dhcp' | 'portal' | 'handshake' | 'up';

export interface WifiState {
  net: string | null;
  bssid: string | null;
  phase: JoinPhase;
  phaseEnd: number;
  plan: Array<[JoinPhase, number]>;
  purpose: 'use' | 'check';
  validated: boolean;
  portal: boolean;
  joinedAt: number;
  joins: number;
  handshake: 'pass' | 'authfail' | 'timeout' | 'portal' | null;
}

export const NET_LABEL: Record<string, string> = {
  'office-corp': 'Office Wi-Fi',
  'cafe-guest': 'Café Wi-Fi',
  twin: 'Café Wi-Fi (copy)',
  'site-net': 'Site Wi-Fi',
  'site-twin': 'Site Wi-Fi (copy)',
  flood: 'Fake beacon (flood)',
  'cell-a': '5G',
  'cell-b': '5G (Cellular B)',
};

export const netOf = (pathId: string) => pathId.split(':')[1];
/** networks that are an attacker's (truth only: the batch metrics count them; the phone never reads this) */
export const isFakeNet = (net: string) => net === 'twin' || net === 'site-twin' || net === 'flood';
export const isWifiPath = (pathId: string | null) => !!pathId && pathId.startsWith('wifi:');

const SAVED_SSIDS = new Set(['Office-Corp', 'Cafe_Guest', 'Site-Net']);

/** the kind of link a path is, as the phone knows it (Site-Net's satellite backhaul is in the enrolled profile) */
export function netOfPathKind(p: PathTruth | undefined): LinkType {
  if (!p) return 'wifi';
  if (p.kind === 'cell') return '5g';
  return p.id === 'wifi:site-net' ? 'sat' : 'wifi';
}
/** how long a probe waits for an answer: never below RFC 6298's 1 s, and 3 × the link's normal round trip */
export function probeTimeoutS(kind: LinkType): number {
  const typ = kind === 'sat' ? v('typicalRttSatMs') : kind === '5g' ? v('typicalRtt5gMs') : v('typicalRttWifiMs');
  return Math.max(v('probeTimeoutMinMs'), v('probeTimeoutRtts') * typ) / 1000;
}

export abstract class Agent {
  readonly id: PolicyId;
  readonly tunnel: boolean;
  protected rng: Rng;
  wifi: WifiState = { net: null, bssid: null, phase: 'none', phaseEnd: 0, plan: [], purpose: 'use', validated: false, portal: false, joinedAt: 0, joins: 0, handshake: null };
  route: string | null = null;
  routeEpoch = 0;
  dup: { paths: string[]; until: number } | null = null;
  sessionReadyAt = 0;
  /** tunnel endpoint per path: ipEpoch it was established for, and when it became ready */
  tunnelOn = new Map<string, { epoch: number; readyAt: number }>();
  rx = new Receiver();
  lane = new LaneRecorder();
  protected beaconMiss = 0;
  protected cooldown = new Map<string, number>();
  redundancy = false;
  checking = false;

  // statistics
  framesSent = 0;
  extraCopies = 0;
  fakeFrames = 0;
  fakePlainFrames = 0;
  invariantViolations = 0;
  falseDead = 0;
  switches = 0;
  wronglyBlocked = 0;
  reconnects = 0;
  private reconnectIdx = 0;
  private hid: number;

  constructor(id: PolicyId, seed: number, tunnel: boolean) {
    this.id = id;
    this.tunnel = tunnel;
    this.rng = Rng.named(seed, `agent:${id}`);
    this.hid = hashString(id);
  }

  abstract decide(ctx: Ctx): void;

  // ───────────── initial state ─────────────
  initOn(ctx: Ctx, route: string, wifiNet: string | null) {
    if (wifiNet) {
      const e = ctx.obs.scan.filter((s) => s.net === wifiNet).sort((a, b) => b.rssiDbm - a.rssiDbm)[0];
      this.wifi = { ...this.wifi, net: wifiNet, bssid: e?.bssid ?? null, phase: 'up', validated: true, portal: false, purpose: 'use', joinedAt: ctx.t, handshake: 'pass' };
    }
    this.route = route;
    const p = ctx.paths.get(route);
    this.routeEpoch = p?.ipEpoch ?? 0;
    if (this.tunnel) {
      this.tunnelOn.set(route, { epoch: p?.ipEpoch ?? 0, readyAt: ctx.t });
      if (wifiNet && route !== `wifi:${wifiNet}`) this.tunnelOn.set(`wifi:${wifiNet}`, { epoch: ctx.paths.get(`wifi:${wifiNet}`)?.ipEpoch ?? 0, readyAt: ctx.t });
    }
    this.rx.reset((p?.owdMs ?? 20) + (this.tunnel ? v('anchorDetourMs') : 0));
  }

  // ───────────── Wi-Fi radio ─────────────
  protected savedAndVisible(ctx: Ctx, minRssi: number) {
    return ctx.obs.scan.filter((e) => SAVED_SSIDS.has(e.ssid) && e.rssiDbm > minRssi && (this.cooldown.get(e.bssid) ?? -1) < ctx.t);
  }

  joinWifi(ctx: Ctx, net: string, bssid: string, purpose: 'use' | 'check') {
    const e = ctx.obs.byBssid.get(bssid);
    const path = ctx.paths.get(`wifi:${net}`);
    if (!e || !path) return;
    const r = this.rng;
    const range = (k: 'assocOpenMs' | 'assocPskMs' | 'assoc8021xMs') => { const [a, b] = v(k); return r.uniform(a, b) / 1000; };
    const assoc = e.security === 'WPA3-ENT' ? range('assoc8021xMs') : e.security === 'OPEN' || e.security === 'OWE' ? range('assocOpenMs') : range('assocPskMs');
    const [d0, d1] = v('dhcpS');
    const dhcp = Math.exp(r.uniform(Math.log(d0), Math.log(d1))); // log-uniform 0.3–3 s (median ≈0.95 s)
    // the OS captive-portal check; Infinet runs its own portal canary in parallel with the probe instead (spec §4)
    const plan: Array<[JoinPhase, number]> = [['scan', 0.1], ['assoc', assoc], ['dhcp', dhcp]];
    if (this.osPortalCheck) plan.push(['portal', v('portalCheckS')]);
    if (this.tunnel) plan.push(['handshake', -1]);
    this.wifi = { net, bssid, phase: 'scan', phaseEnd: ctx.t + 0.1, plan: plan.slice(1), purpose, validated: false, portal: false, joinedAt: ctx.t, joins: this.wifi.joins + 1, handshake: null };
    this.beaconMiss = 0;
  }

  disassociate(ctx: Ctx, why: string, cooldownS = 0) {
    if (!this.wifi.net) return;
    const pathId = `wifi:${this.wifi.net}`;
    if (cooldownS > 0 && this.wifi.bssid) this.cooldown.set(this.wifi.bssid, ctx.t + cooldownS);
    this.wifi = { ...this.wifi, net: null, bssid: null, phase: 'none', plan: [], validated: false, portal: false, handshake: null };
    this.tunnelOn.delete(pathId);
    this.onDisassociated(ctx, pathId, why);
  }

  /** the OS's own captive-portal check after DHCP (Infinet replaces it with a canary that runs with the probe) */
  protected osPortalCheck = true;
  /** round trips the tunnel check takes once a path answers (Infinet: probe + canaries in parallel) */
  protected checkRtts(_purpose: 'use' | 'check') { return 1; }

  protected onDisassociated(_ctx: Ctx, _pathId: string, _why: string) {}
  protected onJoinDone(_ctx: Ctx) {}

  protected progressJoin(ctx: Ctx) {
    const w = this.wifi;
    if (!w.net || w.phase === 'up' || w.phase === 'none') return;
    const path = ctx.paths.get(`wifi:${w.net}`);
    while (w.phase !== 'up' && ctx.t >= w.phaseEnd) {
      if (w.phase === 'portal') {
        w.portal = !!path?.captivePortal;
        w.validated = !w.portal && !!path && path.up && path.loss < 0.9;
      }
      if (w.phase === 'handshake') {
        w.handshake = this.handshakeOutcome(ctx, path);
        if (w.handshake === 'pass' && path) this.tunnelOn.set(path.id, { epoch: path.ipEpoch, readyAt: ctx.t });
      }
      const next = w.plan.shift();
      if (!next) {
        w.phase = 'up';
        if (!this.tunnel) w.handshake = null;
        this.onJoinDone(ctx);
        break;
      }
      w.phase = next[0];
      let dur = next[1];
      if (next[0] === 'handshake') {
        const answers = path && path.up && path.loss < 0.9 && !w.portal && !path.udpBlocked && !ctx.lab.anchorDown;
        const need = path ? (this.checkRtts(w.purpose) * rttOf(path, true) + v('handshakeExtraMs')) / 1000 : Infinity;
        const limit = probeTimeoutS(netOfPathKind(path));
        // a link slower than its own patience still counts as no answer (spec §2: timeouts scale with each link's delay)
        dur = answers ? Math.min(need, limit) : limit;
      }
      w.phaseEnd = ctx.t + dur;
    }
  }

  /** The anchor handshake through a path: pinned key, so a tampering network can't fake it. WireGuard drops
   *  packets that fail authentication silently; the probe client counts them ('authfail'). */
  handshakeOutcome(ctx: Ctx, path: PathTruth | undefined): 'pass' | 'authfail' | 'timeout' | 'portal' {
    if (!path || !path.up || path.loss >= 0.9) return 'timeout';
    if (path.captivePortal) return 'portal';
    if (path.udpBlocked || (this.tunnel && ctx.lab.anchorDown)) return 'timeout';
    if (path.attacker && ctx.lab.attackerMode === 'intercept') return 'authfail';
    if (path.kind === 'wifi' && rttOf(path, true) > probeTimeoutS(netOfPathKind(path)) * 1000) return 'timeout';
    return 'pass';
  }

  /** OS-level physics every policy is subject to: beacon loss. */
  protected osWifiPhysics(ctx: Ctx) {
    const w = this.wifi;
    if (!w.net || !ctx.radioTick) return;
    const path = ctx.paths.get(`wifi:${w.net}`);
    const assocLost = !path || !path.up || (path.rssiDbm ?? -200) < v('wifiAssocLostDbm');
    this.beaconMiss = assocLost ? this.beaconMiss + 1 : 0;
    if (this.beaconMiss >= v('beaconLossCount')) this.disassociate(ctx, 'beacon loss', 3);
    // in an ESS (several APs, same network), 802.11r fast transition keeps the association on the best AP
    if (w.net && path && w.phase === 'up') {
      const best = ctx.obs.scan.filter((e) => e.net === w.net).sort((a, b) => b.rssiDbm - a.rssiDbm)[0];
      if (best) w.bssid = best.bssid;
    }
  }

  measuredWifiRssi(ctx: Ctx): number {
    if (!this.wifi.net) return -200;
    let best = -200;
    for (const e of ctx.obs.scan) if (e.net === this.wifi.net) best = Math.max(best, e.rssiDbm);
    return best;
  }

  // ───────────── routing / sessions ─────────────
  pathUsable(ctx: Ctx, pathId: string): boolean {
    const p = ctx.paths.get(pathId);
    if (!p || !p.up) return false;
    if (isWifiPath(pathId)) {
      if (this.wifi.net !== netOf(pathId) || this.wifi.phase !== 'up') return false;
      if (!this.tunnel && !this.wifi.validated) return false;
    }
    if (this.tunnel) {
      if (ctx.lab.anchorDown) return false; // every tunnel ends at the anchor
      const tun = this.tunnelOn.get(pathId);
      if (!tun || tun.epoch !== p.ipEpoch || ctx.t < tun.readyAt) return false;
    }
    return true;
  }

  /** Move the voice call to another path. */
  steer(ctx: Ctx, to: string | null, opts: { dupWith?: string; dupS?: number } = {}) {
    if (to === this.route) return;
    const from = this.route;
    this.route = to;
    this.switches++;
    const p = to ? ctx.paths.get(to) : undefined;
    if (!this.tunnel) {
      this.reconnects++;
      this.sessionReadyAt = ctx.t + this.reconnectDelayS(ctx) + (p ? (v('reconnectRtts') * rttOf(p, false)) / 1000 : 0);
      this.routeEpoch = p?.ipEpoch ?? 0;
    } else if (to && p) {
      this.ensureTunnel(ctx, to);
    }
    if (opts.dupWith && opts.dupS) this.dup = { paths: [to!, opts.dupWith], until: ctx.t + opts.dupS };
    else this.dup = null;
    ctx.emit({ t: ctx.t, type: 'switch', from: from ?? '', to: to ?? '', fromLabel: from ? NET_LABEL[netOf(from)] ?? from : '', toLabel: to ? NET_LABEL[netOf(to)] ?? to : '', frozenMs: 0, policy: this.id });
  }

  /** (Re)establish the tunnel endpoint on a path: 1 RTT handshake (WireGuard/Noise-style, pinned anchor key). */
  ensureTunnel(ctx: Ctx, pathId: string) {
    const p = ctx.paths.get(pathId);
    if (!p) return;
    const cur = this.tunnelOn.get(pathId);
    if (cur && cur.epoch === p.ipEpoch) return;
    if (!p.up || p.loss >= 0.9) return; // retried every tick until the path answers
    if (ctx.lab.anchorDown || p.udpBlocked) return; // nobody answers
    if (p.attacker && ctx.lab.attackerMode === 'intercept') return; // handshake can never complete
    this.tunnelOn.set(pathId, { epoch: p.ipEpoch, readyAt: ctx.t + (rttOf(p, true) + v('handshakeExtraMs')) / 1000 });
  }

  /** App reconnect delay after a network change, no tunnel (fit to UMons iPhone measurements). */
  private reconnectDelayS(ctx: Ctx): number {
    const k = this.reconnectIdx++;
    const u = crn(ctx.seed, this.hid, k, 91);
    if (u < v('reconnectSlowShare')) {
      const [a, b] = v('reconnectSlowRangeS');
      return a + crn(ctx.seed, this.hid, k, 92) * (b - a);
    }
    const g = Math.sqrt(-2 * Math.log(Math.max(1e-12, crn(ctx.seed, this.hid, k, 93)))) * Math.cos(2 * Math.PI * crn(ctx.seed, this.hid, k, 94));
    return v('reconnectFastMedianS') * Math.exp(v('reconnectFastSigma') * g);
  }

  /** Non-tunnel sessions break when the public IP of the path changes (e.g. router failover). */
  protected sessionPhysics(ctx: Ctx) {
    if (!this.route) return;
    const p = ctx.paths.get(this.route);
    if (!p) return;
    if (!this.tunnel) {
      if (p.ipEpoch !== this.routeEpoch) {
        this.routeEpoch = p.ipEpoch;
        this.reconnects++;
        this.sessionReadyAt = ctx.t + this.reconnectDelayS(ctx) + (v('reconnectRtts') * rttOf(p, false)) / 1000;
      }
    } else {
      // anchor down: every tunnel is gone and is handshaken again once the anchor answers
      if (ctx.lab.anchorDown) { this.tunnelOn.clear(); return; }
      this.ensureTunnel(ctx, this.route);
      if (this.dup) for (const d of this.dup.paths) this.ensureTunnel(ctx, d);
    }
  }

  // ───────────── voice ─────────────
  tick(ctx: Ctx) {
    this.progressJoin(ctx);
    this.osWifiPhysics(ctx);
    this.decide(ctx);
    this.sessionPhysics(ctx);
    if (this.dup && ctx.t >= this.dup.until) this.dup = null;
  }

  isAdmissible(_ctx: Ctx, _pathId: string): boolean { return true; }

  sendFrame(ctx: Ctx, seq: number) {
    const paths = this.dup ? this.dup.paths : this.route ? [this.route] : [];
    let arr = Infinity;
    let copies = 0;
    const ready = ctx.t >= this.sessionReadyAt;
    for (let i = 0; i < paths.length; i++) {
      const pid = paths[i];
      if (!ready || !this.pathUsable(ctx, pid)) continue;
      const p = ctx.paths.get(pid)!;
      if (!this.isAdmissible(ctx, pid)) this.invariantViolations++;
      copies++;
      if (p.attacker) { this.fakeFrames++; if (!this.tunnel) this.fakePlainFrames++; }
      const o = samplePacket(ctx.seed, p, seq, this.tunnel);
      const a = ctx.t + o.delayMs / 1000;
      if (a < arr) arr = a;
      if (seq % v('packetSample') === 0) {
        ctx.recordPacket({ id: seq * 8 + i, policy: this.id, path: pid, t0: ctx.t, t1: o.lost ? ctx.t + Math.min(0.05, p.owdMs / 1000) : a, lost: o.lost, late: false, dup: paths.length > 1, sealed: this.tunnel });
      }
    }
    this.framesSent++;
    if (copies > 1) this.extraCopies += copies - 1;
    if (this.redundancy && copies > 0) this.extraCopies++;
    this.rx.push(seq, ctx.t, arr);
    if (this.redundancy && arr < Infinity) this.rx.redundant(seq - 1, arr);
    this.onFrame(ctx, arr === Infinity ? Infinity : (arr - ctx.t) * 1000);
  }

  /** hook: relative one-way transit of this frame as the receiver will measure it (ms; Infinity if lost) */
  protected onFrame(_ctx: Ctx, _transitMs: number) {}

  recentLoss(t: number, windowS: number): number {
    const o = this.rx.outcomes;
    let n = 0, miss = 0;
    for (let i = o.length - 1; i >= 0 && o[i].t >= t - windowS; i--) { n++; if (o[i].o !== 'played') miss++; }
    return n >= 10 ? miss / n : 0;
  }

  laneState(ctx: Ctx): LaneState {
    if (this.rx.consecMiss * v('frameS') * 1000 >= v('frozenMinMs')) return this.rx.dropped ? 'dropped' : 'frozen';
    const tun = this.route ? this.tunnelOn.get(this.route) : undefined;
    if (this.dup || (this.tunnel && tun && ctx.t < tun.readyAt)) return 'handover';
    if (this.checking) return 'checking';
    if (this.recentLoss(ctx.t, 1) >= 0.05) return 'weak';
    if (this.route && isWifiPath(this.route) && this.measuredWifiRssi(ctx) < v('wifiDataDbm')) return 'weak';
    return 'live';
  }

  routeLabel(ctx: Ctx): string {
    if (!this.route) return 'No network';
    const net = netOf(this.route);
    if (net === 'site-net') {
      const up = ctx.paths.get(this.route)?.uplink;
      return `Site Wi-Fi · ${up === 'GEO' ? 'GEO satellite' : up === 'LEO' ? 'LEO satellite' : 'no uplink'}`;
    }
    return NET_LABEL[net] ?? this.route;
  }

  routeChecked(_ctx: Ctx): boolean { return false; }
}
