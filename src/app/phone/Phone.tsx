/**
 * Infinet OS (plan §8.4): the product mock-up, held in the right hand. Lowered, it peeks 12 % above the bottom
 * edge; raised (↑) it is a 9 : 19.5 phone. It shows only what the phone can observe (P5): scan results, its own
 * measurements, its coverage map (belief), its own trust log. Lab is the one exception and is badged
 * "Demo controls, not part of the product".
 */
import { Activity, FlaskConical, Map as MapIcon, Phone as PhoneIcon, ShieldCheck, Wifi, type LucideIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { PARAMS, VISUAL_NOTES, type SimSnapshot } from '../../engine/index';
import { driver, useUi, type Playable } from '../driver';
import { badge, fmtDb, fmtMs, fmtPct, fmtS, pathName, tech, THRESH, ui, type Tier } from '../tokens';

export const APPS: Array<{ name: string; icon: LucideIcon }> = [
  { name: 'Infinet', icon: Activity }, { name: 'Networks', icon: Wifi }, { name: 'Call', icon: PhoneIcon },
  { name: 'Map', icon: MapIcon }, { name: 'Shield', icon: ShieldCheck }, { name: 'Lab', icon: FlaskConical },
];

// ───────────── Lab controls (arrow-navigable) ─────────────
export interface LabControl { label: string; value: (s: SimSnapshot) => string; change?: (dir: 1 | -1, s: SimSnapshot) => void; press?: (s: SimSnapshot) => void }
const SCEN: Playable[] = ['building-exit', 'cafe-twin', 'desert-sat'];
const SCEN_NAME: Record<string, string> = { 'building-exit': 'Leaving the office', 'cafe-twin': 'Café copy', 'desert-sat': 'Desert site' };
const BASE: Record<string, string> = { b1: "Today's phone", b2: 'Strongest signal', b3: 'Tunnel, no check' };
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const LAB: LabControl[] = [
  { label: 'Scenario', value: (s) => SCEN_NAME[s.scenario] ?? s.scenario, change: (d, s) => driver.travel(SCEN[(SCEN.indexOf(s.scenario as Playable) + d + 3) % 3], 'free') },
  { label: 'Compare with', value: (s) => BASE[s.lab.baseline], change: () => driver.cycleBaseline() },
  { label: 'Attacker', value: (s) => (s.lab.attackerEnabled ? 'on' : 'off'), change: (_, s) => driver.setLab({ attackerEnabled: !s.lab.attackerEnabled }), press: (s) => driver.setLab({ attackerEnabled: !s.lab.attackerEnabled }) },
  { label: 'Attacker mode', value: (s) => s.lab.attackerMode, change: (_, s) => driver.setLab({ attackerMode: s.lab.attackerMode === 'intercept' ? 'relay' : 'intercept' }) },
  { label: 'Attacker power', value: (s) => `+${s.lab.attackerOffsetDb} dB vs map`, change: (d, s) => driver.setLab({ attackerOffsetDb: clamp(s.lab.attackerOffsetDb + 3 * d, 0, 27) }) },
  { label: 'Forged disconnects', value: (s) => (s.lab.deauth ? 'on' : 'off'), change: (_, s) => driver.setLab({ deauth: !s.lab.deauth }) },
  { label: 'Block threshold', value: (s) => `${s.lab.blockThreshold} points`, change: (d, s) => driver.setLab({ blockThreshold: clamp(s.lab.blockThreshold + d, 2, 8) }) },
  { label: 'LEO outage', value: (s) => (s.lab.leoOutage ? 'blocked' : 'clear'), change: (_, s) => driver.setLab({ leoOutage: !s.lab.leoOutage }), press: (s) => driver.setLab({ leoOutage: !s.lab.leoOutage }) },
  { label: 'Map staleness', value: (s) => `${Math.round(s.lab.mapStaleness * 100)} %`, change: (d, s) => driver.setLab({ mapStaleness: clamp(Math.round((s.lab.mapStaleness + 0.1 * d) * 10) / 10, 0, 1) }) },
  { label: 'Walking speed', value: (s) => `${s.lab.walkSpeed.toFixed(1)} m/s`, change: (d, s) => driver.setLab({ walkSpeed: clamp(Math.round((s.lab.walkSpeed + 0.1 * d) * 10) / 10, 0.8, 2.0) }) },
  { label: 'Seed', value: (s) => String(s.seed), press: () => driver.reset() },
  { label: 'Reset scenario', value: () => 'Enter', press: () => driver.reset() },
  { label: 'Sim notes', value: () => 'Enter ›', press: () => useUi.setState({ app: 6 }) },
  { label: 'Credits', value: () => 'Enter ›', press: () => useUi.setState({ app: 7 }) },
];

function Badge({ tier }: { tier: Tier }) {
  const b = badge[tier];
  return <span className="badge" style={{ color: b.color, borderColor: b.color }}>{b.icon} {b.word}</span>;
}

function Status({ s }: { s: SimSnapshot }) {
  const inf = s.policies.infinet;
  const blockedNow = Object.values(s.infinet.trust).some((t) => t.tier === 'blocked' && t.decidedT !== undefined && s.t - t.decidedT < 3);
  const mm = Math.floor(s.t / 60), ss = Math.floor(s.t % 60);
  const wifi = s.scan.find((e) => inf?.wifiBssid === e.bssid);
  const cell = s.links.find((l) => l.kind === 'cell' && l.up);
  const [c, word] = blockedNow ? [tech.threat, '✕ Blocked'] : inf?.checked ? [tech.ok, '✓ Safe'] : [tech.check, '… Checking'];
  return (
    <div className="status">
      <span className="num">10:{String((12 + mm) % 60).padStart(2, '0')}<span style={{ color: ui.dim }}>:{String(ss).padStart(2, '0')}</span></span>
      <span className="r">
        {wifi && <Wifi size={15} />}
        {cell && <span style={{ color: tech.cell }}>5G</span>}
        <span className="shieldpill" style={{ color: c, background: `${c}22` }}>{word}</span>
      </span>
    </div>
  );
}

function Home({ sel }: { sel: number }) {
  return (
    <div className="grid">
      {APPS.map((a, i) => {
        const Ic = a.icon;
        return (
          <div key={a.name} className={`app interactive ${i === sel ? 'sel' : ''}`} onClick={() => useUi.setState({ app: i, sel: i })}>
            <div className="ico"><Ic size={28} strokeWidth={1.8} /></div>
            {a.name}
          </div>
        );
      })}
    </div>
  );
}

function Spark({ data, w = 300, h = 80 }: { data: number[]; w?: number; h?: number }) {
  if (data.length < 2) return null;
  const fin = data.filter(Number.isFinite);
  const max = Math.max(80, ...fin) * 1.1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (Math.min(v, max) / max) * h}`).join(' ');
  return (
    <svg width={w} height={h} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10 }}>
      <polyline points={pts} fill="none" stroke={tech.sat} strokeWidth={2} />
      <text x={6} y={15} fill={ui.mute} fontSize={12} fontFamily="JetBrains Mono">{Math.round(max)} ms</text>
    </svg>
  );
}

function InfinetApp({ s }: { s: SimSnapshot }) {
  const pv = s.policies.infinet;
  const inf = s.infinet;
  if (!pv) return null;
  const tv = pv.wifiBssid && pv.activePath?.startsWith('wifi') ? inf.trust[pv.wifiBssid] : pv.activePath ? inf.trust[pv.activePath] : undefined;
  const satTrace = inf.pathRtts['wifi:site-net'];
  const sat = inf.satPatient;
  return (
    <>
      <h4>Infinet</h4>
      <div className="card">
        <div className="a" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{pathName(pv.activePath)}</span>{tv && <Badge tier={tv.tier} />}</div>
        <div className="b">{pv.mode === 'duplicate' ? 'Voice on two paths while it switches' : 'One path'} · encrypted tunnel to the anchor server</div>
      </div>
      {inf.ttlS !== undefined && inf.ttlS < 10 && (
        <div className="card warn"><div className="a" style={{ color: tech.check }}>Wi-Fi edge in {fmtS(inf.ttlS)}</div><div className="b">map says {fmtS(inf.ttlMapS)} · signal trend says {fmtS(inf.ttlTrendS)}</div></div>
      )}
      {inf.candidate && <div className="card"><div className="a">Next: {pathName(inf.candidate)}</div><div className="b">{inf.candidateState === 'ready' ? '✓ checked and ready' : 'checking it before use…'}</div></div>}
      <div>
        {Object.entries(inf.pathRtts).map(([p, arr]) => {
          const fin = arr.filter(Number.isFinite);
          const med = fin.length ? [...fin].sort((a, b) => a - b)[Math.floor(fin.length / 2)] : NaN;
          return <div key={p} className="row"><span className="k">{pathName(p)} · round trip</span><span className="v">{fmtMs(med)}</span></div>;
        })}
      </div>
      {satTrace && (
        <>
          <Spark data={satTrace} />
          <div className="row"><span className="k">Satellite timer</span><span className="v">{sat ? `dead after ${fmtMs(sat.rtoMs)}` : '—'}</span></div>
          <div className="row"><span className="k">Pattern</span><span className="v">{inf.leoPattern ? `${inf.leoPattern.periodS.toFixed(1)} s · ${inf.leoPattern.protecting ? 'protecting' : 'learned'}` : 'learning…'}</span></div>
        </>
      )}
    </>
  );
}

const SEC: Record<string, string> = { OPEN: 'Open', OWE: 'Enhanced Open', 'WPA2-PSK': 'WPA2', 'WPA3-SAE': 'WPA3', 'WPA3-ENT': 'WPA3-Ent' };
function NetworksApp({ s }: { s: SimSnapshot }) {
  const list = [...s.scan].sort((a, b) => b.rssiDbm - a.rssiDbm);
  return (
    <>
      <h4>Networks</h4>
      <div>
        {list.map((e) => {
          const tv = s.infinet.trust[e.bssid];
          return (
            <div key={e.bssid} className="net">
              <div className="l1"><span>{e.ssid}</span><Badge tier={tv?.tier ?? 'unchecked'} /></div>
              <div className="l2"><span>{e.bssid.slice(0, 8)}:··:·· · ch {e.channel} · {SEC[e.security] ?? e.security}</span><span style={{ color: e.rssiDbm < THRESH.wifiData ? tech.check : ui.text }}>{fmtDb(e.rssiDbm)}</span></div>
              {tv && tv.flags.length > 0 && <div className="fl">{tv.flags.map((f) => f.text).join(' · ')}</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function CallApp({ s }: { s: SimSnapshot }) {
  const pv = s.policies.infinet;
  if (!pv) return null;
  const frozen = pv.callState === 'frozen' || pv.callState === 'dropped';
  const bars = Array.from({ length: 30 }, (_, i) => (frozen ? 3 : 6 + Math.abs(Math.sin(s.t * 7 + i * 0.7) * Math.sin(s.t * 2.3 + i)) * 50));
  const start = s.scenario === 'desert-sat' ? 40 : 0;
  const el = Math.max(0, s.t - start);
  return (
    <>
      <h4>Call · Hamad</h4>
      <div className="num" style={{ fontSize: 30, fontWeight: 500 }}>{String(Math.floor(el / 60)).padStart(2, '0')}:{String(Math.floor(el % 60)).padStart(2, '0')}</div>
      <div className={`wave ${frozen ? 'bad' : ''}`}>{bars.map((h, i) => <i key={i} style={{ height: h }} />)}</div>
      <div>
        <div className="row"><span className="k">Quality (MOS, 5 s)</span><span className="v">{pv.metrics.mos.toFixed(2)}</span></div>
        <div className="row"><span className="k">Frozen</span><span className="v">{fmtS(pv.metrics.frozenS)}</span></div>
        <div className="row"><span className="k">Voice lost or late</span><span className="v">{fmtPct(pv.metrics.voiceLostPct)}</span></div>
        <div className="row"><span className="k">Mouth to ear</span><span className="v">{fmtMs(pv.mouthToEarMs)}</span></div>
        <div className="row"><span className="k">Jitter buffer</span><span className="v">{fmtMs(pv.playoutMs)}</span></div>
      </div>
      <div className="card"><div className="a">Hold B · hear the other phone</div><div className="b">MOS from the ITU-T G.107 E-model</div></div>
    </>
  );
}

function MapApp({ s }: { s: SimSnapshot }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const px = Math.round(s.player.pos[0]), py = Math.round(s.player.pos[1]);
  const R = 40, cell = 4;
  const key = `${Math.round(px / 3)},${Math.round(py / 3)},${s.lab.mapStaleness},${s.seed}`;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    g.fillStyle = '#0b0e14'; g.fillRect(0, 0, c.width, c.height);
    for (let i = -R; i < R; i++) for (let j = -R; j < R; j++) {
      const r = driver.sim.wifiCoverage([px + i + 0.5, py + j + 0.5], 'belief');
      if (r.dbm < -85) continue;
      const a = 0.15 + 0.75 * Math.min(1, (r.dbm + 85) / 35);
      g.fillStyle = r.dbm >= THRESH.wifiVoice ? `rgba(77,163,255,${a})` : r.dbm >= THRESH.wifiData ? `rgba(77,163,255,${a * 0.6})` : `rgba(251,191,36,${a * 0.8})`;
      g.fillRect((i + R) * cell, (R - j - 1) * cell, cell, cell);
    }
  }, [key]);  
  const dx = (s.player.pos[0] - px) * cell, dy = (s.player.pos[1] - py) * cell;
  const e = s.infinet.edgePoint;
  return (
    <>
      <h4>Map</h4>
      <div className="sub">What Infinet knows: its Wi-Fi coverage map, 1 m cells, {Math.round(s.lab.mapStaleness * 100)} % stale.</div>
      <div style={{ position: 'relative', width: 2 * R * cell, height: 2 * R * cell, borderRadius: 12, overflow: 'hidden', alignSelf: 'center' }}>
        <canvas ref={ref} width={2 * R * cell} height={2 * R * cell} />
        <div style={{ position: 'absolute', left: R * cell + dx - 6, top: R * cell - dy - 6, width: 12, height: 12, borderRadius: 6, background: '#fff', boxShadow: '0 0 0 3px rgba(0,0,0,0.5)' }} />
        {e && s.infinet.ttlS !== undefined && s.infinet.ttlS < 10 && <div style={{ position: 'absolute', left: R * cell + (e[0] - px) * cell - 6, top: R * cell - (e[1] - py) * cell - 6, width: 12, height: 12, borderRadius: 6, border: `3px solid ${tech.check}` }} />}
      </div>
      <div className="sub" style={{ fontSize: 14 }}>Blue: good for calls (≥ −67 dBm). Amber: the edge. Ring: where the map says coverage ends.</div>
    </>
  );
}

function ShieldApp() {
  const log = useUi((s) => s.shield);
  return (
    <>
      <h4>Shield</h4>
      <div className="sub">Every new network is checked before it is trusted.</div>
      {!log.length && <div className="sub">No new networks checked yet.</div>}
      {[...log].reverse().slice(0, 5).map((e, i) => (
        <div key={i} className={`card ${e.verdict === 'Blocked' ? 'bad' : ''}`}>
          <div className="a">{e.verdict} · {e.ssid} <span className="num" style={{ fontSize: 13, color: ui.mute }}>t = {e.t.toFixed(1)} s</span></div>
          <div className="b">{e.reason}</div>
          {e.flags.length > 0 && <div className="b" style={{ color: tech.threat }}>{e.flags.join(' · ')}</div>}
        </div>
      ))}
    </>
  );
}

function LabApp({ s, sel }: { s: SimSnapshot; sel: number }) {
  return (
    <>
      <div className="labbadge">Demo controls, not part of the product</div>
      <div style={{ overflow: 'hidden' }}>
        {LAB.map((c, i) => (
          <div key={c.label} className={`ctl interactive ${i === sel ? 'sel' : ''}`}
            onClick={() => { useUi.setState({ labSel: i }); (c.press ?? ((x: SimSnapshot) => c.change?.(1, x)))(s); }}>
            <span>{c.label}</span><span className="v">{c.value(s)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function NotesApp() {
  const assumptions = Object.entries(PARAMS).filter(([, p]) => (p as any).src.includes('ASSUMPTION') || (p as any).verify);
  return (
    <>
      <h4>Sim notes</h4>
      <div className="scroll">
        <p><b>Visual compressions</b></p>
        {VISUAL_NOTES.map((n, i) => <p key={i}>• {n}</p>)}
        <p><b>Every assumption ({assumptions.length})</b></p>
        {assumptions.map(([k, p]) => <p key={k}><span className="num" style={{ color: tech.tunnel }}>{k} = {JSON.stringify((p as any).v)}</span><br />{(p as any).src}{(p as any).verify ? ' · TO VERIFY' : ''}</p>)}
      </div>
    </>
  );
}

function CreditsApp() {
  return (
    <>
      <h4>Credits</h4>
      <div className="scroll">
        <p>Team Infinet · ATRC ATP 2026 · EDGE · Stand 31.</p>
        <p>Skies and surface textures: Poly Haven (CC0). Props and the placeholder figure: built in Blender by script for this demo.</p>
        <p>Fonts: Inter and JetBrains Mono (SIL Open Font License), bundled. Icons: Lucide (ISC).</p>
        <p>three.js, React Three Fiber, drei, postprocessing, N8AO, React, zustand, Vite (MIT).</p>
        <p>Models and numbers: 3GPP TR 38.901, ITU-T G.107/G.113, IEEE 802.11, RFC 6298, RFC 2198, RFC 3550, published LEO/GEO and app-reconnect measurements. See Sim notes.</p>
      </div>
    </>
  );
}

export function Phone() {
  const up = useUi((s) => s.phoneUp);
  const app = useUi((s) => s.app);
  const sel = useUi((s) => s.sel);
  const labSel = useUi((s) => s.labSel);
  const unread = useUi((s) => s.unread);
  const s = useUi((st) => st.snap);
  if (!s) return null;
  return (
    <div className={`phone ${up ? '' : 'down'}`} onClick={() => { if (!up) useUi.setState({ phoneUp: true, unread: 0 }); }}>
      <div className="scr">
        <div className="island" />
        <Status s={s} />
        {!up ? (
          <div className="peek"><span>↑ Raise the Infinet phone</span>{unread ? <span className="badge2">{unread}</span> : null}</div>
        ) : (
          <>
            <div className="body">
              {app === null && <><h4>Infinet OS</h4><Home sel={sel} /></>}
              {app === 0 && <InfinetApp s={s} />}
              {app === 1 && <NetworksApp s={s} />}
              {app === 2 && <CallApp s={s} />}
              {app === 3 && <MapApp s={s} />}
              {app === 4 && <ShieldApp />}
              {app === 5 && <LabApp s={s} sel={labSel} />}
              {app === 6 && <NotesApp />}
              {app === 7 && <CreditsApp />}
            </div>
            <div className="hint">{app === null ? 'arrows choose · Enter opens · ⌫ lowers' : app === 5 ? '↑↓ select · ←→ change · Enter · ⌫ back' : '⌫ back'}</div>
          </>
        )}
      </div>
    </div>
  );
}
