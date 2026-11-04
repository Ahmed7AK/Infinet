/**
 * Demo screen (style guide p. 18 + p. 22): 1920 × 1080 stage, 48 px margins.
 *  top bar 64 · Today's phone panel left (Steel) · Infinet panel right (Violet) · handover timeline 140 at the bottom
 *  · the centre third stays clear for the world. Text ≥ 24 px for values at 1080p.
 */
import { useEffect, useState } from 'react';
import { SCENARIOS, type LaneSegment, type PolicyView, type SimSnapshot } from '../../engine/index';
import { driver, SCENE_NUM, SCENE_ORDER, useUi, type Playable } from '../driver';
import { fmtMs, fmtPct, fmtS } from '../tokens';

export function useStageScale() {
  const [s, setS] = useState(() => ({ k: innerHeight / 1080, w: innerWidth / (innerHeight / 1080) }));
  useEffect(() => {
    const on = () => {
      const k = innerHeight / 1080;
      setS({ k, w: innerWidth / k });
      document.documentElement.style.setProperty('--hs', String(k));
    };
    on();
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);
  return s;
}

const VIEW_TAG = {
  belief: { text: "Coverage map · what Infinet knows", sim: false },
  truth: { text: 'Simulation view · true signal', sim: true },
  error: { text: 'Simulation view · map error', sim: true },
};

export function TopBar() {
  const sc = useUi((s) => s.scenario);
  const view = useUi((s) => s.view);
  const def = SCENARIOS[sc];
  const tag = VIEW_TAG[view];
  return (
    <div className="topbar">
      <div className="lockup">
        {/* TODO(logo): placeholder — the wordmark is artwork; drop the master SVG into public/brand/ and use it here */}
        <div className="mark cut2" />
        <div className="word">INFINET</div>
      </div>
      <div>
        <div className="scene-name"><span className="num">SCENE {SCENE_NUM[sc]}</span>{def.label}</div>
        <div className="scene-proves">{def.proves} · {SCENE_ORDER.indexOf(sc) + 1} OF 3</div>
      </div>
      <div className="spacer" />
      <div style={{ position: 'relative' }}>
        <div className={`viewtag cut1 ${tag.sim ? 'sim' : ''}`}>{tag.text}</div>
        <Legend view={view} />
      </div>
      <div className="keys">H HELP</div>
      <div className="tag-sim">SIMULATED</div>
    </div>
  );
}

function Legend({ view }: { view: string }) {
  const items: Array<[string, string]> = view === 'error'
    ? [['#1E1F33', '< 3 dB'], ['#3C0D85', '3–6'], ['#730FFF', '6–10'], ['#FF5A3C', '> 10 dB off']]
    : [['#00EBFF', '−55'], ['#730FFF', '−62'], ['#560EBD', '−68'], ['#3C0D85', '−73'], ['#2A0C5A', '−77'], ['#FF5A3C', 'edge · dBm']];
  return (
    <div className="legend">
      {items.map(([c, l]) => <span key={l}><i style={{ background: c }} />{l}</span>)}
    </div>
  );
}

const SUB: Record<string, string> = {
  b1: "Today's phone: switches after the drop.",
  b2: 'Strongest signal: joins whatever is loudest.',
  b3: 'Tunnel, no check: keeps the call, trusts every network.',
  infinet: 'Sees the drop coming. Checks a network before it trusts it.',
};

function stateChip(pv: PolicyView) {
  const map = { live: 'Call live', handover: 'Handing over', frozen: 'Call frozen', dropped: 'Call dropped' } as const;
  return <div className={`chip cut1 ${pv.callState}`}>{map[pv.callState]}</div>;
}

function curFrozenS(pv: PolicyView, snap: SimSnapshot): number | null {
  if (pv.callState !== 'frozen' && pv.callState !== 'dropped') return null;
  const segs = pv.laneSegments;
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i].state !== 'frozen' && segs[i].state !== 'dropped') return snap.t - segs[i].t1;
  }
  return null;
}

export function PolicyPanel({ side }: { side: 'left' | 'right' }) {
  const snap = useUi((s) => s.snap);
  const unread = useUi((s) => s.unread);
  if (!snap) return null;
  const id = side === 'left' ? snap.lab.baseline : 'infinet';
  const pv = snap.policies[id];
  if (!pv) return null;
  const inf = snap.infinet;
  const cf = curFrozenS(pv, snap);
  const checkedWord = pv.checked ? (id === 'infinet' ? 'yes, before use' : 'yes') : 'no';
  return (
    <div className={`panel cut2 ${side}`}>
      <h2>{side === 'left' ? "Today's phone" : 'Infinet'}</h2>
      <div className="sub">{SUB[id]}</div>
      <div className="rows">
        <div className="k">Network</div><div className="v">{pv.activeLabel || '—'}</div>
        <div className="k">Checked</div><div className={`v ${pv.checked ? '' : 'warn'}`}>{checkedWord}</div>
        <div className="k">Frozen</div><div className={`v data ${pv.metrics.frozenS > 0.05 ? 'warn' : ''}`}>{fmtS(pv.metrics.frozenS)}</div>
        <div className="k">Voice lost</div><div className="v data">{fmtPct(pv.metrics.voiceLostPct)}</div>
        <div className="k">MOS · 5 s</div><div className="v data">{pv.metrics.mos.toFixed(1)}</div>
        <div className="k">Mouth→ear</div><div className="v data">{fmtMs(pv.mouthToEarMs)}</div>
      </div>
      <div className="state">
        {stateChip(pv)}
        {cf !== null && <span className="counter">{fmtS(cf)}</span>}
        {pv.mode === 'duplicate' && <span className="k" style={{ fontSize: 18 }}>VOICE ON 2 PATHS</span>}
      </div>
      {id === 'infinet' && inf.ttlS !== undefined && inf.ttlS < 8 && (pv.activePath?.startsWith('wifi') || pv.dupPaths.some((p) => p.startsWith('wifi'))) && (
        <div className="pred cut2"><span className="lab">WI-FI EDGE IN</span><span className="num">{fmtS(inf.ttlS)}</span></div>
      )}
      {id === 'infinet' && inf.candidate && inf.candidateState && inf.candidateState !== 'idle' && (
        <div className="pred ok cut2"><span className="lab">NEXT · {labelOf(inf.candidate)}</span><span className="num" style={{ fontSize: 22 }}>{inf.candidateState === 'ready' ? '✓ CHECKED' : 'CHECKING…'}</span></div>
      )}
      {side === 'right' && <div className="k" style={{ marginTop: 14, fontSize: 16 }}>↑ OPEN PHONE{unread ? <span style={{ background: 'var(--orange)', color: 'var(--night)', padding: '0 8px', marginLeft: 8 }}>{unread}</span> : null}</div>}
      {side === 'left' && <div className="k" style={{ marginTop: 14, fontSize: 16 }}>C · CHANGE BASELINE · HOLD B TO HEAR IT</div>}
    </div>
  );
}

const labelOf = (path: string) => ({ 'cell:cell-a': '5G', 'cell:cell-b': '5G (B)', 'wifi:office-corp': 'Office Wi-Fi', 'wifi:cafe-guest': 'Café Wi-Fi', 'wifi:site-net': 'Site Wi-Fi' } as Record<string, string>)[path] ?? path;

// ───────────── cards ─────────────
export function SideCards() {
  const snap = useUi((s) => s.snap);
  const sc = useUi((s) => s.scenario);
  if (!snap) return null;
  const sat = snap.infinet.satPatient;
  const pat = snap.infinet.leoPattern;
  return (
    <>
      {sc === 'desert-sat' && (
        <div className="card sat cut2" style={{ left: 48, bottom: 48 + 140 + 20 }}>
          <div className="t">Satellite · {sat && !sat.normal ? 'checking' : 'patient'}</div>
          <div className="big">{sat ? `${Math.round(sat.rttMs)} ms` : '—'}</div>
          <div className="cnote">{sat && sat.rttMs > 450 ? 'Now normal for this link (GEO-like round trip)' : 'Normal for this link'} · dead after {sat ? `${Math.round(sat.rtoMs)} ms` : '—'} silence</div>
          <div className="cnote" style={{ marginTop: 6, color: pat ? 'var(--cyan)' : 'var(--mute)' }}>
            {pat ? `${pat.periodS.toFixed(1)} s pattern learned${pat.protecting ? ' · protecting now' : ''}` : 'Learning the satellite pattern…'}
          </div>
        </div>
      )}
      {sc === 'building-exit' && <Freshness value={snap.lab.mapStaleness} />}
    </>
  );
}

function Freshness({ value }: { value: number }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className="card fresh cut2 interactive" style={{ bottom: 48 + 140 + 20 }}>
      <div className="t">Map freshness</div>
      <input
        type="range" min={0} max={1} step={0.05} value={v}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={() => driver.setLab({ mapStaleness: v })}
        onKeyUp={() => driver.setLab({ mapStaleness: v })}
      />
      <div className="scale"><span>FRESH</span><span>STALE</span></div>
      <div className="cnote" style={{ marginTop: 4 }}>Stale map: Infinet falls back to switching after the drop</div>
    </div>
  );
}

// ───────────── handover timeline ─────────────
const WINDOW_S = 30;
function segStyle(s: LaneSegment, infinet: boolean): React.CSSProperties {
  switch (s.state) {
    case 'frozen': return { background: 'repeating-linear-gradient(135deg, #FF5A3C 0 10px, #0A0B14 10px 16px)', color: '#FFFFFF' };
    case 'dropped': return { background: '#FF5A3C', color: '#0A0B14' };
    case 'checking': return { background: '#0A0B14', boxShadow: 'inset 0 0 0 2px #00EBFF', color: '#00EBFF' };
    case 'handover': return { background: 'repeating-linear-gradient(90deg, #730FFF 0 14px, #151827 14px 20px)', color: '#FFFFFF' };
    case 'weak': return { background: s.checked ? '#3C0D85' : '#2B3044', color: '#E9EBF0' };
    case 'idle': return { background: '#151827', color: '#5C6272' };
    default: return s.checked ? { background: infinet ? '#730FFF' : '#4A2A99', color: '#FFFFFF' } : { background: '#23273A', color: '#9AA0B4' };
  }
}
const WORD: Record<string, string> = { live: '', weak: 'getting weak', checking: 'checking', handover: 'handing over', frozen: 'call frozen', dropped: 'call dropped', idle: '' };

/** window: from the start of the scene for the first 30 s (time runs left to right), then scrolling */
export function windowStart(snap: SimSnapshot): number {
  const start = snap.scenario === 'desert-sat' ? 40 : 0;
  return Math.max(start, snap.t - WINDOW_S);
}

function Lane({ name, pv, t, t0, infinet }: { name: string; pv: PolicyView; t: number; t0: number; infinet: boolean }) {
  const segs = pv.laneSegments.filter((s) => s.t1 > t0);
  return (
    <div className="lane">
      <div className="name" style={{ color: infinet ? '#C9B3FF' : '#9AA0B4' }}>{name}</div>
      <div className="bar">
        {segs.map((s, i) => {
          const a = Math.max(s.t0, t0), b = Math.min(s.t1, t);
          const left = ((a - t0) / WINDOW_S) * 100, width = Math.max(0.15, ((b - a) / WINDOW_S) * 100);
          const label = [s.net, WORD[s.state], s.state === 'live' && !s.checked ? 'not checked' : s.state === 'live' && infinet ? 'trusted' : ''].filter(Boolean).join(' · ');
          return <div key={i} className="seg" style={{ left: `${left}%`, width: `${width}%`, ...segStyle(s, infinet) }}>{width > 7 ? label : ''}</div>;
        })}
      </div>
      <div className="stats">FROZEN <b>{fmtS(pv.metrics.frozenS)}</b> · LOST <b>{fmtPct(pv.metrics.voiceLostPct)}</b> · MOS <b>{pv.metrics.mos.toFixed(1)}</b></div>
    </div>
  );
}

export function Timeline() {
  const snap = useUi((s) => s.snap);
  const markers = useUi((s) => s.markers);
  if (!snap) return null;
  const base = snap.policies[snap.lab.baseline], inf = snap.policies.infinet;
  if (!base || !inf) return null;
  const t0 = windowStart(snap);
  const pos = (t?: number) => (t === undefined || t < t0 ? null : `calc(220px + (100% - 220px - 420px) * ${(t - t0) / WINDOW_S})`);
  const edge = pos(markers.edgeT), dies = pos(markers.diesT);
  return (
    <div className="timeline cut2">
      <div className="head"><span>Handover timeline · same walk, same signal</span><span>{WINDOW_S} s window · simulated</span></div>
      <div style={{ position: 'relative' }}>
        <Lane name="Today's phone" pv={base} t={snap.t} t0={t0} infinet={false} />
        <Lane name="Infinet" pv={inf} t={snap.t} t0={t0} infinet />
        {edge && <div className="marker edge" style={{ left: edge, top: -6, bottom: -4 }}><span>EDGE SEEN ON THE MAP</span></div>}
        {dies && <div className="marker dies" style={{ left: dies, top: -6, bottom: -4 }}><span>WI-FI ACTUALLY DIES</span></div>}
      </div>
    </div>
  );
}

// ───────────── notifications, captions, help ─────────────
export function Notifications() {
  const notes = useUi((s) => s.notes);
  const phoneUp = useUi((s) => s.phoneUp);
  if (phoneUp) return null;
  return (
    <div className="notes" style={{ bottom: 48 + 140 + 20 }}>
      {notes.map((n) => (
        <div key={n.id} className={`note cut2 ${n.sev}`}>
          <div className="bar" />
          <div className="body"><div className="title">{n.title}</div><div className="detail">{n.detail}</div></div>
        </div>
      ))}
    </div>
  );
}

export function Caption() {
  const c = useUi((s) => s.caption);
  const mode = useUi((s) => s.mode);
  const live = useUi((s) => s.live);
  if (!c || (mode === 'free' && live)) return null;
  return <div className="caption cut2">{c}</div>;
}

export function ModeBanner() {
  const mode = useUi((s) => s.mode);
  const live = useUi((s) => s.live);
  const slow = useUi((s) => s.slow);
  if (mode === 'attract') return <div className="attract cut2">Press any key to take control</div>;
  if (mode === 'tour') return <div className="tourbadge">TOUR · MOVE (WASD) TO TAKE OVER · T TO RESTART</div>;
  if (slow) return <div className="tourbadge">SLOW MOTION · 0.25×</div>;
  if (!live) return <div className="tourbadge">WALKING THE ROUTE · WASD TO TAKE OVER</div>;
  return null;
}

export function Help() {
  const help = useUi((s) => s.help);
  if (!help) return null;
  const rows: Array<[string, string]> = [
    ['WASD · Shift', 'Walk · run (takes over from the route)'],
    ['1 · 2 · 4', 'Fast travel: office · café · desert site'],
    ['T', 'Tour: the three moments with captions (≈ 2 min)'],
    ['↑ · arrows · Enter · ⌫', 'Raise the Infinet phone and use it'],
    ['N · Shift+N', 'Simulation view: true signal · map error'],
    ['C', 'Change baseline: Today\'s phone · Strongest signal · Tunnel, no check'],
    ['hold B', "Hear the call on Today's phone"],
    ['hold Space', 'Slow motion 0.25×'],
    ['F9 · F10', 'Reset · performance'],
  ];
  return (
    <div className="help cut2">
      <h3>CONTROLS</h3>
      <table><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
      <p style={{ fontSize: 18, color: 'var(--mute)', marginBottom: 0 }}>Everything on screen is simulated with settings from published measurements. Lab → Sim notes lists every assumption and visual compression.</p>
    </div>
  );
}

export function Perf() {
  const perf = useUi((s) => s.perf);
  const fps = useUi((s) => s.fps);
  const snap = useUi((s) => s.snap);
  if (!perf || !snap) return null;
  return <div className="perf">{fps.toFixed(0)} fps · sim t {snap.t.toFixed(2)} s · seed {snap.seed} · packets {snap.packets.length}</div>;
}

export type { Playable };
