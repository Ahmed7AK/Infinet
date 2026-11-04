/**
 * HUD (plan §8): a 1080-high stage scaled to the window, dark glass panels around a clear centre.
 *  top-left scene · top-centre comparison strip (same walk, same signal) · top-right compact hints
 *  bottom-left notifications over the minimap · bottom-right the phone · bottom-centre captions.
 */
import { Bell, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SCENARIOS, type LaneSegment, type PolicyView, type SimSnapshot } from '../../engine/index';
import { SCENE_NUM, SCENE_ORDER, useUi, type Playable } from '../driver';
import { fmtPct, fmtS, tech, THRESH } from '../tokens';
import { Minimap } from './Minimap';

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

export function SceneTitle() {
  const sc = useUi((s) => s.scenario);
  const def = SCENARIOS[sc];
  return (
    <div className="scene">
      <div className="k">Scene {SCENE_NUM[sc]} of 3 · {SCENE_ORDER.indexOf(sc) + 1 === 3 ? 'remote site' : 'city'}</div>
      <div className="t">{def.label}</div>
      <div className="p">{def.proves}</div>
    </div>
  );
}

// ───────────── comparison strip ─────────────
const WINDOW_S = 30;
const BASE_NAME: Record<string, [string, string]> = {
  b1: ["Today's phone", 'switches after the drop'],
  b2: ['Strongest signal', 'joins the loudest network'],
  b3: ['Tunnel, no check', 'trusts every network'],
};
function segColor(s: LaneSegment): string {
  switch (s.state) {
    case 'frozen': return `repeating-linear-gradient(135deg, ${tech.threat} 0 6px, rgba(248,113,113,0.35) 6px 10px)`;
    case 'dropped': return tech.threat;
    case 'checking': return 'rgba(251, 191, 36, 0.55)';
    case 'handover': return `repeating-linear-gradient(90deg, ${tech.check} 0 8px, rgba(251,191,36,0.3) 8px 12px)`;
    case 'weak': return 'rgba(163, 171, 184, 0.45)';
    case 'idle': return 'transparent';
    default: return s.net?.toLowerCase().includes('5g') || s.net?.toLowerCase().includes('cell') ? 'rgba(52, 211, 153, 0.75)' : 'rgba(77, 163, 255, 0.75)';
  }
}
/** window: from the start of the scene for the first 30 s (time runs left to right), then scrolling */
export function windowStart(snap: SimSnapshot): number {
  const start = snap.scenario === 'desert-sat' ? 40 : 0;
  return Math.max(start, snap.t - WINDOW_S);
}
const STATE: Record<PolicyView['callState'], string> = { live: 'Call live', handover: 'Handing over', frozen: 'Call frozen', dropped: 'Call dropped' };

function Lane({ name, sub, pv, t, t0 }: { name: string; sub: string; pv: PolicyView; t: number; t0: number }) {
  const segs = pv.laneSegments.filter((s) => s.t1 > t0);
  return (
    <div className="lane">
      <div className="nm">{name}<small>{sub}</small></div>
      <div className="bar">
        {segs.map((s, i) => {
          const a = Math.max(s.t0, t0), b = Math.min(s.t1, t);
          return <div key={i} className="seg" style={{ left: `${((a - t0) / WINDOW_S) * 100}%`, width: `${Math.max(0.2, ((b - a) / WINDOW_S) * 100)}%`, background: segColor(s) }} />;
        })}
      </div>
      <div className="stats">
        <span className={`chip ${pv.callState}`}>{STATE[pv.callState]}</span>
        <b className={pv.metrics.frozenS > 0.05 ? 'bad' : ''}>{fmtS(pv.metrics.frozenS)}</b> · <b>{fmtPct(pv.metrics.voiceLostPct)}</b> · <b>{pv.metrics.mos.toFixed(1)}</b>
      </div>
    </div>
  );
}

export function CompareStrip() {
  const snap = useUi((s) => s.snap);
  const markers = useUi((s) => s.markers);
  if (!snap) return null;
  const base = snap.policies[snap.lab.baseline], inf = snap.policies.infinet;
  if (!base || !inf) return null;
  const t0 = windowStart(snap);
  // marker x inside the bar column: 14 px pad + 180 name + 12 gap … bar … 12 gap + 300 stats + 14 pad
  const pos = (t?: number) => (t === undefined || t < t0 ? null : `calc(206px + (100% - 532px) * ${(t - t0) / WINDOW_S})`);
  const edge = pos(markers.edgeT), dies = pos(markers.diesT);
  const [bn, bs] = BASE_NAME[snap.lab.baseline];
  return (
    <div className="strip glass">
      <div className="head"><span>SAME WALK · SAME SIGNAL · LAST {WINDOW_S} s</span><span>FROZEN · VOICE LOST · MOS</span></div>
      <Lane name={bn} sub={bs} pv={base} t={snap.t} t0={t0} />
      <Lane name="Infinet" sub="sees it coming · checks first" pv={inf} t={snap.t} t0={t0} />
      {edge && <div className="mk" style={{ left: edge }}><span>edge seen</span></div>}
      {dies && <div className="mk dies" style={{ left: dies }}><span>Wi-Fi dies</span></div>}
    </div>
  );
}

const VIEW_WORD = { belief: "Infinet's coverage map", truth: 'true signal (simulation only)', error: 'map error (simulation only)' };
export function VisionTag() {
  const vision = useUi((s) => s.vision);
  const view = useUi((s) => s.view);
  if (!vision) return null;
  return (
    <div className="visiontag glass">
      <span className="t">Simulation view</span>
      <span>{VIEW_WORD[view]}</span>
      {view === 'error' ? (
        <span className="lg"><span><i className="fill" style={{ background: tech.threat }} />map off by 2 → 10 dB</span></span>
      ) : (
        <span className="lg">
          <span><i style={{ borderColor: '#EAF4FF' }} />Wi-Fi {fmtThr(THRESH.wifiVoice)}</span>
          <span><i className="dash" style={{ borderColor: '#EAF4FF' }} />{fmtThr(THRESH.wifiData)}</span>
          <span><i style={{ borderColor: tech.cell }} />5G {fmtThr(THRESH.cellEdge)}</span>
          <span><i className="fill" style={{ background: tech.tunnel }} />tunnel</span>
        </span>
      )}
    </div>
  );
}
const fmtThr = (v: number) => `−${Math.abs(v)} dBm`;

export function Hints() {
  const vision = useUi((s) => s.vision);
  const up = useUi((s) => s.phoneUp);
  return (
    <div className="hints">
      <div className="row">
        <span className={`key glass ${vision ? 'on' : ''}`}><kbd>N</kbd>Network Vision</span>
        <span className="key glass"><kbd>↑</kbd>{up ? 'phone' : 'raise phone'}</span>
        <span className="key glass"><kbd>H</kbd>help</span>
      </div>
      <span className="simtag">SIMULATED</span>
    </div>
  );
}

// ───────────── notifications, captions, banners, help ─────────────
const NOTE_ICON = { info: ShieldCheck, heads: Bell, threat: ShieldAlert } as const;
export function Notifications() {
  const notes = useUi((s) => s.notes);
  return (
    <div className="notes">
      {notes.map((n) => {
        const Ic = NOTE_ICON[n.sev];
        return (
          <div key={n.id} className={`note glass ${n.sev}`}>
            <Ic className="ic" strokeWidth={2} />
            <div><div className="from">INFINET</div><div className="title">{n.title}</div><div className="detail">{n.detail}</div></div>
          </div>
        );
      })}
    </div>
  );
}

export function Caption() {
  const c = useUi((s) => s.caption);
  const mode = useUi((s) => s.mode);
  const live = useUi((s) => s.live);
  if (!c || (mode === 'free' && live)) return null;
  return <div className="caption glass">{c}</div>;
}

export function ModeBanner() {
  const mode = useUi((s) => s.mode);
  const live = useUi((s) => s.live);
  const slow = useUi((s) => s.slow);
  if (mode === 'attract') return <div className="attract glass">Press any key to take control</div>;
  if (mode === 'tour') return <div className="banner glass"><b>Tour</b> · move (WASD) to take over · T to restart</div>;
  if (slow) return <div className="banner glass"><b>Slow motion</b> · 0.25×</div>;
  if (!live) return <div className="banner glass"><b>Walking the route</b> · WASD to take over · drag to look</div>;
  return null;
}

export function Help() {
  const help = useUi((s) => s.help);
  if (!help) return null;
  const rows: Array<[string, string]> = [
    ['WASD · Shift', 'Walk · run (takes over from the route)'],
    ['drag', 'Look around'],
    ['N', 'Network Vision: see the networks, the tunnel and the packets'],
    ['Shift+N', "In Vision: Infinet's map · true signal · map error"],
    ['1 · 2 · 4', 'Fast travel: office · café · desert site'],
    ['T', 'Tour: the three moments with captions (≈ 2 min)'],
    ['↑ · arrows · Enter · ⌫', 'Raise the Infinet phone and use it'],
    ['C', "Change the comparison phone: Today's phone · Strongest signal · Tunnel, no check"],
    ['hold B', 'Hear the call on the comparison phone'],
    ['hold Space', 'Slow motion 0.25×'],
    ['F9 · F10', 'Reset · performance'],
  ];
  return (
    <div className="help glass">
      <h3>Controls</h3>
      <table><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
      <p>Everything on screen is simulated with settings from published measurements. Phone → Lab → Sim notes lists every assumption and visual compression.</p>
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

export function Hud() {
  return (
    <>
      <SceneTitle />
      <CompareStrip />
      <VisionTag />
      <Hints />
      <Notifications />
      <Minimap />
      <Caption />
      <ModeBanner />
      <Help />
      <Perf />
    </>
  );
}

export type { Playable };
