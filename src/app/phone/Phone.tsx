/**
 * Infinet OS (plan §8): the product mock-up. Shows only what the phone can observe (P5):
 * scan results, its own measurements, its coverage map (belief), its own trust log.
 * Lab is the one exception and is badged "Demo controls, not part of the product".
 */
import { useEffect, useRef } from 'react';
import { PARAMS, VISUAL_NOTES, type SimSnapshot } from '../../engine/index';
import { driver, useUi, type Playable } from '../driver';
import { PixelIcon, type IconName } from '../ui/icons';
import { binColor, color, EDGE_FLOOR_DBM, fmtDb, fmtMs, fmtPct, fmtS, netState } from '../tokens';

export const APPS: Array<{ name: string; icon: IconName }> = [
  { name: 'Infinet', icon: 'infinet' }, { name: 'Networks', icon: 'wifi' }, { name: 'Call', icon: 'call' },
  { name: 'Map', icon: 'map' }, { name: 'Shield', icon: 'shield' }, { name: 'Lab', icon: 'lab' },
];

// ───────────── Lab controls (arrow-navigable) ─────────────
export interface LabControl { label: string; value: (s: SimSnapshot) => string; change?: (dir: 1 | -1, s: SimSnapshot) => void; press?: (s: SimSnapshot) => void }
const SCEN: Playable[] = ['building-exit', 'cafe-twin', 'desert-sat'];
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const LAB: LabControl[] = [
  { label: 'Scenario', value: (s) => s.scenario, change: (d, s) => driver.travel(SCEN[(SCEN.indexOf(s.scenario as Playable) + d + 3) % 3], 'free') },
  { label: 'Baseline', value: (s) => s.lab.baseline.toUpperCase(), change: () => driver.cycleBaseline() },
  { label: 'Attacker', value: (s) => (s.lab.attackerEnabled ? 'on' : 'off'), change: (_, s) => driver.setLab({ attackerEnabled: !s.lab.attackerEnabled }), press: (s) => driver.setLab({ attackerEnabled: !s.lab.attackerEnabled }) },
  { label: 'Attacker mode', value: (s) => s.lab.attackerMode, change: (_, s) => driver.setLab({ attackerMode: s.lab.attackerMode === 'intercept' ? 'relay' : 'intercept' }) },
  { label: 'Attacker power', value: (s) => `+${s.lab.attackerOffsetDb} dB vs map`, change: (d, s) => driver.setLab({ attackerOffsetDb: clamp(s.lab.attackerOffsetDb + 3 * d, 0, 27) }) },
  { label: 'Forged disconnects', value: (s) => (s.lab.deauth ? 'on' : 'off'), change: (_, s) => driver.setLab({ deauth: !s.lab.deauth }) },
  { label: 'Block threshold', value: (s) => `${s.lab.blockThreshold} points`, change: (d, s) => driver.setLab({ blockThreshold: clamp(s.lab.blockThreshold + d, 2, 8) }) },
  { label: 'LEO outage', value: (s) => (s.lab.leoOutage ? 'blocked' : 'clear'), change: (_, s) => driver.setLab({ leoOutage: !s.lab.leoOutage }), press: (s) => driver.setLab({ leoOutage: !s.lab.leoOutage }) },
  { label: 'Map staleness', value: (s) => `${Math.round(s.lab.mapStaleness * 100)}%`, change: (d, s) => driver.setLab({ mapStaleness: clamp(Math.round((s.lab.mapStaleness + 0.1 * d) * 10) / 10, 0, 1) }) },
  { label: 'Walking speed', value: (s) => `${s.lab.walkSpeed.toFixed(1)} m/s`, change: (d, s) => driver.setLab({ walkSpeed: clamp(Math.round((s.lab.walkSpeed + 0.1 * d) * 10) / 10, 0.8, 2.0) }) },
  { label: 'Seed', value: (s) => String(s.seed), press: () => driver.reset() },
  { label: 'Reset scenario', value: () => 'Enter', press: () => driver.reset() },
  { label: 'Sim notes', value: () => 'Enter ›', press: () => useUi.setState({ app: 6 }) },
  { label: 'Credits', value: () => 'Enter ›', press: () => useUi.setState({ app: 7 }) },
];

function Status({ s }: { s: SimSnapshot }) {
  const inf = s.policies.infinet;
  const blockedNow = Object.values(s.infinet.trust).some((t) => t.tier === 'blocked' && t.decidedT !== undefined && s.t - t.decidedT < 3);
  const shield = blockedNow ? netState.blocked : inf?.checked ? netState.trusted : netState.checking;
  const mm = Math.floor(s.t / 60), ss = Math.floor(s.t % 60);
  const wifi = s.scan.find((e) => inf?.wifiBssid === e.bssid);
  const cell = s.links.find((l) => l.kind === 'cell' && l.up);
  return (
    <div className="status">
      <span>{String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}</span>
      <span>{wifi ? `Wi-Fi ${fmtDb(wifi.rssiDbm)}` : ''}{cell ? `  5G ${fmtDb(cell.rsrpDbm)}` : ''}</span>
      <span className="shield cut1" style={{ background: shield.fill, color: shield.icon, boxShadow: shield.line ? `inset 0 0 0 2px ${shield.line}` : undefined }}>{blockedNow ? '✕ BLOCKED' : inf?.checked ? '✓ SAFE' : '… CHECK'}</span>
    </div>
  );
}

function Home({ sel }: { sel: number }) {
  return (
    <div className="grid">
      {APPS.map((a, i) => (
        <div key={a.name} className={`app cut2 interactive ${i === sel ? 'sel' : ''}`} onClick={() => useUi.setState({ app: i, sel: i })}>
          <PixelIcon name={a.icon} color={i === sel ? color.white : color.cyan} scale={4} />
          {a.name}
        </div>
      ))}
    </div>
  );
}

function Spark({ data, w = 370, h = 90 }: { data: number[]; w?: number; h?: number }) {
  if (data.length < 2) return null;
  const fin = data.filter(Number.isFinite);
  const max = Math.max(80, ...fin) * 1.1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (Math.min(v, max) / max) * h}`).join(' ');
  return (
    <svg width={w} height={h} style={{ background: color.night2 }}>
      <polyline points={pts} fill="none" stroke={color.cyan} strokeWidth={2} />
      <text x={4} y={14} fill={color.steel} fontSize={12} fontFamily="IBM Plex Mono">{Math.round(max)} ms</text>
    </svg>
  );
}

function InfinetApp({ s }: { s: SimSnapshot }) {
  const pv = s.policies.infinet;
  const inf = s.infinet;
  if (!pv) return null;
  const tv = pv.wifiBssid && pv.activePath?.startsWith('wifi') ? inf.trust[pv.wifiBssid] : pv.activePath ? inf.trust[pv.activePath] : undefined;
  const tier = tv?.tier === 'pipe' ? 'tunnel' : tv?.tier ?? 'unchecked';
  const satTrace = inf.pathRtts['wifi:site-net'];
  return (
    <>
      <div className="bigcard cut2">
        <div className="a">On {pv.activeLabel} · {netState[tier as keyof typeof netState].word === 'TRUSTED' ? '✓ Trusted' : netState[tier as keyof typeof netState].word}</div>
        <div className="b">{pv.mode === 'duplicate' ? 'Protected · voice on two paths' : 'Single path'} · tunnel to anchor server</div>
      </div>
      {inf.ttlS !== undefined && inf.ttlS < 10 && <div className="bigcard cut2" style={{ borderLeft: `6px solid ${color.orange}` }}><div className="a">Wi-Fi edge in {fmtS(inf.ttlS)}</div><div className="b">map {fmtS(inf.ttlMapS)} · trend {fmtS(inf.ttlTrendS)}</div></div>}
      {inf.candidate && <div className="bigcard cut2"><div className="a">Next: {inf.candidate.startsWith('cell') ? '5G' : inf.candidate} · {inf.candidateState === 'ready' ? '✓ checked' : 'checking'}</div></div>}
      <h4 style={{ fontSize: 18, marginTop: 6 }}>Paths · measured round trip</h4>
      {Object.entries(inf.pathRtts).map(([p, arr]) => {
        const fin = arr.filter(Number.isFinite);
        const med = fin.length ? [...fin].sort((a, b) => a - b)[Math.floor(fin.length / 2)] : NaN;
        return <div key={p} className="row"><span className="k">{p.replace('wifi:', 'Wi-Fi · ').replace('cell:', 'Mobile · ')}</span><span className="v">{fmtMs(med)}</span></div>;
      })}
      {satTrace && (
        <>
          <h4 style={{ fontSize: 18, marginTop: 6 }}>Satellite round trip</h4>
          <Spark data={satTrace} />
          <div className="row"><span className="k">Pattern</span><span className="v">{inf.leoPattern ? `${inf.leoPattern.periodS.toFixed(1)} s · ${inf.leoPattern.protecting ? 'protecting' : 'learned'}` : 'learning…'}</span></div>
        </>
      )}
    </>
  );
}

function NetworksApp({ s }: { s: SimSnapshot }) {
  const list = [...s.scan].sort((a, b) => b.rssiDbm - a.rssiDbm);
  return (
    <>
      <h4>Networks</h4>
      {list.map((e) => {
        const tv = s.infinet.trust[e.bssid];
        const st = netState[(tv?.tier === 'pipe' ? 'tunnel' : tv?.tier ?? 'unchecked') as keyof typeof netState];
        return (
          <div key={e.bssid} className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{e.ssid}</span>
              <span className="badge cut1" style={{ background: st.fill, color: st.icon, boxShadow: st.line ? `inset 0 0 0 2px ${st.line}` : undefined }}>{st.word}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--data)', fontSize: 14, color: 'var(--mute)' }}>
              <span>{e.bssid.slice(0, 8)}:··:··:·· · ch {e.channel} · {e.security === 'OPEN' ? 'Open' : e.security}</span>
              <span style={{ color: binColor(e.rssiDbm) === color.orange ? color.orange : color.haze }}>{fmtDb(e.rssiDbm)}</span>
            </div>
            {tv && tv.flags.length > 0 && <div style={{ fontSize: 14, color: color.orange }}>{tv.flags.map((f) => f.text).join(' · ')}</div>}
          </div>
        );
      })}
    </>
  );
}

function CallApp({ s }: { s: SimSnapshot }) {
  const pv = s.policies.infinet;
  if (!pv) return null;
  const frozen = pv.callState === 'frozen' || pv.callState === 'dropped';
  const bars = Array.from({ length: 36 }, (_, i) => (frozen ? 2 : 6 + Math.abs(Math.sin(s.t * 7 + i * 0.7) * Math.sin(s.t * 2.3 + i)) * 50));
  const start = s.scenario === 'desert-sat' ? 40 : 0;
  const el = Math.max(0, s.t - start);
  return (
    <>
      <h4>Call · Hamad</h4>
      <div className="data" style={{ fontSize: 30 }}>{String(Math.floor(el / 60)).padStart(2, '0')}:{String(Math.floor(el % 60)).padStart(2, '0')}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 70 }}>
        {bars.map((h, i) => <div key={i} style={{ width: 6, height: h, background: frozen ? color.orange : color.cyan }} />)}
      </div>
      <div className="row"><span className="k">Quality (MOS, 5 s)</span><span className="v">{pv.metrics.mos.toFixed(2)}</span></div>
      <div className="row"><span className="k">Frozen</span><span className="v">{fmtS(pv.metrics.frozenS)}</span></div>
      <div className="row"><span className="k">Voice lost or late</span><span className="v">{fmtPct(pv.metrics.voiceLostPct)}</span></div>
      <div className="row"><span className="k">Mouth to ear</span><span className="v">{fmtMs(pv.mouthToEarMs)}</span></div>
      <div className="row"><span className="k">Jitter buffer</span><span className="v">{fmtMs(pv.playoutMs)}</span></div>
      <div className="bigcard cut2" style={{ marginTop: 8 }}><div className="a" style={{ fontSize: 18 }}>Hold B · hear the call without Infinet</div><div className="b">MOS from the ITU-T G.107 E-model</div></div>
    </>
  );
}

function MapApp({ s }: { s: SimSnapshot }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const px = Math.round(s.player.pos[0]), py = Math.round(s.player.pos[1]);
  const key = `${Math.round(px / 3)},${Math.round(py / 3)},${s.lab.mapStaleness},${s.seed}`;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    const R = 46, cell = 4;
    g.fillStyle = color.night; g.fillRect(0, 0, c.width, c.height);
    for (let i = -R; i < R; i++) for (let j = -R; j < R; j++) {
      const r = driver.sim.wifiCoverage([px + i + 0.5, py + j + 0.5], 'belief');
      if (r.dbm < EDGE_FLOOR_DBM) continue;
      g.fillStyle = binColor(r.dbm);
      g.fillRect((i + R) * cell, (R - j - 1) * cell, cell - 0.6, cell - 0.6);
    }
  }, [key]);
  const R = 46, cell = 4;
  const dx = (s.player.pos[0] - px) * cell, dy = (s.player.pos[1] - py) * cell;
  const e = s.infinet.edgePoint;
  return (
    <>
      <h4>Map · what Infinet knows</h4>
      <div style={{ position: 'relative', width: 2 * R * cell, height: 2 * R * cell }}>
        <canvas ref={ref} width={2 * R * cell} height={2 * R * cell} />
        <div style={{ position: 'absolute', left: R * cell + dx - 5, top: R * cell - dy - 5, width: 10, height: 10, background: color.white }} />
        {e && s.infinet.ttlS !== undefined && s.infinet.ttlS < 8 && <div style={{ position: 'absolute', left: R * cell + (e[0] - px) * cell - 5, top: R * cell - (e[1] - py) * cell - 5, width: 10, height: 10, background: color.orange }} />}
      </div>
      <div style={{ fontSize: 14, color: 'var(--mute)' }}>Wi-Fi coverage map, 1 m cells, {Math.round(s.lab.mapStaleness * 100)}% stale. White: you. Orange: where the map says coverage ends.</div>
    </>
  );
}

function ShieldApp() {
  const log = useUi((s) => s.shield);
  return (
    <>
      <h4>Shield · security log</h4>
      {!log.length && <div style={{ color: 'var(--mute)', fontSize: 16 }}>No new networks checked yet.</div>}
      {[...log].reverse().map((e, i) => (
        <div key={i} className="bigcard cut2" style={{ borderLeft: `6px solid ${e.verdict === 'Blocked' ? color.orange : color.violet}` }}>
          <div className="a" style={{ fontSize: 18 }}>{e.verdict} · {e.ssid} <span className="data" style={{ fontSize: 14, color: 'var(--mute)' }}>t = {e.t.toFixed(1)} s</span></div>
          <div style={{ fontSize: 15, marginTop: 4 }}>{e.reason}</div>
          {e.flags.length > 0 && <div style={{ fontSize: 14, color: color.orange, marginTop: 4 }}>{e.flags.join(' · ')}</div>}
          <div className="b">handshake: {e.handshake ?? '—'} · {e.bssid.slice(0, 8)}:··</div>
        </div>
      ))}
    </>
  );
}

function LabApp({ s, sel }: { s: SimSnapshot; sel: number }) {
  return (
    <>
      <div className="labbadge cut1">Demo controls, not part of the product</div>
      {LAB.map((c, i) => (
        <div key={c.label} className={`ctl interactive ${i === sel ? 'sel' : ''}`}
          onClick={() => { useUi.setState({ labSel: i }); (c.press ?? ((x: SimSnapshot) => c.change?.(1, x)))(s); }}>
          <span>{c.label}</span><span className="v">{c.value(s)}</span>
        </div>
      ))}
      <div style={{ fontSize: 13, color: 'var(--mute)' }}>↑↓ select · ←→ change · Enter</div>
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
        {assumptions.map(([k, p]) => <p key={k}><span className="data" style={{ color: color.cyan }}>{k} = {JSON.stringify((p as any).v)}</span><br />{(p as any).src}{(p as any).verify ? ' · TO VERIFY' : ''}</p>)}
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
        <p>Fonts: Chakra Petch (Cadson Demak), IBM Plex Sans and Mono (IBM), SIL Open Font License, bundled.</p>
        <p>three.js, React Three Fiber, drei, React, zustand, Vite (MIT).</p>
        <p>World, icons, tiles and coverage cells are generated in code from the layout and the radio model. No third-party 3D models, textures or brand assets.</p>
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
  const s = useUi((st) => st.snap);
  if (!s || !up) return null;
  const title = app === null ? 'Infinet OS' : app === 6 ? 'Sim notes' : app === 7 ? 'Credits' : APPS[app].name;
  return (
    <div className="phone cut2">
      <Status s={s} />
      <div className="screen">
        {app === null && <><h4>{title}</h4><Home sel={sel} /></>}
        {app === 0 && <InfinetApp s={s} />}
        {app === 1 && <NetworksApp s={s} />}
        {app === 2 && <CallApp s={s} />}
        {app === 3 && <MapApp s={s} />}
        {app === 4 && <ShieldApp />}
        {app === 5 && <LabApp s={s} sel={labSel} />}
        {app === 6 && <NotesApp />}
        {app === 7 && <CreditsApp />}
      </div>
      <div className="hint">{app === null ? '←↑→↓ choose · Enter open · ⌫ lower' : '⌫ back'}</div>
    </div>
  );
}
