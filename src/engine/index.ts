/**
 * Infinet simulation engine. Pure TypeScript: no three, react or DOM (plan rule 3).
 *   createSim(scenario, seed) → Sim
 * The same engine drives the live demo (browser) and the batch experiments (Node).
 */
import { v } from './params';
import { Rng } from './rng';
import {
  DEFAULT_LAB, LIVE_POLICIES, POLICY_LABEL, type LabState, type LinkView, type PacketVis, type PlayerInput, type PolicyId,
  type PolicyView, type ScanEntry, type ScenarioId, type SimEvent, type SimSnapshot, type Vec2, type ZoneId,
} from './types';
import { LAYOUT, regionAt, txById, zoneAt, type Transmitter } from './world/layout';
import { buildMaps, cellTruthAt, detWifi, type MapSet } from './maps/rfmaps';
import { sinrDb } from './radio/propagation';
import { nrLossFromSinr, SatelliteState, wifiLossFromSnr, wifiRetryDelayMs, type PathTruth } from './links/paths';
import { FastFading, PositionEstimate, type CellMeas, type Observations } from './observe/observe';
import { Agent, NET_LABEL, netOf, type Ctx } from './policies/agent';
import { B1, B2, B3 } from './policies/baselines';
import { Infinet } from './policies/infinet';
import { RouteFollower, routeFor, SCENARIOS, type Scenario } from './scenario/scenarios';

export * from './types';
export { PARAMS, VISUAL_NOTES } from './params';
export { SCENARIOS, MUST_SCENARIOS } from './scenario/scenarios';
export { LAYOUT } from './world/layout';
export { geoLookAngle } from './geo';

export interface SimOptions {
  policies?: PolicyId[];
  lab?: Partial<LabState>;
  /** run the scenario's prewarm (e.g. 40 s at the desert site) immediately */
  prewarm?: boolean;
  /** live = player input from the front end; scripted = route follower */
  mode?: 'live' | 'scripted';
  /** batch randomisation: extra delay before the walk starts */
  startOffsetS?: number;
}

export interface PolicyResult {
  policy: PolicyId;
  frozenS: number;
  longestFrozenS: number;
  frozenCount: number;
  voiceLostPct: number;
  latePct: number;
  mosMean: number;
  mosMin5: number;
  survived: boolean;
  fakeAdmissionFrames: number;
  fakePlainFrames: number;
  invariantViolations: number;
  wronglyBlocked: number;
  dupExtraPct: number;
  falseDead: number;
  switches: number;
  predLeadS?: number;
  predErrS?: number;
}

export interface Sim {
  readonly seed: number;
  readonly scenario: ScenarioId;
  readonly t: number;
  advance(dtSim: number, player?: PlayerInput): void;
  snapshot(): SimSnapshot;
  eventsSince(cursor: number): { events: SimEvent[]; cursor: number };
  setLab(lab: Partial<LabState>): void;
  results(): PolicyResult[];
  runToEnd(): PolicyResult[];
  readonly durationS: number;
  readonly scenarioDef: Scenario | null;
  /** renderer: best Wi-Fi signal at p, from Infinet's coverage map (belief) or the simulated truth */
  wifiCoverage(p: Vec2, which: 'belief' | 'truth'): { dbm: number; txId: string | null };
  /** renderer: best 5G RSRP at p (dBm, incl. indoor loss), from Infinet's map (belief) or the simulated truth */
  cellCoverage(p: Vec2, which: 'belief' | 'truth'): { dbm: number; txId: string | null };
  /** bumped whenever the maps are rebuilt (map staleness change) */
  readonly mapsVersion: number;
  /** scripted position (tour/batch) at the current time */
  scriptedPlayer(): { pos: Vec2; vel: Vec2; headingDeg: number; done: boolean } | null;
}

const TWIN_UPLINK_OWD_MS = 25; // ASSUMPTION: attacker bridges to their own tethered LTE uplink
const DEAUTH_PERIOD_S = 2;     // ASSUMPTION: forged disconnects every 2 s while the attack runs

class SimImpl implements Sim {
  readonly seed: number;
  readonly scenario: ScenarioId;
  readonly scenarioDef: Scenario | null;
  t = 0;
  private acc = 0;
  private frameSeq = 0;
  private nextFrameT = 0;
  private nextRadioT = 0;
  private lab: LabState;
  private maps: MapSet;
  private sat: SatelliteState;
  private fading: FastFading;
  private posEst: PositionEstimate;
  private agents: Agent[];
  private infinet: Infinet | null;
  private events: SimEvent[] = [];
  private paths = new Map<string, PathTruth>();
  private obs: Observations;
  private firstSeen = new Map<string, number>();
  private player: PlayerInput;
  private follower: RouteFollower | null;
  private mode: 'live' | 'scripted';
  private attacker = { on: false, startT: 0, eirp: 20, lastDeauth: -100, mode: 'intercept' as 'intercept' | 'relay' };
  private region: string | null = null;
  private pendingTriggers: Array<{ at: number; do: string }> = [];
  private firedTriggers = new Set<string>();
  private packets: PacketVis[] = [];
  private cellMeasState = new Map<string, number>();
  readonly durationS: number;
  private lastMosSample = 0;
  mapsVersion = 0;

  constructor(scenario: ScenarioId, seed: number, opts: SimOptions = {}) {
    this.seed = seed;
    this.scenario = scenario;
    this.scenarioDef = scenario === 'free' ? null : SCENARIOS[scenario];
    this.lab = { ...DEFAULT_LAB, ...(this.scenarioDef ? { baseline: this.scenarioDef.defaultBaseline } : {}), ...opts.lab };
    this.maps = buildMaps(seed, this.lab.mapStaleness);
    this.sat = new SatelliteState(seed);
    this.fading = new FastFading(seed);
    this.posEst = new PositionEstimate(seed);
    this.mode = opts.mode ?? 'scripted';
    const def = this.scenarioDef ?? SCENARIOS['building-exit'];
    this.durationS = def.durationS;
    this.follower = routeFor(def, this.lab.walkSpeed);
    if (opts.startOffsetS) this.follower.startT += opts.startOffsetS;
    const at0 = this.follower.at(0);
    this.player = { pos: at0.pos, vel: [0, 0], headingDeg: at0.headingDeg };

    const ids = opts.policies ?? LIVE_POLICIES;
    this.agents = ids.map((id) => makeAgent(id, seed));
    this.infinet = (this.agents.find((a) => a.id === 'infinet') as Infinet) ?? null;

    this.obs = { t: 0, scan: [], byBssid: new Map(), cell: new Map(), pos: this.player.pos, firstSeen: this.firstSeen };
    this.radioTick();
    const ctx = this.ctx(true);
    for (const a of this.agents) {
      a.initOn(ctx, def.init.route, def.init.wifi);
      if (a instanceof Infinet) a.preTrust(ctx, def.init.infinetTrusted);
    }
    for (const ev of def.events) if (ev.when.at !== undefined) this.pendingTriggers.push({ at: ev.when.at, do: ev.do });
    this.region = regionAt(this.player.pos);
    if (opts.prewarm && def.prewarmS > 0) this.advanceScripted(def.prewarmS);
  }

  // ───────────── public API ─────────────
  advance(dtSim: number, player?: PlayerInput) {
    if (player) { this.player = player; this.mode = 'live'; }
    this.acc += Math.max(0, Math.min(dtSim, 1.0));
    const step = v('stepS');
    while (this.acc >= step) {
      this.acc -= step;
      this.step();
    }
  }

  private advanceScripted(dt: number) {
    const step = v('stepS');
    const n = Math.round(dt / step);
    for (let i = 0; i < n; i++) this.step();
  }

  scriptedPlayer() {
    return this.follower ? this.follower.at(this.t) : null;
  }

  runToEnd(): PolicyResult[] {
    this.advanceScripted(this.durationS - this.t);
    return this.results();
  }

  setLab(lab: Partial<LabState>) {
    const prevStale = this.lab.mapStaleness;
    this.lab = { ...this.lab, ...lab };
    if (lab.mapStaleness !== undefined && lab.mapStaleness !== prevStale) { this.maps = buildMaps(this.seed, this.lab.mapStaleness); this.mapsVersion++; }
    if (lab.walkSpeed !== undefined && this.follower) this.follower.speed = lab.walkSpeed;
    if (lab.attackerEnabled === false) this.attacker.on = false;
    if (lab.attackerEnabled === true && !this.attacker.on && this.firedTriggers.has('attacker.start')) this.startAttacker();
    if (lab.attackerOffsetDb !== undefined && this.attacker.on) this.attacker.eirp = this.twinEirp();
    if (lab.attackerMode) this.attacker.mode = lab.attackerMode;
  }

  wifiCoverage(p: Vec2, which: 'belief' | 'truth') {
    let dbm = -200, txId: string | null = null;
    for (const m of this.maps.byTx.values()) {
      if (m.tx.kind !== 'wifi') continue;
      let eirp = m.tx.eirpDbm ?? 20;
      if (m.tx.attacker) {
        if (which === 'belief' || !this.attacker.on) continue;
        eirp = this.attacker.eirp;
      }
      const g = which === 'belief' ? m.belief : m.truth;
      if (!g || !g.contains(p)) continue;
      const s = eirp + g.sample(p);
      if (s > dbm) { dbm = s; txId = m.tx.id; }
    }
    return { dbm, txId };
  }

  cellCoverage(p: Vec2, which: 'belief' | 'truth') {
    let dbm = -200, txId: string | null = null;
    for (const m of this.maps.byTx.values()) {
      if (m.tx.kind !== 'cell') continue;
      const g = which === 'belief' && m.belief ? m.belief : null;
      const v = g && g.contains(p) ? g.sample(p) : cellTruthAt(m, p).rsrp;
      if (v > dbm) { dbm = v; txId = m.tx.id; }
    }
    return { dbm, txId };
  }

  eventsSince(cursor: number) {
    return { events: this.events.slice(cursor), cursor: this.events.length };
  }

  // ───────────── core loop ─────────────
  private step() {
    this.t += v('stepS');
    const t = this.t;
    if (this.mode === 'scripted' && this.follower) {
      const p = this.follower.at(t);
      this.player = { pos: p.pos, vel: p.vel, headingDeg: p.headingDeg };
    }
    let radio = false;
    if (t >= this.nextRadioT - 1e-9) {
      this.nextRadioT += v('radioTickS');
      this.radioTick();
      radio = true;
    }
    if (t >= this.nextFrameT - 1e-9) {
      this.nextFrameT += v('frameS');
      const ctx = this.ctx(radio);
      for (const a of this.agents) a.tick(ctx);
      const seq = this.frameSeq++;
      for (const a of this.agents) a.sendFrame(ctx, seq);
      for (const a of this.agents) {
        a.rx.reveal(t);
        const st = a.laneState(ctx);
        a.lane.update(t, st, a.routeLabel(ctx), a.routeChecked(ctx));
      }
      if (t - this.lastMosSample >= 0.1) {
        this.lastMosSample = t;
        if (t > 1) for (const a of this.agents) a.rx.sampleMos();
      }
      if (this.infinet?.pendingSwitchReport && t >= this.infinet.pendingSwitchReport.at) {
        const r = this.infinet.pendingSwitchReport;
        this.infinet.pendingSwitchReport = null;
        this.emit({ t, type: 'switch.done', to: r.to, toLabel: NET_LABEL[netOf(r.to)] ?? r.to, frozenMs: Math.round((this.infinet.rx.frozenS - r.frozenBefore) * 1000), policy: 'infinet' });
      }
      const cut = t - 4;
      if (this.packets.length > 400 || (this.packets.length && this.packets[0].t1 < cut)) this.packets = this.packets.filter((p) => p.t1 >= cut);
    }
  }

  private ctx(radioTick: boolean): Ctx {
    return {
      t: this.t, seed: this.seed, lab: this.lab, paths: this.paths, obs: this.obs, maps: this.maps, truthPos: this.player.pos,
      emit: (e) => this.emit(e), recordPacket: (p) => this.packets.push(p), radioTick,
    };
  }

  private emit(e: SimEvent) {
    this.events.push(e);
  }

  // ───────────── truth → paths, observations ─────────────
  private twinEirp(): number {
    // Lab "power offset": how much stronger the copy is than the real café AP at the victim's seat.
    const seat = LAYOUT.routes['cafe-twin'][LAYOUT.routes['cafe-twin'].length - 1];
    const real = detWifi(txById('ap-cafe'), 'truth').sample(seat);
    const twin = detWifi(txById('twin'), 'truth').sample(seat);
    return (txById('ap-cafe').eirpDbm ?? 20) + this.lab.attackerOffsetDb - (twin - real);
  }

  private startAttacker() {
    this.attacker.on = true;
    this.attacker.startT = this.t;
    this.attacker.mode = this.lab.attackerMode;
    this.attacker.eirp = this.twinEirp();
    this.attacker.lastDeauth = this.t - DEAUTH_PERIOD_S + 0.6;
    this.emit({ t: this.t, type: 'attacker.start', ssid: 'Cafe_Guest', mode: this.lab.attackerMode, offsetDb: this.lab.attackerOffsetDb });
  }

  private triggers() {
    const reg = regionAt(this.player.pos);
    if (reg !== this.region) {
      if (this.region) this.emit({ t: this.t, type: 'region.exit', region: this.region });
      if (reg) this.emit({ t: this.t, type: 'region.enter', region: reg });
      this.region = reg;
      if (reg === 'cafe' && !this.firedTriggers.has('cafe-enter')) {
        this.firedTriggers.add('cafe-enter');
        this.pendingTriggers.push({ at: this.t + 4, do: 'attacker.start' });
      }
    }
    for (const tr of this.pendingTriggers) {
      if (this.t >= tr.at && !this.firedTriggers.has(`${tr.do}@${tr.at}`)) {
        this.firedTriggers.add(`${tr.do}@${tr.at}`);
        if (tr.do === 'attacker.start' && !this.firedTriggers.has('attacker.start')) {
          this.firedTriggers.add('attacker.start');
          if (this.lab.attackerEnabled) this.startAttacker();
        }
        if (tr.do === 'leo.outage') this.setLab({ leoOutage: true });
      }
    }
  }

  private radioTick() {
    const t = this.t;
    const pos = this.player.pos;
    this.triggers();
    this.sat.update(t, this.lab, (e) => this.emit(e));
    // deauth: forged disconnects against the real café AP's clients (open network, no PMF → possible; trap #5)
    if (this.attacker.on && this.lab.deauth && t - this.attacker.lastDeauth >= DEAUTH_PERIOD_S) {
      this.attacker.lastDeauth = t;
      const realPmf = txById('ap-cafe').pmf;
      if (realPmf !== 'required') {
        const ctx = this.ctx(false);
        for (const a of this.agents) if (a.wifi.net === 'cafe-guest') a.disassociate(ctx, 'deauth', 0);
      }
    }

    const noise = v('wifiNoiseFloorDbm');
    const scan: ScanEntry[] = [];
    const bestByNet = new Map<string, { rssi: number; tx: Transmitter }>();
    for (const m of this.maps.byTx.values()) {
      const tx = m.tx;
      if (tx.kind !== 'wifi') continue;
      if (tx.attacker && !this.attacker.on) continue;
      const eirp = tx.attacker ? this.attacker.eirp : tx.eirpDbm ?? 20;
      const truth = m.truth.sample(pos, -250) + eirp;
      if (truth < -150) continue;
      const prev = bestByNet.get(tx.net);
      if (!prev || truth > prev.rssi) bestByNet.set(tx.net, { rssi: truth, tx });
      const meas = truth + this.fading.next(tx.id);
      if (meas > -92) {
        if (!this.firstSeen.has(tx.bssid!)) this.firstSeen.set(tx.bssid!, t);
        scan.push({ bssid: tx.bssid!, ssid: tx.ssid!, net: tx.net, security: tx.security!, pmf: tx.pmf ?? 'none', channel: tx.channel ?? 36, band: tx.band ?? '5', rssiDbm: meas });
      }
    }
    const byBssid = new Map(scan.map((e) => [e.bssid, e] as const));

    // Wi-Fi paths
    const paths = new Map<string, PathTruth>();
    for (const [net, { rssi, tx }] of bestByNet) {
      const snr = rssi - noise;
      let loss = wifiLossFromSnr(snr);
      let owd = v('wifiRadioOwdMs') + wifiRetryDelayMs(snr);
      let jitter = v('wifiJitterMs');
      const hops = [{ name: 'Radio (Wi-Fi)', owdMs: owd }];
      let uplink: PathTruth['uplink'];
      let ipEpoch = 0;
      if (net === 'office-corp') {
        hops.push({ name: 'Fibre to comms room', owdMs: v('officeLanOwdMs') }, { name: 'Office ISP', owdMs: v('officeWanOwdMs') });
        owd += v('officeLanOwdMs') + v('officeWanOwdMs');
      } else if (net === 'cafe-guest') {
        owd += v('cafeAirtimeExtraMs');
        jitter += v('cafeAirtimeJitterMs');
        loss += v('cafeAirtimeLoss');
        hops[0].owdMs += v('cafeAirtimeExtraMs');
        hops.push({ name: 'Café broadband', owdMs: v('cafeBackhaulOwdMs') });
        owd += v('cafeBackhaulOwdMs');
      } else if (net === 'twin') {
        hops.push({ name: "Attacker's laptop → own uplink", owdMs: TWIN_UPLINK_OWD_MS });
        owd += TWIN_UPLINK_OWD_MS;
        jitter += 6;
      } else if (net === 'site-net') {
        const u = this.sat.uplinkNow(t);
        uplink = this.sat.uplink;
        ipEpoch = this.sat.ipEpoch;
        if (uplink === 'none') loss = 1;
        else {
          loss = Math.min(1, loss + u.loss);
          jitter += u.jitterMs;
          hops.push({ name: uplink === 'LEO' ? 'LEO satellite (bent pipe)' : 'GEO satellite (bent pipe)', owdMs: u.owdMs }, { name: 'Ground station / PoP', owdMs: v('leoPopOwdMs') });
          owd += u.owdMs + v('leoPopOwdMs');
        }
      }
      hops.push({ name: 'Internet to the far end', owdMs: v('internetOwdMs') });
      owd += v('internetOwdMs');
      paths.set(`wifi:${net}`, {
        id: `wifi:${net}`, kind: 'wifi', label: NET_LABEL[net] ?? net, up: rssi > -92, owdMs: owd, jitterMs: jitter, loss: Math.min(1, loss), hops,
        rssiDbm: rssi, snrDb: snr, ipEpoch, uplink, attacker: !!tx.attacker, captivePortal: !!tx.captivePortal, security: tx.security,
      });
    }

    // cellular paths + measurements
    const cell = new Map<string, CellMeas>();
    for (const m of this.maps.byTx.values()) {
      const tx = m.tx;
      if (tx.kind !== 'cell') continue;
      const { rsrp, o2i } = cellTruthAt(m, pos);
      const sinr = sinrDb(rsrp, o2i);
      const loss = rsrp < -125 ? 1 : nrLossFromSinr(sinr);
      const owd = v('nrRadioOwdMs') + v('nrCoreOwdMs') + v('internetOwdMs') + (sinr < 3 ? 8 * (3 - sinr) / 3 : 0);
      paths.set(`cell:${tx.net}`, {
        id: `cell:${tx.net}`, kind: 'cell', label: NET_LABEL[tx.net] ?? tx.net, up: rsrp > -125, owdMs: owd, jitterMs: v('nrJitterMs'), loss, ipEpoch: 0,
        hops: [{ name: 'Radio (5G NR)', owdMs: v('nrRadioOwdMs') }, { name: 'Operator core', owdMs: v('nrCoreOwdMs') }, { name: 'Internet to the far end', owdMs: v('internetOwdMs') }],
        rsrpDbm: rsrp, sinrDb: sinr,
      });
      const key = tx.net;
      const f = this.fading.next(`cell:${key}`, 2);
      this.cellMeasState.set(key, f);
      cell.set(key, { net: key, rsrpDbm: rsrp + f, sinrDb: sinr + f * 0.5, attached: rsrp > -122 });
    }
    this.paths = paths;
    this.obs = { t, scan, byBssid, cell, pos: this.posEst.next(pos), firstSeen: this.firstSeen };

    // prediction lead-time bookkeeping (truth crossing of −75 dBm after each Infinet switch away from Wi-Fi)
    for (const a of this.agents) {
      if (!(a instanceof Infinet)) continue;
      for (const pl of a.predLog as Array<{ switchT: number; predictedCrossT?: number; net: string; truthCrossT?: number }>) {
        if (pl.truthCrossT !== undefined || t > pl.switchT + 15) continue;
        const rssi = bestByNet.get(pl.net)?.rssi ?? -200;
        if (rssi < v('wifiDataDbm')) pl.truthCrossT = t;
      }
    }
  }

  // ───────────── outputs ─────────────
  snapshot(): SimSnapshot {
    const ctx = this.ctx(false);
    const links: LinkView[] = [...this.paths.values()].map((p) => ({
      id: p.id, kind: p.id === 'wifi:site-net' ? 'sat' : p.kind, label: p.label, up: p.up, rssiDbm: p.rssiDbm, rsrpDbm: p.rsrpDbm, sinrDb: p.sinrDb, snrDb: p.snrDb,
      rttMs: 2 * p.owdMs, lossPct: 100 * p.loss, jitterMs: p.jitterMs, hops: p.hops, uplink: p.uplink,
    }));
    const policies: Record<string, PolicyView> = {};
    for (const a of this.agents) {
      const w = a.rx.windowMos();
      policies[a.id] = {
        id: a.id,
        activePath: a.route,
        activeLabel: a.routeLabel(ctx),
        checked: a.routeChecked(ctx),
        mode: a.dup ? 'duplicate' : 'single',
        frozen: a.rx.consecMiss * v('frameS') * 1000 >= v('frozenMinMs'),
        callState: a.rx.dropped && a.rx.consecMiss > 10 ? 'dropped' : a.rx.consecMiss * v('frameS') * 1000 >= v('frozenMinMs') ? 'frozen' : a.dup ? 'handover' : 'live',
        metrics: {
          frozenS: a.rx.frozenS, longestFrozenS: a.rx.longestFrozenS, frozenCount: a.rx.frozenCount,
          voiceLostPct: a.rx.frames ? (100 * a.rx.notPlayed) / a.rx.frames : 0,
          mos: w.mos, mosMean: a.rx.mosN ? a.rx.mosSum / a.rx.mosN : w.mos, callDropped: a.rx.dropped,
          fakeAdmissions: a.fakeFrames, dupExtraPct: a.framesSent ? (100 * a.extraCopies) / a.framesSent : 0,
        },
        laneSegments: a.lane.segments,
        wifiAssoc: a.wifi.net,
        wifiBssid: a.wifi.bssid,
        dupPaths: a.dup ? [...a.dup.paths] : [],
        joinPhase: a.wifi.phase,
        tunnel: a.tunnel,
        playoutMs: a.rx.P,
        mouthToEarMs: w.m2eMs,
        falseDead: a.falseDead,
      };
    }
    const inf = this.infinet;
    const trust: Record<string, any> = {};
    if (inf) for (const [k, tv] of inf.trust) trust[k] = tv;
    const pathRtts: Record<string, number[]> = {};
    if (inf) for (const p of this.paths.keys()) { const s = inf.rttTrace(p); if (s.length) pathRtts[p] = s; }
    const leoW = this.sat.windowAt(this.t);
    return {
      t: this.t, seed: this.seed, scenario: this.scenario, zone: zoneAt(this.player.pos) as ZoneId,
      player: { pos: this.player.pos, vel: this.player.vel, headingDeg: this.player.headingDeg },
      links, scan: this.obs.scan, policies,
      infinet: {
        ttlS: inf?.last.ttlS, ttlMapS: inf?.last.ttlMapS, ttlTrendS: inf?.last.ttlTrendS, ttlConfidence: inf?.last.confidence,
        edgePoint: inf?.last.ttlS !== undefined ? inf?.last.edgePoint : undefined, forecast: inf?.forecastPts() ?? [],
        candidate: inf?.candidate ?? undefined, candidateState: inf?.candidateState, trust, pathRtts,
        leoPattern: inf?.pattern ? { ...inf.pattern, nextSpikeT: inf.leo.nextSpike(this.t), protecting: inf.redundancy } : undefined,
        satPatient: inf?.satPatience(ctx),
      },
      packets: this.packets,
      truth: {
        attackerPos: this.attacker.on ? [txById('twin').pos[0], txById('twin').pos[1]] : undefined,
        attackerOn: this.attacker.on, attackerMode: this.attacker.mode,
        uplink: this.sat.uplink, leoOutage: this.lab.leoOutage, routerFailoverAt: this.sat.failoverAt ?? undefined,
        leoBoundaryPhase: this.sat.boundaryPhase(this.t), leoSpikeActive: !!leoW, leoSatIndex: this.sat.satIndex,
      },
      lab: this.lab,
      region: this.region,
    };
  }

  results(): PolicyResult[] {
    return this.agents.map((a) => {
      const r: PolicyResult = {
        policy: a.id,
        frozenS: a.rx.frozenS,
        longestFrozenS: a.rx.longestFrozenS,
        frozenCount: a.rx.frozenCount,
        voiceLostPct: a.rx.frames ? (100 * a.rx.notPlayed) / a.rx.frames : 0,
        latePct: a.rx.frames ? (100 * a.rx.lateFrames) / a.rx.frames : 0,
        mosMean: a.rx.mosN ? a.rx.mosSum / a.rx.mosN : 0,
        mosMin5: a.rx.minMos5,
        survived: !a.rx.dropped,
        fakeAdmissionFrames: a.fakeFrames,
        fakePlainFrames: a.fakePlainFrames,
        invariantViolations: a.invariantViolations,
        wronglyBlocked: a.wronglyBlocked,
        dupExtraPct: a.framesSent ? (100 * a.extraCopies) / a.framesSent : 0,
        falseDead: a.falseDead,
        switches: a.switches,
      };
      if (a instanceof Infinet) {
        const logs = (a.predLog as Array<{ switchT: number; predictedCrossT?: number; truthCrossT?: number }>).filter((l) => l.truthCrossT !== undefined);
        if (logs.length) {
          r.predLeadS = logs.reduce((s, l) => s + (l.truthCrossT! - l.switchT), 0) / logs.length;
          const withPred = logs.filter((l) => l.predictedCrossT !== undefined);
          if (withPred.length) r.predErrS = withPred.reduce((s, l) => s + (l.predictedCrossT! - l.truthCrossT!), 0) / withPred.length;
        }
      }
      return r;
    });
  }
}

function makeAgent(id: PolicyId, seed: number): Agent {
  switch (id) {
    case 'b1': return new B1(seed);
    case 'b2': return new B2(seed);
    case 'b3': return new B3(seed);
    case 'infinet': return new Infinet(seed);
    case 'infinet-noPredict': return new Infinet(seed, id, { predict: false, trust: true });
    case 'infinet-noTrust': return new Infinet(seed, id, { predict: true, trust: false });
  }
}

export function createSim(scenario: ScenarioId, seed: number, opts: SimOptions = {}): Sim {
  return new SimImpl(scenario, seed, opts);
}

export { POLICY_LABEL, Rng };
