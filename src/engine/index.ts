/**
 * Infinet simulation engine. Pure TypeScript: no three, react or DOM (plan rule 3).
 *   createSim(scenario, seed) → Sim
 * The same engine drives the live demo (browser) and the batch experiments (Node).
 */
import { v } from './params';
import { crn, hashString, Rng } from './rng';
import {
  DEFAULT_LAB, LIVE_POLICIES, POLICY_LABEL, type LabState, type LinkView, type PacketVis, type PlayerInput, type PolicyId,
  type PolicyView, type ScanEntry, type ScenarioId, type SimEvent, type SimSnapshot, type Vec2, type ZoneId,
} from './types';
import { LAYOUT, regionAt, txById, zoneAt, type Transmitter } from './world/layout';
import { VENUE } from './world/venue';
import { buildMaps, cellTruthAt, detWifi, type MapSet } from './maps/rfmaps';
import { sinrDb } from './radio/propagation';
import { nrLossFromSinr, SatelliteState, wifiLossFromSnr, wifiRetryDelayMs, type PathTruth } from './links/paths';
import { FastFading, PositionEstimate, type CellMeas, type Observations } from './observe/observe';
import { Agent, NET_LABEL, netOf, setMobileWord, type Ctx } from './policies/agent';
import { B1, B2, B3 } from './policies/baselines';
import { Infinet } from './policies/infinet';
import { RouteFollower, routeFor, SCENARIOS, type Scenario } from './scenario/scenarios';
import { utf8Hex } from './trust/trust';
import type { LinkType, Security } from './types';

export * from './types';
export { PARAMS, VISUAL_NOTES } from './params';
export { SCENARIOS, MUST_SCENARIOS } from './scenario/scenarios';
export { LAYOUT } from './world/layout';
export { registerVenue, hasVenue, VENUE, type HallArt, type VenueFile, type VenuePlan } from './world/venue';
export { geoLookAngle } from './geo';
export { displayName, skeleton, utf8Hex, redFlags, screen, decideTier } from './trust/trust';
export { mobileWord } from './policies/agent';

/** One network from the live hotspot scanner (spec §6), already cleaned by the scanner: raw name as hex, display
 *  name sanitised, other people's networks anonymised (no name, salted-hash BSSID). */
export interface LiveEntry {
  bssid: string; ssidHex: string; ssid: string; security: Security; channel: number; band: '2.4' | '5'; rssiDbm: number; anon: boolean;
}

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
  /** spec §2 metrics (Infinet): copies that became Trusted or Tunnel only, genuine networks left Unreachable, time to verdict */
  fakeAccepted?: number;
  realUnreachable?: number;
  verdictMs?: Partial<Record<LinkType, { mean: number; worst: number; n: number }>>;
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
  /** live hotspot scanner input: the latest scan (2 Hz at most). New networks are placed where the walker is. */
  setLiveScan(entries: LiveEntry[]): void;
}

const TWIN_UPLINK_OWD_MS = 25; // ASSUMPTION: attacker bridges to their own tethered LTE uplink
const DEAUTH_PERIOD_S = 2;     // ASSUMPTION: forged disconnects every 2 s while the attack runs
const LAB_ATTACKS = [['beaconFlood', 'beacon-flood'], ['uplinkFlood', 'uplink-flood'], ['siteTwin', 'site-copy']] as const;
const hx = (n: number) => (n & 255).toString(16).padStart(2, '0');

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
  /** Lab "beacon flood": where the flooding device sits and which fake BSSIDs are on the air right now */
  private flood = { placed: false, pos: [0, 0] as Vec2, startT: 0, shown: new Set<string>() };
  private region: string | null = null;
  private pendingTriggers: Array<{ at: number; do: string }> = [];
  private firedTriggers = new Set<string>();
  private packets: PacketVis[] = [];
  private cellMeasState = new Map<string, number>();
  readonly durationS: number;
  private lastMosSample = 0;
  mapsVersion = 0;
  private live = new Map<string, { e: LiveEntry; pos: Vec2; lastT: number }>();
  private liveBatches = 0;
  private ssidHexCache = new Map<string, string>();

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
    setMobileWord(LAYOUT.transmitters.some((t) => t.kind === 'cell' && t.zone === def.zone && t.rat === 'LTE') ? '4G' : '5G');
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
    const prev = this.lab;
    const prevStale = this.lab.mapStaleness;
    this.lab = { ...this.lab, ...lab };
    for (const net of lab.signedIn ?? []) if (!(prev.signedIn ?? []).includes(net)) this.emit({ t: this.t, type: 'portal.signin', net, label: NET_LABEL[net] ?? net });
    for (const [k, attack] of LAB_ATTACKS) {
      if (lab[k] !== undefined && lab[k] !== prev[k]) this.emit({ t: this.t, type: lab[k] ? 'attack.on' : 'attack.off', attack });
    }
    if (lab.beaconFlood === false) this.stopFlood();
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
      if (m.tx.attacker && (which === 'belief' || !this.txOn(m.tx))) continue;
      const eirp = this.txEirp(m.tx);
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

  setLiveScan(entries: LiveEntry[]) {
    const first = this.liveBatches++ === 0;
    const h = (this.player.headingDeg * Math.PI) / 180;
    // placed beside the walker where it was first heard (2.5 m to the right, spread so dots don't stack)
    for (const e of entries.slice(0, 256)) {
      const cur = this.live.get(e.bssid);
      if (cur) { cur.e = e; cur.lastT = this.t; continue; }
      const k = this.live.size;
      const side = 2.5 + (k % 4) * 1.2, along = (Math.floor(k / 4) % 5) * 1.5 - 3;
      const pos: Vec2 = [this.player.pos[0] + Math.cos(h) * side + Math.sin(h) * along, this.player.pos[1] - Math.sin(h) * side + Math.cos(h) * along];
      this.live.set(e.bssid, { e, pos, lastT: this.t });
      // the first scan after connecting is what was already around: it doesn't count as new names for the flood alert
      this.firstSeen.set(e.bssid, first ? -1e9 : this.t);
    }
    for (const [b, x] of this.live) if (this.t - x.lastT > 12) this.live.delete(b);
  }

  /** the live entries as scan results (no simulated path: they are only screened) */
  liveScan(): ScanEntry[] {
    const out: ScanEntry[] = [];
    for (const [b, x] of this.live) {
      out.push({ bssid: b, ssid: x.e.anon ? '' : x.e.ssid, ssidHex: x.e.anon ? '' : x.e.ssidHex, net: `live:${b}`, security: x.e.security, pmf: 'none',
        channel: x.e.channel, band: x.e.band, rssiDbm: x.e.rssiDbm, live: true, anon: x.e.anon, pos: x.pos });
    }
    return out;
  }

  private hexOf(ssid: string): string {
    let h = this.ssidHexCache.get(ssid);
    if (h === undefined) { h = utf8Hex(ssid); this.ssidHexCache.set(ssid, h); }
    return h;
  }

  /** what the copy advertises (spec §4): open copy (new BSSID, no password), perfect copy (the café's BSSID and
   *  WPA2), downgrade (the café's BSSID, no password) */
  private twinIdent(tx: Transmitter): { bssid: string; security: Security } {
    const cafe = txById('ap-cafe');
    switch (this.lab.attackVariant) {
      case 'perfect': return { bssid: cafe.bssid!, security: cafe.security! };
      case 'downgrade': return { bssid: cafe.bssid!, security: 'OPEN' };
      default: return { bssid: tx.bssid!, security: tx.security! };
    }
  }

  /** is this transmitter on the air? Real access points always; the copies only while their attack runs */
  private txOn(tx: Transmitter): boolean {
    if (!tx.attacker) return true;
    if (tx.id === 'twin') return this.attacker.on;
    if (tx.net === 'site-twin') return this.lab.siteTwin;
    return false;
  }
  private txEirp(tx: Transmitter): number { return tx.id === 'twin' ? this.attacker.eirp : tx.eirpDbm ?? 20; }

  /** Lab "beacon flood" (DDoS on network choice): a cheap device beside the walker beacons dozens of random names,
   *  rotating in a few new ones a second, plus fake access points under the name of each network heard nearby.
   *  Beacons only: nothing answers behind them. The random names are drawn as anonymous dots (spec §6: never named). */
  private floodScan(t: number, pos: Vec2, heard: Map<string, { rssi: number; tx: Transmitter }>): ScanEntry[] {
    if (!this.flood.placed) {
      const h = (this.player.headingDeg * Math.PI) / 180;
      this.flood = { placed: true, pos: [pos[0] + Math.cos(h) * 6, pos[1] - Math.sin(h) * 6], startT: t, shown: new Set() };
    }
    const F = this.flood.pos;
    const d = Math.max(1, Math.hypot(pos[0] - F[0], pos[1] - F[1]));
    const base = v('beaconFloodEirpDbm') - (40 + 20 * Math.log10(d)); // free space at 2.4 GHz (≈40 dB at 1 m)
    const out: ScanEntry[] = [];
    const tick = Math.floor(t * 10);
    if (base > -92) {
      const k0 = Math.floor((t - this.flood.startT) * v('beaconFloodNewPerS'));
      for (let i = k0; i < k0 + v('beaconFloodVisible'); i++) {
        const n = i % 4096;
        const ang = n * 2.39996, r = 0.6 + (n % 5) * 0.35;
        out.push({
          bssid: `02:f1:0d:${hx(n >> 8)}:${hx(n)}:01`, ssid: '', ssidHex: '', net: 'flood', security: 'WPA2-PSK', pmf: 'none',
          channel: [1, 6, 11][n % 3], band: '2.4', rssiDbm: base - 4 * crn(this.seed, n, tick, 41), anon: true,
          pos: [F[0] + Math.cos(ang) * r, F[1] + Math.sin(ang) * r],
        });
      }
      // fake access points under the names heard here (the flooder copies what is around)
      for (const [net, { rssi, tx }] of heard) {
        if (tx.attacker || !tx.ssid || rssi < -85) continue;
        const id = hashString(net);
        for (let c = 0; c < v('beaconFloodCopies'); c++) {
          out.push({
            bssid: `02:f1:0c:${hx(id >> 8)}:${hx(id)}:${hx(c)}`, ssid: tx.ssid, ssidHex: this.hexOf(tx.ssid), net: 'flood', security: tx.security!, pmf: 'none',
            channel: tx.channel ?? 6, band: '2.4', rssiDbm: base + 2 - 2 * c - 2 * crn(this.seed, id, c, tick, 42),
            pos: [F[0] + 0.4 * c, F[1] - 0.4],
          });
        }
      }
    }
    // a name that comes on the air is new; one that leaves is forgotten (bounded memory, spec A5)
    const now = new Set<string>();
    for (const e of out) { now.add(e.bssid); if (!this.flood.shown.has(e.bssid)) this.firstSeen.set(e.bssid, t); }
    for (const b of this.flood.shown) if (!now.has(b)) this.firstSeen.delete(b);
    this.flood.shown = now;
    return out;
  }
  /** hotspots fitted from the venue survey: log-distance at phone height, with a few dB of flutter per scan */
  private hotspotScan(t: number, pos: Vec2): ScanEntry[] {
    const hs = VENUE!.hotspots, out: ScanEntry[] = [];
    const tick = Math.round(t * 10);
    for (const h of hs.list) {
      // on air or not for this run: one draw per network from the seed (a snapshot of who has a hotspot on)
      if (h.onAir !== undefined && crn(this.seed, hashString(h.id), 45) >= h.onAir) continue;
      // the survey phone was held at 1.2 m: the same geometry the fit used (tools/venue/build.ts)
      const d = Math.max(1, Math.hypot(pos[0] - h.pos[0], pos[1] - h.pos[1], (h.h ?? 1.2) - 1.2));
      const pl0 = h.band === '2.4' ? v('wifiPl1m2GHz') : v('wifiPl1m5GHz');
      const r = h.eirpDbm - pl0 - 10 * hs.plExp * Math.log10(d) + 2 * v('wifiFastFadeSigmaDb') * (crn(this.seed, hashString(h.id), tick, 44) - 0.5);
      if (r <= hs.floorDbm) continue;
      if (!this.firstSeen.has(h.id)) this.firstSeen.set(h.id, t);
      const kind = h.kind ?? 'hotspot';
      out.push({
        bssid: h.id, ssid: '', ssidHex: '', net: kind, security: h.security ?? 'WPA2-PSK', pmf: h.pmf ?? 'none', channel: h.channel, band: h.band,
        rssiDbm: r, anon: true, pos: h.pos, kindHint: kind, std: h.std, bwMHz: h.bwMHz, ...(h.name ? { nameKey: `venue-${kind}:${h.name}` } : {}),
      });
    }
    return out;
  }

  private stopFlood() {
    for (const b of this.flood.shown) this.firstSeen.delete(b);
    this.flood = { placed: false, pos: [0, 0], startT: 0, shown: new Set() };
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
    this.emit({ t: this.t, type: 'attacker.start', ssid: 'Cafe_Guest', mode: this.lab.attackerMode, offsetDb: this.lab.attackerOffsetDb, variant: this.lab.attackVariant });
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
    // deauth: forged disconnects against the real café AP's clients (WPA2 without PMF → possible; trap #5)
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
      if (!this.txOn(tx)) continue;
      const eirp = this.txEirp(tx);
      const truth = m.truth.sample(pos, -250) + eirp;
      if (truth < -150) continue;
      const prev = bestByNet.get(tx.net);
      if (!prev || truth > prev.rssi) bestByNet.set(tx.net, { rssi: truth, tx });
      const meas = truth + this.fading.next(tx.id);
      if (meas > -92) {
        const id = tx.id === 'twin' ? this.twinIdent(tx) : { bssid: tx.bssid!, security: tx.security! };
        if (!this.firstSeen.has(id.bssid)) this.firstSeen.set(id.bssid, t);
        // two transmitters under one BSSID (the copied-BSSID variants): the scan shows the one heard loudest
        const dup = scan.findIndex((x) => x.bssid === id.bssid);
        if (dup >= 0 && scan[dup].rssiDbm >= meas) continue;
        const entry: ScanEntry = { bssid: id.bssid, ssid: tx.ssid!, ssidHex: this.hexOf(tx.ssid!), net: tx.net, security: id.security, pmf: tx.pmf ?? 'none', channel: tx.channel ?? 36, band: tx.band ?? '5', rssiDbm: meas };
        if (dup >= 0) scan[dup] = entry; else scan.push(entry);
        // the radio's other networks (a venue AP broadcasts several): same radio, beacons a moment apart
        if (tx.alias) {
          const tick = Math.round(t * 10);
          for (let ai = 0; ai < tx.alias.length; ai++) {
            const a = tx.alias[ai];
            const m2 = meas + 2 * (crn(this.seed, hashString(a.bssid), tick, 43) - 0.5);
            if (m2 <= -92) continue;
            if (!this.firstSeen.has(a.bssid)) this.firstSeen.set(a.bssid, t);
            scan.push({ bssid: a.bssid, ssid: '', ssidHex: '', net: 'venue-other', security: a.security, pmf: 'none', channel: tx.channel ?? 36, band: tx.band ?? '5', rssiDbm: m2, anon: true, nameKey: `${tx.net}:${ai}` });
          }
        }
      }
    }
    // the crowd's phone hotspots (venue scene): anonymous dots, never named, never joined
    if (VENUE && zoneAt(pos) === 'hall') for (const e of this.hotspotScan(t, pos)) scan.push(e);
    if (this.lab.beaconFlood) for (const e of this.floodScan(t, pos, bestByNet)) scan.push(e);
    for (const e of this.liveScan()) scan.push(e);
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
      } else if (net === 'twin' || net === 'site-twin') {
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
      if (this.lab.uplinkFlood && !tx.attacker) {
        // DDoS on this network's internet: the radio is fine, the queue behind it is full
        hops.push({ name: 'Uplink flooded (DDoS traffic)', owdMs: v('uplinkFloodOwdMs') });
        owd += v('uplinkFloodOwdMs');
        jitter += v('uplinkFloodJitterMs');
        loss += v('uplinkFloodLoss');
      }
      hops.push({ name: 'Internet to the far end', owdMs: v('internetOwdMs') });
      owd += v('internetOwdMs');
      paths.set(`wifi:${net}`, {
        id: `wifi:${net}`, kind: 'wifi', label: NET_LABEL[net] ?? net, up: rssi > -92, owdMs: owd, jitterMs: jitter, loss: Math.min(1, loss), hops,
        rssiDbm: rssi, snrDb: snr, ipEpoch, uplink, attacker: !!tx.attacker, captivePortal: !!tx.captivePortal && !(this.lab.signedIn ?? []).includes(net), security: tx.id === 'twin' ? this.twinIdent(tx).security : tx.security,
        udpBlocked: net === 'cafe-guest' && this.lab.cafeBlocksUdp,
      });
    }

    // the flood's fake access points: beacons only, nobody answers a join
    if (this.lab.beaconFlood && scan.some((e) => e.net === 'flood' && !e.anon)) {
      paths.set('wifi:flood', { id: 'wifi:flood', kind: 'wifi', label: NET_LABEL.flood, up: false, owdMs: 0, jitterMs: 0, loss: 1, hops: [], ipEpoch: 0, attacker: true, security: 'WPA2-PSK' });
    }

    // cellular paths + measurements
    const cell = new Map<string, CellMeas>();
    // one operator can have a site in each scene: the phone camps on the strongest one of each network
    const bestCell = new Map<string, { tx: Transmitter; rsrp: number; o2i: number }>();
    for (const m of this.maps.byTx.values()) {
      if (m.tx.kind !== 'cell') continue;
      const c = cellTruthAt(m, pos);
      const cur = bestCell.get(m.tx.net);
      if (!cur || c.rsrp > cur.rsrp) bestCell.set(m.tx.net, { tx: m.tx, ...c });
    }
    for (const { tx, rsrp, o2i } of bestCell.values()) {
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
    const links: LinkView[] = [...this.paths.values()].filter((p) => p.id !== 'wifi:flood').map((p) => ({
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
        anchorLost: inf?.anchorLost ?? false,
        flood: inf?.flood ?? false,
      },
      packets: this.packets,
      truth: {
        attackerPos: this.attacker.on ? [txById('twin').pos[0], txById('twin').pos[1]] : undefined,
        attackerOn: this.attacker.on, attackerMode: this.attacker.mode, attackVariant: this.lab.attackVariant,
        attackerBssid: this.attacker.on ? this.twinIdent(txById('twin')).bssid : undefined,
        siteTwinOn: this.lab.siteTwin, floodPos: this.flood.placed ? [...this.flood.pos] as Vec2 : undefined,
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
        r.fakeAccepted = a.fakeAccepted.size;
        r.realUnreachable = a.realUnreachable.size;
        const vm: PolicyResult['verdictMs'] = {};
        for (const lt of ['wifi', '5g', 'sat'] as LinkType[]) {
          const xs = a.verdictLog.filter((l) => l.linkType === lt && l.tier !== 'unreachable').map((l) => l.ms);
          if (xs.length) vm[lt] = { mean: xs.reduce((p, q) => p + q, 0) / xs.length, worst: Math.max(...xs), n: xs.length };
        }
        r.verdictMs = vm;
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
