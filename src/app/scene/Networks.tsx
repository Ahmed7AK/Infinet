/**
 * Networks and you (style guide p. 21):
 *  - a network is a pixel-icon tile on a thin pole; the tile's style is its state (Infinet's trust view)
 *  - you are a white column with a cyan ring while the call is live (orange while frozen)
 *  - the tunnel is a violet line to the anchor server: dashed while handing over, doubled while duplicating
 *  - Today's phone: a thin Steel line to the network it uses (orange if that network is the copy)
 * Labels are HTML on top, never textures: see labels.tsx (one DOM layer, projected every frame).
 */
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type JSX, type ReactNode } from 'react';
import * as THREE from 'three';
import { geoLookAngle, LAYOUT, PARAMS, type PolicyView, type SimSnapshot, type Tier, type TrustView, type Vec2 } from '../../engine/index';
import { leoPassAzEl } from '../../engine/geo';
import { driver, useUi } from '../driver';
import { PixelIcon, type IconName } from '../ui/icons';
import { color, fmtDb, fmtS, netState, type NetStateKey } from '../tokens';
import type { LabelItem, V3 } from './labels';

const w3 = (x: number, y: number, h = 0): V3 => [x, h, -y];
const TX = LAYOUT.transmitters;
const tx = (id: string) => TX.find((t) => t.id === id)!;

const FRIENDLY: Record<string, string> = {
  'office-corp': 'Office Wi-Fi', 'cafe-guest': 'Café Wi-Fi', twin: 'Café Wi-Fi (copy)', 'site-net': 'Site Wi-Fi',
  'cell-a': '5G · Cellular A', 'cell-b': '5G · Cellular B',
};
const tierKey = (t?: Tier): NetStateKey => (t === 'pipe' ? 'tunnel' : t ?? 'unchecked') as NetStateKey;

// ───────────── geometry helpers ─────────────
const SAT = { leoR: 10, geoR: 11 };
function terminalPos(): V3 { const p = LAYOUT.props.leoTerminal as number[]; return w3(p[0], p[1], p[2] ?? 3); }
function dishPos(): V3 { const p = LAYOUT.props.geoDish as Vec2; return w3(p[0], p[1], 2); }
function skyPos(base: V3, azDeg: number, elDeg: number, r: number): V3 {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  return [base[0] + Math.sin(az) * Math.cos(el) * r, base[1] + Math.sin(el) * r, base[2] - Math.cos(az) * Math.cos(el) * r];
}
const GEO_LOOK = geoLookAngle(LAYOUT.site.latDeg, LAYOUT.site.lonDeg, PARAMS.geoSatLonDeg.v);
function leoSat(s: SimSnapshot): V3 {
  const { azDeg, elDeg } = leoPassAzEl(0.15 + 0.7 * s.truth.leoBoundaryPhase, (s.truth.leoSatIndex * 67) % 360, 72);
  return skyPos(terminalPos(), azDeg, elDeg, SAT.leoR);
}
function geoSat(): V3 { return skyPos(dishPos(), GEO_LOOK.azDeg, GEO_LOOK.elDeg, SAT.geoR); }

/** where a path's radio hop ends (the tile you see), from the policy's own association */
function endpoint(path: string, pv?: PolicyView): V3 | null {
  const [kind, net] = path.split(':');
  if (kind === 'cell') {
    const t = TX.find((x) => x.kind === 'cell' && x.net === net);
    return t ? w3(t.pos[0], t.pos[1], t.pos[2]) : null;
  }
  const byBssid = pv?.wifiBssid ? TX.find((x) => x.bssid === pv.wifiBssid && x.net === net) : undefined;
  const t = byBssid ?? TX.find((x) => x.kind === 'wifi' && x.net === net);
  return t ? w3(t.pos[0], t.pos[1], t.pos[2] + 0.6) : null;
}

/** onward hops after the radio: anchor server (or the satellite bent pipe in the desert) */
function onward(path: string, s: SimSnapshot): V3[] {
  if (path === 'wifi:site-net') {
    if (s.truth.uplink === 'none') return [];
    const sat = s.truth.uplink === 'GEO' ? geoSat() : leoSat(s);
    const term = s.truth.uplink === 'GEO' ? dishPos() : terminalPos();
    const gw = LAYOUT.visual.gateway.pos, an = LAYOUT.visual.anchorDesert.pos;
    return [term, sat, w3(gw[0], gw[1], 2), w3(an[0], an[1], 8)];
  }
  if (path === 'wifi:twin') return [];
  const a = LAYOUT.visual.anchor.pos;
  return [w3(a[0], a[1], 8)];
}

const visibleTx = (s: SimSnapshot) => TX.filter((t) => (s.zone === 'desert' ? t.pos[0] > 5000 : t.pos[0] < 5000)).filter((t) => !t.attacker || s.truth.attackerOn);
const isOnWifi = (pv?: PolicyView) => !!pv && (!!pv.activePath?.startsWith('wifi') || pv.dupPaths.some((p) => p.startsWith('wifi')));

function trustFor(s: SimSnapshot, t: (typeof TX)[number]): TrustView | undefined {
  if (t.kind === 'cell') return s.infinet.trust[`cell:${t.net}`];
  return t.bssid ? s.infinet.trust[t.bssid] : undefined;
}

// ───────────── HTML labels (built from the snapshot, drawn by labels.tsx) ─────────────
function tileNode(icon: IconName, name: string, st: NetStateKey, detail?: string): ReactNode {
  const ns = netState[st];
  return (
    <div className="tile">
      <div className={`ico cut1 ${ns.line ? 'line' : ''}`} style={{ background: ns.fill, ['--line' as any]: ns.line ?? 'transparent' }}>
        <PixelIcon name={icon} color={ns.icon} scale={3} />
      </div>
      <div className="txt cut1">
        <div className="n">{name}</div>
        <div className="s">{ns.word}{detail ? <> · <span className="d">{detail}</span></> : null}</div>
      </div>
    </div>
  );
}
function plainNode(icon: IconName, name: string, sub: string, fill: string = color.night2, iconColor: string = color.white): ReactNode {
  return (
    <div className="tile">
      <div className="ico cut1" style={{ background: fill }}><PixelIcon name={icon} color={iconColor} scale={3} /></div>
      <div className="txt cut1"><div className="n">{name}</div><div className="s">{sub}</div></div>
    </div>
  );
}

const VERDICT: Record<string, string> = { blocked: 'Blocked', pipe: 'Tunnel only', trusted: 'Trusted', checking: 'Checking', unchecked: 'Not checked' };

export function worldLabels(s: SimSnapshot, view: string): LabelItem[] {
  const out: LabelItem[] = [];
  const scan = new Map(s.scan.map((e) => [e.bssid, e.rssiDbm]));
  // network tiles
  for (const t of visibleTx(s)) {
    const tv = trustFor(s, t);
    const isCell = t.kind === 'cell';
    const link = isCell ? s.links.find((l) => l.id === `cell:${t.net}`) : undefined;
    const detail = isCell ? fmtDb(link?.rsrpDbm) : t.bssid && scan.has(t.bssid) ? fmtDb(scan.get(t.bssid)) : undefined;
    const name = t.attacker ? FRIENDLY.twin : FRIENDLY[t.net] ?? t.net;
    const h = isCell ? t.pos[2] : t.pos[2] + 0.6;
    out.push({ key: `tile:${t.id}`, pos: w3(t.pos[0], t.pos[1], h), z: 1, node: tileNode(isCell ? 'mast' : t.net === 'site-net' ? 'router' : t.attacker ? 'laptop' : 'wifi', name, tierKey(tv?.tier), detail) });
  }
  if (s.zone !== 'desert') {
    const a = LAYOUT.visual.anchor.pos;
    out.push({ key: 'anchor', pos: w3(a[0], a[1], 10), z: 1, node: plainNode('anchor', 'Anchor server', 'Encrypted tunnel ends here', color.violet) });
  } else {
    const leoUp = s.truth.uplink === 'LEO', geoUp = s.truth.uplink === 'GEO';
    const pat = s.infinet.satPatient;
    const gw = LAYOUT.visual.gateway.pos, an = LAYOUT.visual.anchorDesert.pos;
    out.push({ key: 'leo', pos: leoSat(s), z: 1, node: plainNode('satellite', 'Low-orbit satellite', s.truth.leoOutage ? 'Blocked · ~550 km · not to scale' : `~550 km · not to scale${s.truth.leoSpikeActive ? ' · re-pointing' : ''}`, leoUp ? color.violet : color.night3, leoUp ? color.white : '#9AA0B4') });
    out.push({ key: 'geo', pos: geoSat(), z: 1, node: plainNode('satellite', 'GEO satellite', `35,786 km · not to scale${geoUp && pat ? ` · ${Math.round(pat.rttMs)} ms round trip` : ''}`, geoUp ? color.violet : color.night3, geoUp ? color.white : '#9AA0B4') });
    out.push({ key: 'gw', pos: w3(gw[0], gw[1], 6), z: 1, node: plainNode('router', 'Satellite gateway', 'Hundreds of km away') });
    out.push({ key: 'anchorD', pos: w3(an[0], an[1], 10), z: 1, node: plainNode('anchor', 'Anchor server', 'Encrypted tunnel ends here', color.violet) });
  }
  // trust cards (Feature 2, beside the network when the check runs / ends)
  for (const tv of Object.values(s.infinet.trust)) {
    if (tv.net.startsWith('cell') || !tv.steps.length) continue;
    const recent = tv.decidedT !== undefined && s.t - tv.decidedT < 12 && tv.firstSeenT > 0.5;
    if (!(tv.tier === 'checking' || tv.tier === 'blocked' || recent)) continue;
    const t = TX.find((x) => x.bssid === tv.bssid);
    if (!t || (t.attacker && !s.truth.attackerOn)) continue;
    const name = t.attacker ? FRIENDLY.twin : FRIENDLY[t.net] ?? tv.ssid;
    out.push({
      key: `trust:${tv.bssid}`, pos: w3(t.pos[0], t.pos[1], t.pos[2] + 0.6), z: 3, card: 'left',
      node: (
        <div className={`trustcard cut2 ${tv.tier}`}>
          <div className="t">{name}</div>
          <ul>
            {tv.steps.map((st, i) => (
              <li key={i} className={st.ok === null ? 'wait' : st.ok ? 'good' : 'bad'}>
                <span className="m">{st.ok === null ? '…' : st.ok ? '✓' : '✕'}</span><span>{st.text}</span>
              </li>
            ))}
          </ul>
          <div className="carry">May carry: {tv.mayCarry}</div>
          <div className="verdict cut1">{VERDICT[tv.tier]}</div>
        </div>
      ),
    });
  }
  // what the copy gets from Today's phone: Simulation view only (the phone could not know this, P5)
  const base = s.policies[s.lab.baseline];
  if (view !== 'belief' && s.truth.attackerOn && base?.activePath === 'wifi:twin') {
    const t = tx('twin');
    out.push({
      key: 'attacker', pos: w3(t.pos[0], t.pos[1], 0.2), z: 3, card: 'below-left',
      node: (
        <div className="trustcard cut2" style={{ width: 340 }}>
          <div className="t">Simulation view · the copy sees</div>
          <ul>
            <li className="bad"><span className="m">•</span><span>{base.tunnel ? 'Only tunnel ciphertext' : 'DNS lookups and sites visited'}</span></li>
            {!base.tunnel && <li className="bad"><span className="m">•</span><span>Can show a fake login page</span></li>}
            <li className="bad"><span className="m">•</span><span>Can delay or drop your traffic</span></li>
          </ul>
        </div>
      ),
    });
  }
  // predicted edge (Feature 1, in world space)
  const inf = s.infinet;
  if (isOnWifi(s.policies.infinet) && inf.ttlS !== undefined && inf.ttlS < 8 && inf.edgePoint) {
    out.push({ key: 'edge', pos: w3(inf.edgePoint[0], inf.edgePoint[1], 0.4), z: 2, node: <div className="edgelabel cut1">Coverage ends · seen on the map · <span className="d">{fmtS(inf.ttlS)}</span></div> });
  }
  // you
  const st = s.policies.infinet?.callState ?? 'live';
  const word = st === 'frozen' ? 'Call frozen' : st === 'dropped' ? 'Call dropped' : st === 'handover' ? 'Handing over' : 'Call live';
  out.push({ key: 'you', pos: () => w3(driver.snap.player.pos[0], driver.snap.player.pos[1], 2.4), z: 4, node: <div className={`you cut1 ${st === 'frozen' || st === 'dropped' ? 'frozen' : ''}`}>YOU · {word.toUpperCase()}</div> });
  return out;
}

// ───────────── 3D: poles, desert hardware, beams ─────────────
function Poles({ s }: { s: SimSnapshot }) {
  return (
    <>
      {visibleTx(s).map((t) => {
        const h = t.kind === 'cell' ? t.pos[2] : t.pos[2] + 0.6;
        return (
          <mesh key={t.id} position={[t.pos[0], h / 2, -t.pos[1]]}>
            <boxGeometry args={[0.08, h, 0.08]} />
            <meshBasicMaterial color={color.steel} />
          </mesh>
        );
      })}
    </>
  );
}

function DesertHardware({ s }: { s: SimSnapshot }) {
  if (s.zone !== 'desert') return null;
  const term = terminalPos(), dish = dishPos();
  const leoUp = s.truth.uplink === 'LEO', geoUp = s.truth.uplink === 'GEO';
  return (
    <>
      <mesh position={[term[0], term[1] / 2, term[2]]}><boxGeometry args={[0.6, term[1], 0.6]} /><meshLambertMaterial color={color.night3} /></mesh>
      <mesh position={[dish[0], 1, dish[2]]}><boxGeometry args={[1.2, 2, 0.3]} /><meshLambertMaterial color={color.night3} /></mesh>
      {/* the terminal's beam to the satellite it is using (re-points every 15 s, sometimes to the same one) */}
      {leoUp && <Line points={[term, leoSat(s)]} color={color.cyan} lineWidth={1.5} dashed dashSize={0.6} gapSize={0.4} />}
      {geoUp && <Line points={[dish, geoSat()]} color={color.cyan} lineWidth={1.5} dashed dashSize={0.6} gapSize={0.4} />}
    </>
  );
}

// ───────────── you ─────────────
const ringGeo = new THREE.RingGeometry(0.62, 0.84, 4, 1, Math.PI / 4); // square ring: no circles for containers
ringGeo.rotateX(-Math.PI / 2);
function Avatar() {
  const g = useRef<THREE.Group>(null);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: color.cyan, side: THREE.DoubleSide }), []);
  useFrame(() => {
    const s = driver.snap;
    g.current?.position.set(s.player.pos[0], 0, -s.player.pos[1]);
    const st = s.policies.infinet?.callState;
    ringMat.color.set(st === 'frozen' || st === 'dropped' ? color.orange : color.cyan);
  });
  return (
    <group ref={g}>
      <mesh position={[0, 0.9, 0]}>
        <boxGeometry args={[0.5, 1.8, 0.5]} />
        <meshLambertMaterial color={color.white} />
      </mesh>
      <mesh geometry={ringGeo} material={ringMat} position-y={0.04} />
    </group>
  );
}

// ───────────── lines ─────────────
function Lines({ s }: { s: SimSnapshot }) {
  const me: V3 = w3(s.player.pos[0], s.player.pos[1], 1.4);
  const meLow: V3 = w3(s.player.pos[0], s.player.pos[1], 0.9);
  const inf = s.policies.infinet;
  const base = s.policies[s.lab.baseline];
  const out: JSX.Element[] = [];
  if (inf && inf.callState !== 'dropped') {
    const paths = inf.dupPaths.length ? inf.dupPaths : inf.activePath ? [inf.activePath] : [];
    const handing = inf.callState === 'handover' && !inf.dupPaths.length;
    paths.forEach((p, i) => {
      const e = endpoint(p, p.startsWith('wifi') ? inf : undefined);
      if (!e) return;
      out.push(<Line key={`inf${i}`} points={[me, e, ...onward(p, s)]} color={color.violet} lineWidth={4} dashed={handing} dashSize={0.8} gapSize={0.5} />);
    });
    const cand = s.infinet.candidate;
    if (cand && s.infinet.candidateState === 'checking' && !paths.includes(cand)) {
      const e = endpoint(cand);
      if (e) out.push(<Line key="cand" points={[me, e]} color={color.cyan} lineWidth={2} dashed dashSize={0.6} gapSize={0.6} />);
    }
  }
  if (base && base.activePath && base.callState !== 'dropped') {
    const e = endpoint(base.activePath, base);
    const onCopy = base.activePath === 'wifi:twin';
    if (e) out.push(<Line key="base" points={[meLow, e]} color={onCopy ? color.orange : color.steel} lineWidth={onCopy ? 3 : 2} />);
  }
  return <>{out}</>;
}

// ───────────── prediction (forecast dots + edge cell) ─────────────
function Prediction({ s }: { s: SimSnapshot }) {
  const inf = s.infinet;
  const onWifi = isOnWifi(s.policies.infinet);
  const show = onWifi && inf.ttlS !== undefined && inf.ttlS < 8 && inf.edgePoint;
  return (
    <>
      {onWifi && inf.forecast.slice(1).map((p, i) => (
        <mesh key={i} position={w3(p[0], p[1], 0.05)} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.3, 0.3]} />
          <meshBasicMaterial color={color.violet} />
        </mesh>
      ))}
      {show && (
        <mesh position={w3(inf.edgePoint![0], inf.edgePoint![1], 0.06)} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.84, 0.84]} />
          <meshBasicMaterial color={color.orange} />
        </mesh>
      )}
    </>
  );
}

// ───────────── packets (time-stretched ×4, labelled in Sim notes) ─────────────
const PK_MAX = 160;
function Packets() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(0.22, 0.22, 0.22), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff' }), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), c: new THREE.Color(), zero: new THREE.Matrix4().makeScale(0, 0, 0), a: new THREE.Vector3(), b: new THREE.Vector3() }), []);
  useFrame(() => {
    const im = mesh.current;
    if (!im) return;
    const s = driver.snap;
    const base = s.lab.baseline;
    const me = w3(s.player.pos[0], s.player.pos[1], 1.2);
    let i = 0;
    for (const p of s.packets) {
      if (i >= PK_MAX) break;
      if (p.policy !== 'infinet' && p.policy !== base) continue;
      const D = Math.min(3, Math.max(0.25, (p.t1 - p.t0) * 4));
      const f = (s.t - p.t0) / D;
      if (f < 0 || f > 1) continue;
      const pv = s.policies[p.policy];
      const e = endpoint(p.path, p.path.startsWith('wifi') ? pv : undefined);
      if (!e) continue;
      tmp.a.set(...me);
      tmp.b.set(...e);
      if (p.lost && f > 0.6) {
        tmp.m.makeScale(1.8, 1.8, 1.8).setPosition(tmp.b);
        im.setColorAt(i, tmp.c.set(color.orange));
      } else {
        tmp.a.lerp(tmp.b, Math.min(1, f * 1.15));
        tmp.m.makeTranslation(tmp.a.x, tmp.a.y + (p.policy === 'infinet' ? 0 : -0.4), tmp.a.z);
        im.setColorAt(i, tmp.c.set(p.sealed ? '#C9B3FF' : color.white));
      }
      im.setMatrixAt(i++, tmp.m);
    }
    for (; i < PK_MAX; i++) im.setMatrixAt(i, tmp.zero);
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geo, mat, PK_MAX]} frustumCulled={false} />;
}

export function Networks() {
  const s = useUi((st) => st.snap);
  if (!s) return null;
  return (
    <>
      <Poles s={s} />
      <DesertHardware s={s} />
      <Lines s={s} />
      <Prediction s={s} />
      <Avatar />
      <Packets />
    </>
  );
}
