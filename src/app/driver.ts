/**
 * The bridge between the pure engine and the front end (plan §14).
 * Owns the Sim, advances it on real time (× slow-mo), feeds player input, and turns engine
 * events into the product layer (notifications), the explainer layer (captions, timeline markers)
 * and the modes (free roam, Tour, Attract).
 */
import { create } from 'zustand';
import {
  createSim, LAYOUT, SCENARIOS, type LabState, type ScenarioId, type Sim, type SimEvent, type SimSnapshot, type Vec2,
} from '../engine/index';
import { segmentsCross } from '../engine/world/layout';
import { audio } from './audio/audio';

export type Playable = Exclude<ScenarioId, 'free'>;
export type ViewMode = 'belief' | 'truth' | 'error';
export type Mode = 'free' | 'tour' | 'attract';

export interface Note { id: number; sev: 'info' | 'heads' | 'threat'; title: string; detail: string; t: number; born: number }
export interface ShieldEntry { t: number; ssid: string; bssid: string; verdict: string; reason: string; flags: string[]; handshake?: string; verdictMs?: number }

/** phone app ids (Phone.tsx APPS order; notes and credits are Lab sub-pages) */
export const TUNNEL_APP = 6;
export const NOTES_APP = 7;
export const CREDITS_APP = 8;

/** Demo seed per scenario: chosen so each policy shows *typical* behaviour, not its luckiest/unluckiest run (see PROGRESS.md). */
export const DEMO_SEED: Record<Playable, number> = { 'building-exit': 26, 'cafe-twin': 21, 'desert-sat': 16 };

export const SCENE_ORDER: Playable[] = ['building-exit', 'cafe-twin', 'desert-sat'];
export const SCENE_NUM: Record<Playable, string> = { 'building-exit': '01', 'cafe-twin': '02', 'desert-sat': '03' };

/** Tour: each moment, and the sim time at which the tour moves on (total ≈ 2:05 plus slow-mo). */
const TOUR: Array<{ sc: Playable; until: number }> = [
  { sc: 'building-exit', until: 34 },
  { sc: 'cafe-twin', until: 40 },
  { sc: 'desert-sat', until: 97 },
];
const IDLE_TO_ATTRACT_S = 45;

/** each scene's key moment for "skip to the moment" (demo seeds; sim seconds just before it happens) */
export const MOMENT: Record<Playable, { t: number; label: string }> = {
  'building-exit': { t: 14, label: 'the Wi-Fi edge' },
  'cafe-twin': { t: 19.5, label: 'the fake hotspot' },
  'desert-sat': { t: 76, label: 'the satellite drop' },
};

export interface UiState {
  snap: SimSnapshot | null;
  scenario: Playable;
  /** Network Vision (N): the world desaturates and the network layer lights up (plan §4.2, §7.3) */
  vision: boolean;
  view: ViewMode;
  mode: Mode;
  live: boolean;
  phoneUp: boolean;
  app: number | null;      // open app index, null = home
  sel: number;             // home-screen selection
  labSel: number;
  notes: Note[];
  caption: string | null;
  help: boolean;
  perf: boolean;
  slow: boolean;
  holdB: boolean;
  fading: boolean;
  markers: { edgeT?: number; diesT?: number };
  unread: number;
  shield: ShieldEntry[];
  mapsVersion: number;
  fps: number;
  /** "How it works" pop-ups on the phone (Lab can switch them off) */
  explain: boolean;
  /** live hotspot scanner: off · connecting · live · replay · lost */
  scanner: 'off' | 'connecting' | 'live' | 'replay' | 'lost';
  /** a line about the scanner (permission, replay label) and how many networks the last batch had */
  scannerNote: string;
  liveCount: number;
}

export const useUi = create<UiState>(() => ({
  snap: null, scenario: 'building-exit', vision: false, view: 'belief', mode: 'free', live: false,
  phoneUp: false, app: null, sel: 0, labSel: 0, notes: [], caption: null, help: false, perf: false,
  slow: false, holdB: false, fading: false, markers: {}, unread: 0, shield: [], mapsVersion: 0, fps: 0,
  explain: true, scanner: 'off', scannerNote: '', liveCount: 0,
}));

const WALK = 1.4, RUN = 3.0;

class Driver {
  sim!: Sim;
  snap!: SimSnapshot;
  private cursor = 0;
  private lastPublish = 0;
  private noteId = 0;
  private lastNoteAt = -10;
  private pendingNotes: Note[] = [];
  private captionUntil = 0;
  private lastInput = performance.now();
  private tourIdx = 0;
  private autoSlowUntil = 0;
  private phoneAutoLowerAt = 0;
  private realT = 0;
  private introAt = 0;
  private frames = 0;
  private fpsT = 0;
  keys = new Set<string>();
  idleS = IDLE_TO_ATTRACT_S;
  /** true until the first load has finished (ui/Loader.tsx): the clock waits so scripted scenes start on screen */
  hold = true;
  /** camera yaw (radians, compass: 0 = north) so WASD follows the screen */
  cameraYaw = 0;
  /** mouse look (pointer lock): yaw offset and pitch the camera rig adds, and when the mouse last moved */
  look = { yaw: 0, pitch: 0, at: -1e9 };
  player: { pos: Vec2; vel: Vec2; headingDeg: number } = { pos: [0, 0], vel: [0, 0], headingDeg: 0 };
  lab: Partial<LabState> = {};

  constructor() {
    const saved = safeGet('infinet.lastScenario') as Playable | null;
    this.load(saved && SCENARIOS[saved] ? saved : 'building-exit', false);
  }

  load(sc: Playable, keepMode = true, labOverride: Partial<LabState> = {}) {
    const keep: Partial<LabState> = { ...this.lab, ...labOverride };
    delete keep.baseline;
    this.sim = createSim(sc, DEMO_SEED[sc], { prewarm: true, lab: keep });
    this.cursor = 0;
    this.snap = this.sim.snapshot();
    this.player = { ...this.snap.player };
    this.autoSlowUntil = 0;
    safeSet('infinet.lastScenario', sc);
    useUi.setState((s) => ({
      scenario: sc, live: false, snap: this.snap, notes: [], caption: null, markers: {}, shield: [], unread: 0,
      mode: keepMode ? s.mode : 'free', mapsVersion: this.sim.mapsVersion,
    }));
    this.pendingNotes = [];
    this.shown.clear();
    this.explained.clear();
    this.introAt = this.realT + 1.2;
    this.infSwitched = false;
    this.lastCaptionAt = this.sim.t - 0.01;
    this.captionsFor(-1);
  }

  /** fast travel with the 400 ms fade */
  travel(sc: Playable, mode: Mode = 'free') {
    useUi.setState({ fading: true });
    setTimeout(() => {
      this.load(sc, false);
      useUi.setState({ mode, fading: false });
    }, 400);
  }

  /** deterministic fast-forward (shots, cinematic, "skip to the moment"): steps the same per-frame logic at 50 ms,
   *  also while the first-load hold is on */
  fastForward(toSimT: number) {
    const hold = this.hold, paused = (globalThis as any).__infinetPaused;
    this.hold = false; (globalThis as any).__infinetPaused = false;
    let guard = 0;
    while (this.sim.t < toSimT - 1e-6 && guard++ < 100000) this.tick(Math.min(0.05, (toSimT - this.sim.t) + 1e-4));
    this.hold = hold; (globalThis as any).__infinetPaused = paused;
  }

  /** jump straight to a scene's key moment (HUD "skip to the moment"), with the fade */
  skipToMoment() {
    const sc = useUi.getState().scenario;
    const at = MOMENT[sc];
    if (at === undefined) return;
    useUi.setState({ fading: true });
    setTimeout(() => {
      if (this.sim.t > at.t - 0.5) this.load(sc, true);
      this.fastForward(at.t);
      this.snap = this.sim.snapshot();
      useUi.setState({ fading: false, snap: this.snap, live: false });
    }, 400);
  }

  reset() { this.lab = {}; this.travel(useUi.getState().scenario, 'free'); }

  /** spec §5: the "anchor down" moment, 8 s, so the panel sees the fail-closed policy work */
  anchorMoment() {
    this.setLab({ anchorDown: true });
    const sim = this.sim;
    const until = sim.t + 8;
    const back = () => {
      if (this.sim !== sim) return;
      if (sim.t >= until) this.setLab({ anchorDown: false });
      else setTimeout(back, 200);
    };
    setTimeout(back, 200);
  }

  setLab(l: Partial<LabState>) {
    Object.assign(this.lab, l);
    this.sim.setLab(l);
    this.snap = this.sim.snapshot();
    useUi.setState({ snap: this.snap, mapsVersion: this.sim.mapsVersion });
  }

  cycleBaseline() {
    const order: Array<'b1' | 'b2' | 'b3'> = ['b1', 'b2', 'b3'];
    const cur = this.snap.lab.baseline;
    this.setLab({ baseline: order[(order.indexOf(cur) + 1) % 3] });
  }

  startTour() {
    this.tourIdx = 0;
    this.travel(TOUR[0].sc, 'tour');
  }

  startAttract() {
    this.tourIdx = 0;
    this.travel(TOUR[0].sc, 'attract');
  }

  /** any real input: leaves attract mode, resets the idle timer */
  input() {
    this.lastInput = performance.now();
    audio.unlock();
    if (useUi.getState().mode === 'attract') {
      this.travel('building-exit', 'free');
      return true; // swallow the key that woke us
    }
    return false;
  }

  // ───────────── per frame ─────────────
  /** the world is on screen: start the clock, and count idle time for attract mode from now */
  release() {
    this.hold = false;
    this.lastInput = performance.now();
  }

  tick(realDt: number) {
    if ((globalThis as any).__infinetPaused || this.hold) return;
    realDt = Math.min(realDt, 0.1);
    this.realT += realDt;
    this.frames++;
    if (this.realT - this.fpsT >= 1) { useUi.setState({ fps: this.frames / (this.realT - this.fpsT) }); this.frames = 0; this.fpsT = this.realT; }
    const ui = useUi.getState();
    if (ui.fading) return;

    if (ui.mode === 'free' && performance.now() - this.lastInput > this.idleS * 1000) { this.startAttract(); return; }

    // movement input → live control (any movement hands control back to the player, plan §5.3)
    const mv = this.moveVector();
    if (mv && ui.mode === 'tour') useUi.setState({ mode: 'free' });
    let live = ui.live;
    if (mv && !live) { live = true; this.player = { ...this.snap.player }; useUi.setState({ live: true }); }

    const autoSlow = this.sim.t < this.autoSlowUntil;
    const scale = ui.slow || autoSlow ? 0.25 : 1;
    const dt = realDt * scale;

    if (live) this.walk(dt, mv);
    this.sim.advance(dt, live ? { ...this.player } : undefined);
    this.snap = this.sim.snapshot();
    if (!live) this.player = { ...this.snap.player };

    this.handleEvents(ui);
    this.trackDies();
    this.flushNotes();
    audio.update(this.snap, ui.holdB ? this.snap.lab.baseline : 'infinet', dt);

    // tour progression
    if ((ui.mode === 'tour' || ui.mode === 'attract') && this.sim.t >= TOUR[this.tourIdx].until) {
      this.tourIdx++;
      if (this.tourIdx >= TOUR.length) {
        if (ui.mode === 'attract') { this.tourIdx = 0; this.travel(TOUR[0].sc, 'attract'); }
        else this.travel('building-exit', 'free');
      } else this.travel(TOUR[this.tourIdx].sc, ui.mode);
      return;
    }
    if (this.phoneAutoLowerAt && this.realT > this.phoneAutoLowerAt) { this.phoneAutoLowerAt = 0; this.autoRaised = false; useUi.setState({ phoneUp: false, app: null }); }
    // a scene opens with the tunnel explained once
    if (this.introAt && this.realT > this.introAt) {
      this.introAt = 0;
      const u = useUi.getState();
      if (u.explain && !(u.phoneUp && !this.autoRaised)) this.autoPhone(TUNNEL_APP, 7);
    }

    if (this.realT - this.lastPublish > 0.1) this.publish();
  }

  private publish() {
    {
      this.lastPublish = this.realT;
      const now = this.realT;
      useUi.setState((s) => ({
        snap: this.snap,
        notes: s.notes.filter((n) => now - n.born < 4.5),
        caption: now < this.captionUntil ? s.caption : null,
      }));
    }
  }

  private moveVector(): Vec2 | null {
    const k = this.keys;
    let f = 0, r = 0;
    if (k.has('KeyW')) f += 1;
    if (k.has('KeyS')) f -= 1;
    if (k.has('KeyD')) r += 1;
    if (k.has('KeyA')) r -= 1;
    if (!f && !r) return null;
    // screen-relative: forward = away from the camera along the ground
    const yaw = this.cameraYaw;
    const fx = Math.sin(yaw), fy = Math.cos(yaw);   // engine frame (x east, y north)
    const rx = Math.cos(yaw), ry = -Math.sin(yaw);
    const x = f * fx + r * rx, y = f * fy + r * ry;
    const n = Math.hypot(x, y);
    return [x / n, y / n];
  }

  private walk(dt: number, mv: Vec2 | null) {
    const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? RUN : WALK;
    if (!mv) { this.player = { ...this.player, vel: [0, 0] }; return; }
    const p = this.player.pos;
    const step: Vec2 = [mv[0] * speed * dt, mv[1] * speed * dt];
    let next: Vec2 = [p[0] + step[0], p[1] + step[1]];
    if (blocked(p, next)) {
      const xOnly: Vec2 = [p[0] + step[0], p[1]];
      const yOnly: Vec2 = [p[0], p[1] + step[1]];
      next = !blocked(p, xOnly) ? xOnly : !blocked(p, yOnly) ? yOnly : p;
    }
    const vel: Vec2 = dt > 0 ? [(next[0] - p[0]) / dt, (next[1] - p[1]) / dt] : [0, 0];
    this.player = { pos: next, vel, headingDeg: ((Math.atan2(mv[0], mv[1]) * 180) / Math.PI + 360) % 360 };
  }

  // ───────────── events → product + explainer layers ─────────────
  private handleEvents(ui: UiState) {
    const { events, cursor } = this.sim.eventsSince(this.cursor);
    this.cursor = cursor;
    for (const e of events) {
      this.captionsFor(-1, e);
      this.noteFor(e);
      // the heads-up that led to the switch (latest one before Infinet moved)
      if (e.type === 'predict.edge' && !this.infSwitched) useUi.setState((s) => ({ markers: { ...s.markers, edgeT: e.t } }));
      if (e.type === 'switch' && e.policy === 'infinet') this.infSwitched = true;
      if (e.type === 'switch' && e.policy === 'infinet' && (ui.mode !== 'free' || !ui.live) && this.sim.scenario === 'building-exit') this.autoSlowUntil = e.t + 1.0;
      if (e.type.startsWith('trust.') && 'bssid' in e && e.type !== 'trust.checking') {
        const verdict = ({ 'trust.blocked': 'Blocked', 'trust.tunnel': 'Tunnel only', 'trust.trusted': 'Trusted', 'trust.unreachable': 'Unreachable' } as Record<string, string>)[e.type];
        useUi.setState((s) => ({ shield: [...s.shield, { t: e.t, ssid: e.ssid, bssid: e.bssid, verdict, reason: e.reason, flags: e.flags.map((f) => `${f.text} (${f.weight})`), handshake: e.handshake, verdictMs: e.verdictMs }] }));
      }
      this.explainFor(e, ui);
      if (e.type === 'sat.pattern' && ui.mode !== 'free') this.autoPhone(0, 6);
    }
    // timed captions
    this.captionsFor(this.sim.t);
  }

  private lastCaptionAt = -1;
  private infSwitched = false;
  private captionsFor(t: number, e?: SimEvent) {
    const def = this.sim.scenarioDef;
    if (!def) return;
    if (t < 0 && !e) { this.lastCaptionAt = this.sim.t; return; }
    for (const c of def.captions) {
      const hit = e
        ? c.on === e.type && (!('policy' in e) || (e as any).policy === 'infinet') && (!c.to || String((e as any).to ?? '').startsWith(c.to))
        : c.at !== undefined && c.at > this.lastCaptionAt && c.at <= t;
      if (hit) { useUi.setState({ caption: c.text }); this.captionUntil = this.realT + 4.5; }
    }
    if (!e) this.lastCaptionAt = t;
  }

  private shown = new Set<string>();
  private noteFor(e: SimEvent) {
    const add = (sev: Note['sev'], title: string, detail: string, key?: string) => {
      if (key) { if (this.shown.has(key)) return; this.shown.add(key); }
      this.pendingNotes.push({ id: ++this.noteId, sev, title, detail, t: e.t, born: 0 });
    };
    switch (e.type) {
      case 'predict.edge': add('heads', `Wi-Fi edge in ${Math.max(1, Math.round(e.ttlS))} s · checking 5G`, `Seen on the coverage map · ${e.label}`, 'edge'); break;
      case 'switch.done': if (e.policy === 'infinet') add('info', `Switched to ${e.toLabel} · ${Math.round(e.frozenMs)} ms frozen`, 'Checked before use · make-before-break'); break;
      case 'trust.blocked': add('threat', `Blocked '${e.ssid}'`, e.handshake === 'authfail' ? 'Its check packets failed authentication' : `${e.flags.length} red flags · nothing was sent to it`); break;
      case 'trust.tunnel': add('info', `${e.ssid}: tunnel only`, 'New to us · only our encrypted tunnel, as a backup'); break;
      case 'trust.unreachable': add('heads', `${e.ssid} isn't answering yet`, 'Not counted as an attack · we try again shortly'); break;
      case 'anchor.lost': add('threat', 'Anchor server not answering', 'Fail closed: nothing leaves the tunnel · messages held'); break;
      case 'anchor.back': add('info', 'Anchor server back', 'Tunnel up again · held messages sent'); break;
      case 'flood.on': add('threat', `Beacon flood: ${e.newNames} new names`, 'Trust upgrades frozen until it settles', 'flood'); break;
      case 'sat.pattern': add('info', `${Math.round(e.periodS)} s satellite pattern detected`, 'Voice protected ahead of each hiccup'); break;
      case 'sat.failover': if (e.to === 'GEO') add('heads', 'Satellite backup active', `Round trip ${Math.round(e.rttMs)} ms · call protected`); break;
      case 'call.frozen': if (e.policy === 'infinet') add('threat', 'Call frozen', 'No voice arriving · counting seconds'); break;
      case 'attack.on':
        if (e.attack === 'beacon-flood') add('threat', 'Beacon flood nearby (DDoS)', 'A cheap device floods fake network names, some copying the ones around you');
        else if (e.attack === 'uplink-flood') add('threat', 'Wi-Fi uplink flooded (DDoS)', 'The signal stays strong; packets behind it are lost and late');
        else add('threat', 'A fake Site-Net is on the air', 'Open, new device, from a vehicle outside the fence');
        break;
      case 'attack.off': add('info', e.attack === 'beacon-flood' ? 'Beacon flood stopped' : e.attack === 'uplink-flood' ? 'Uplink flood stopped' : 'Fake Site-Net gone', 'Simulation: the attack was switched off in Lab'); break;
      case 'path.congested': add('heads', `${e.label}: strong signal, ${e.lossPct} % lost · moved to 5G`, `Its own probes saw it (${e.rttMs < 1e5 ? `${e.rttMs} ms round trip` : 'no answers'}); bars alone would have said stay`); break;
      default: break;
    }
  }

  /** at most one new card per 1.5 s, up to 3 on screen, each lasts 4.5 s (plan §8.4) */
  private flushNotes() {
    if (!this.pendingNotes.length || this.realT - this.lastNoteAt < 1.5) return;
    const n = this.pendingNotes.shift()!;
    n.born = this.realT;
    this.lastNoteAt = this.realT;
    audio.tone(n.sev);
    useUi.setState((s) => ({
      notes: [...s.notes.filter((x) => x.title !== n.title), n].slice(-3),
      unread: s.phoneUp ? 0 : s.unread + 1,
    }));
  }

  private autoPhone(app: number, seconds: number) {
    useUi.setState({ phoneUp: true, app, unread: 0 });
    this.phoneAutoLowerAt = this.realT + seconds;
    this.autoRaised = true;
  }
  /** the phone was raised by the explainer (not by the user), so it may switch view and lower itself */
  autoRaised = false;
  /** the user touched the phone: the explainer leaves it alone for a while */
  phoneTouchedAt = -1e9;
  touchPhone() { this.phoneTouchedAt = this.realT; this.autoRaised = false; this.phoneAutoLowerAt = 0; }

  /** "How it works": the phone pops up on the Tunnel view at the moments that show the tunnel and the check */
  private explainFor(e: SimEvent, ui: UiState) {
    if (!ui.explain) return;
    const userBusy = ui.phoneUp && !this.autoRaised && this.realT - this.phoneTouchedAt < 20;
    if (userBusy) return;
    const pop = (key: string, seconds: number) => {
      if (key && this.explained.has(key)) return;
      if (key) this.explained.add(key);
      this.autoPhone(TUNNEL_APP, seconds);
    };
    if (e.type === 'predict.edge') pop('edge', 9);
    else if (e.type === 'switch' && e.policy === 'infinet') pop('switch', 7);
    else if (e.type === 'trust.checking' && !e.bssid.startsWith('cell:')) pop('check', 8);
    else if (e.type === 'trust.blocked') pop('', 8);
    else if (e.type === 'trust.unreachable') pop('unreach', 7);
    else if (e.type === 'anchor.lost') pop('', 10);
    else if (e.type === 'sat.failover') pop('sat', 8);
  }
  private explained = new Set<string>();

  /** explainer marker: when the Wi-Fi the call started on really drops below −75 dBm (simulated truth) */
  private trackDies() {
    const def = this.sim.scenarioDef;
    if (!def?.init.wifi || def.id !== 'building-exit') return;
    const m = useUi.getState().markers;
    if (m.diesT !== undefined) return;
    const l = this.snap.links.find((x) => x.id === `wifi:${def.init.wifi}`);
    if (l && (l.rssiDbm ?? -200) < -75 && this.sim.t > 2) useUi.setState({ markers: { ...m, diesT: this.sim.t } });
  }
}

const WALLS = LAYOUT.walls.filter((w) => !w.door);
function blocked(a: Vec2, b: Vec2): boolean {
  for (const w of WALLS) if (segmentsCross(a, b, w.a, w.b)) return true;
  return false;
}

function safeGet(k: string): string | null { try { return sessionStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } }

export const driver = new Driver();
