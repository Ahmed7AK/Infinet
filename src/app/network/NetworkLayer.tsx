/**
 * The network layer (plan §7). Invisible in Reality view except what a person could see (AP LEDs are part of
 * the models) and a faint glow at the predicted edge. In Network Vision (N) it lights up:
 *  - ground heatmap at 1 m, drawn as a grid of dots that grow with the signal (Wi-Fi blue, cellular green) over a
 *    faint wash; thin contours at −67 dBm (solid), −75 dBm (dashed), 5G −100 dBm; red hatching where the blocked
 *    copy is the strongest signal. Belief map by default, truth or error with Shift+N (P6).
 *  - cell sector wedges, beacon rings in the colour of Infinet's verdict, backhaul to the Internet, anchor pillar
 *  - Infinet's tunnel as a cyan tube with moving cells; packets along every hop (sealed / plain / lost / late)
 *  - the prediction: amber forecast arrow, edge ring and countdown
 *  - desert: LEO pass track, GEO slot, bent pipe to the gateway and the anchor (distances compressed, labelled)
 * Everything here sits on NET_LAYER so the Vision grade leaves it in full colour.
 */
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { geoLookAngle, LAYOUT, PARAMS, type PolicyView, type SimSnapshot, type Vec2, type ZoneId } from '../../engine/index';
import { leoPassAzEl } from '../../engine/geo';
import { sceneOf, txScene } from '../../engine/world/layout';
import { driver, useUi } from '../driver';
import { tech, THRESH } from '../tokens';
import { useModel } from '../scene/assets';
import { NET_LAYER, visionK } from '../scene/vision';

export type V3 = [number, number, number];
const w3 = (x: number, y: number, h = 0): V3 => [x, h, -y];
const TX = LAYOUT.transmitters;
const hdr = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

// ───────────── geometry of the network (shared with the labels) ─────────────
const SAT_R = { leo: 420, geo: 900 }; // compressed sky distances (m), labelled "not to scale"
export const GEO_LOOK = geoLookAngle(LAYOUT.site.latDeg, LAYOUT.site.lonDeg, PARAMS.geoSatLonDeg.v);
export function terminalPos(): V3 { const p = LAYOUT.props.leoTerminal as number[]; return w3(p[0], p[1], (p[2] ?? 3) + 0.25); }
export function dishPos(): V3 { const p = LAYOUT.props.geoDish as Vec2; return w3(p[0], p[1], 2.1); }
export function skyPos(base: V3, azDeg: number, elDeg: number, r: number): V3 {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  return [base[0] + Math.sin(az) * Math.cos(el) * r, base[1] + Math.sin(el) * r, base[2] - Math.cos(az) * Math.cos(el) * r];
}
const leoPass = (s: SimSnapshot, ph = 0.15 + 0.7 * s.truth.leoBoundaryPhase) => leoPassAzEl(ph, (s.truth.leoSatIndex * 67) % 360, 72);
export function leoSat(s: SimSnapshot): V3 { const { azDeg, elDeg } = leoPass(s); return skyPos(terminalPos(), azDeg, elDeg, SAT_R.leo); }
export function geoSat(): V3 { return skyPos(dishPos(), GEO_LOOK.azDeg, GEO_LOOK.elDeg, SAT_R.geo); }
/** each scene has its own anchor and Internet marker (the venue's come from its file) */
const sceneVisual = (key: 'anchor' | 'internet', zone: ZoneId) => {
  const sc = sceneOf(zone);
  return (LAYOUT.visual[`${key}${sc[0].toUpperCase()}${sc.slice(1)}`] ?? LAYOUT.visual[key]).pos;
};
export const anchorPos = (zone: ZoneId): V3 => { const a = sceneVisual('anchor', zone); return w3(a[0], a[1], 14); };
export const internetPos = (zone: ZoneId): V3 => { const a = sceneVisual('internet', zone); return w3(a[0], a[1], 22); };
const gatewayPos = (): V3 => { const a = LAYOUT.visual.gateway.pos; return w3(a[0], a[1], 6); };

/** is this copy on the air? (the café copy and the desert copy are separate attacks) */
export const copyOn = (s: SimSnapshot, t: (typeof TX)[number]) => (t.rogue ? s.lab.attackerEnabled : t.net === 'site-twin' ? s.truth.siteTwinOn : s.truth.attackerOn);
/** the real network a copy imitates */
export const realNet = (net: string) => (net === 'twin' ? 'cafe-guest' : net === 'site-twin' ? 'site-net' : net);
export const visibleTx = (s: SimSnapshot) => TX.filter((t) => txScene(t) === sceneOf(s.zone)).filter((t) => !t.attacker || copyOn(s, t));

/** where a path's radio hop ends, from the policy's own association */
export function endpoint(path: string, pv?: PolicyView | null): V3 | null {
  const [kind, net] = path.split(':');
  if (kind === 'cell') {
    // the operator's site for this scene (the hall has its own)
    const sc = sceneOf(driver.snap.zone);
    const sites = TX.filter((x) => x.kind === 'cell' && x.net === net && txScene(x) === sc);
    let t = sites[0] ?? TX.find((x) => x.kind === 'cell' && x.net === net);
    // several sites of one operator in a scene (small cells, indoor antennas): the one that serves you where you stand
    if (sites.length > 1) { const best = driver.sim.cellCoverage(driver.snap.player.pos, 'truth').txId; t = sites.find((x) => x.id === best) ?? t; }
    return t ? w3(t.pos[0], t.pos[1], t.pos[2] - (t.pos[2] > 12 ? 1.5 : 0.3)) : null;
  }
  const byBssid = pv?.wifiBssid ? TX.find((x) => x.bssid === pv.wifiBssid && x.net === net) : undefined;
  const t = byBssid ?? TX.find((x) => x.kind === 'wifi' && x.net === net);
  return t ? w3(t.pos[0], t.pos[1], t.pos[2] - 0.05) : null;
}

/** the hops after the radio: backhaul to the Internet and the anchor, or the satellite bent pipe */
export function onward(path: string, s: SimSnapshot): V3[] {
  const desert = s.zone === 'desert';
  const z = s.zone;
  if (path === 'wifi:site-net') {
    if (s.truth.uplink === 'none') return [];
    const sat = s.truth.uplink === 'GEO' ? geoSat() : leoSat(s);
    const term = s.truth.uplink === 'GEO' ? dishPos() : terminalPos();
    return [term, sat, gatewayPos(), anchorPos('desert')];
  }
  if (path === 'wifi:twin' || path === 'wifi:site-twin') return s.truth.attackerMode === 'relay' ? (desert ? [anchorPos(z)] : [internetPos(z), anchorPos(z)]) : [];
  // the venue's APs reach the Internet through the hall's comms room
  const idf = path.startsWith('wifi') && sceneOf(z) === 'hall' ? LAYOUT.visual.idfHall?.pos : undefined;
  return [...(idf ? [w3(idf[0], idf[1], idf[2])] : []), internetPos(z), anchorPos(z)];
}
const phonePos = (s: SimSnapshot): V3 => w3(s.player.pos[0], s.player.pos[1], 1.28);
export const isOnWifi = (pv?: PolicyView) => !!pv && (!!pv.activePath?.startsWith('wifi') || pv.dupPaths.some((p) => p.startsWith('wifi')));

// ───────────── heatmap ─────────────
const HN = 128; // samples (1 m)
const heatVert = /* glsl */`
  varying vec2 vUv; varying vec3 vW;
  void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const heatFrag = /* glsl */`
  uniform sampler2D field; uniform float k; uniform int mode; uniform vec3 cWifi, cCell, cThreat, cLine;
  uniform float tVoice, tData, tCell;
  varying vec2 vUv; varying vec3 vW;
  float contour(float v, float thr, float w) { float d = abs(v - thr) / max(fwidth(v), 1e-4); return 1.0 - smoothstep(w - 0.5, w + 0.5, d); }
  void main() {
    vec4 f = texture2D(field, vUv);
    float wifi = f.r, cell = f.g, err = f.b, twin = f.a;
    vec3 col = vec3(0.0); float a = 0.0;
    if (mode == 2) {
      // < 2 dB is noise: leave it neutral; 2–10 dB ramps to red
      float e = clamp((err - 2.0) / 8.0, 0.0, 1.0);
      col = mix(vec3(0.35, 0.45, 0.6), cThreat, e); a = (wifi > -88.0) ? 0.10 + 0.60 * e : 0.0;
    } else {
      float sw = smoothstep(-88.0, -48.0, wifi);
      float sc = smoothstep(-118.0, -82.0, cell) * (1.0 - smoothstep(-80.0, -70.0, wifi));
      bool isWifi = sw >= sc;
      float s = max(sw, sc);
      vec3 base = isWifi ? cWifi : cCell;
      // a faint wash for continuity …
      col = base * (0.45 + 0.55 * s); a = isWifi ? sw * 0.16 : sc * 0.07;
      // … and a 1 m grid of dots whose size is the signal: read strength at a glance, see the street through it
      vec2 g = fract(vW.xz) - 0.5;
      float fw = fwidth(vW.x) + fwidth(vW.z);
      float r = mix(0.025, 0.115, s);
      float dotA = (1.0 - smoothstep(r - fw * 0.6, r + fw * 0.6, length(g))) * smoothstep(0.03, 0.18, s);
      float near = 1.0 - smoothstep(0.10, 0.45, fw); // far away the dots would shimmer: let the wash carry it
      dotA *= near;
      col = mix(col, base * (0.75 + 0.55 * s), dotA); a = max(a, dotA * (isWifi ? 0.62 : 0.36));
      a = max(a, (1.0 - near) * (isWifi ? sw * 0.30 : sc * 0.12));
    }
    // contours: design thresholds (plan P2)
    float dash = step(0.5, fract((vW.x - vW.z) * 0.35));
    float c1 = contour(wifi, tVoice, 1.0), c2 = contour(wifi, tData, 0.85) * dash, c3 = contour(cell, tCell, 0.9);
    col = mix(col, cLine, max(c1, c2)); a = max(a, max(c1, c2) * 0.95);
    col = mix(col, cCell * 1.6, c3 * (1.0 - max(c1, c2))); a = max(a, c3 * 0.9);
    // the blocked copy: red hatching where it is the loudest signal
    if (twin > 0.5) { float h = step(0.86, fract((vW.x + vW.z) * 0.7)); col = mix(col, cThreat * 1.4, h); a = max(a, h * 0.55); }
    vec2 q = abs(vUv - 0.5); a *= 1.0 - smoothstep(0.40, 0.5, max(q.x, q.y));
    gl_FragColor = vec4(col, a * k);
  }`;

/** separable box blur of channels 0..2 of a half-float RGBA grid, radius r, edges clamped */
function blur(buf: Uint16Array, n: number, r: number) {
  const F = THREE.DataUtils.fromHalfFloat, H = THREE.DataUtils.toHalfFloat;
  const v = new Float32Array(n * n * 3);
  for (let i = 0; i < n * n; i++) for (let c = 0; c < 3; c++) v[3 * i + c] = F(buf[4 * i + c]);
  const tmp = new Float32Array(v.length);
  const pass = (src: Float32Array, dst: Float32Array, dx: number, dy: number) => {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(n - 1, Math.max(0, x + k * dx)), yy = Math.min(n - 1, Math.max(0, y + k * dy));
        s += src[3 * (yy * n + xx) + c];
      }
      dst[3 * (y * n + x) + c] = s / (2 * r + 1);
    }
  };
  pass(v, tmp, 1, 0); pass(tmp, v, 0, 1);
  for (let i = 0; i < n * n; i++) for (let c = 0; c < 3; c++) buf[4 * i + c] = H(v[3 * i + c]);
}

function Heatmap() {
  const view = useUi((s) => s.view);
  const mesh = useRef<THREE.Mesh>(null);
  const st = useMemo(() => {
    const data = new Uint16Array(HN * HN * 4);
    const tex = new THREE.DataTexture(data, HN, HN, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    const mat = new THREE.ShaderMaterial({
      vertexShader: heatVert, fragmentShader: heatFrag, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: {
        field: { value: tex }, k: { value: 0 }, mode: { value: 0 },
        cWifi: { value: hdr(tech.wifi, 1.15) }, cCell: { value: hdr(tech.cell, 1.0) }, cThreat: { value: hdr(tech.threat, 1.2) }, cLine: { value: hdr('#EAF4FF', 1.6) },
        tVoice: { value: THRESH.wifiVoice }, tData: { value: THRESH.wifiData }, tCell: { value: THRESH.cellEdge },
      },
    });
    const geo = new THREE.PlaneGeometry(HN, HN); geo.rotateX(-Math.PI / 2);
    return { data, tex, mat, geo, key: '', job: null as null | { key: string; cx: number; cy: number; row: number; buf: Uint16Array } };
  }, []);
  useFrame(() => {
    const m = mesh.current;
    st.mat.uniforms.k.value = visionK.v;
    st.mat.uniforms.mode.value = view === 'error' ? 2 : 0;
    if (!m) return;
    m.visible = visionK.v > 0.01;
    if (!useUi.getState().vision && visionK.v < 0.01) return;
    const s = driver.snap, sim = driver.sim;
    const cx = Math.round(s.player.pos[0] / 8) * 8, cy = Math.round(s.player.pos[1] / 8) * 8;
    const key = `${cx},${cy},${view},${sim.mapsVersion},${s.truth.attackerOn},${s.truth.siteTwinOn},${s.lab.attackerOffsetDb},${sim.seed},${sim.scenario}`;
    if (key !== st.key && st.job?.key !== key) st.job = { key, cx, cy, row: 0, buf: new Uint16Array(HN * HN * 4) };
    const j = st.job;
    if (!j) return;
    const which = view === 'truth' ? 'truth' : 'belief';
    const twinTv = s.infinet.trust[s.truth.attackerBssid ?? ''];
    const twinBlocked = twinTv?.net === 'twin' && twinTv.tier === 'blocked';
    const H = THREE.DataUtils.toHalfFloat;
    // 32 rows a frame: a full refresh takes 4 frames, no hitch
    for (let n = 0; n < 32 && j.row < HN; n++, j.row++) {
      const r = j.row;
      for (let c = 0; c < HN; c++) {
        // texture row 0 is the plane's south edge (uv.y = 0 → +z after the rotation)
        const x = j.cx - HN / 2 + c + 0.5, y = j.cy - HN / 2 + r + 0.5;
        const wi = sim.wifiCoverage([x, y], which);
        const ce = sim.cellCoverage([x, y], which);
        let err = 0;
        if (view === 'error') err = Math.abs(sim.wifiCoverage([x, y], 'belief').dbm - sim.wifiCoverage([x, y], 'truth').dbm);
        const twin = view === 'truth' && twinBlocked && wi.txId === 'twin' ? 1 : 0;
        const k = 4 * (r * HN + c);
        j.buf[k] = H(Math.max(-140, wi.dbm)); j.buf[k + 1] = H(Math.max(-160, ce.dbm)); j.buf[k + 2] = H(err); j.buf[k + 3] = H(twin);
      }
    }
    if (j.row >= HN) {
      // 7 × 7 box blur on the dBm channels: contours read as lines, not speckle from shadow fading
      blur(j.buf, HN, 3);
      st.data.set(j.buf);
      st.tex.needsUpdate = true;
      const y = s.zone === 'desert' ? 0.22 : 0.14;
      m.position.set(j.cx, y, -j.cy);
      st.key = j.key;
      st.job = null;
    }
  });
  return <mesh ref={mesh} geometry={st.geo} material={st.mat} renderOrder={5} frustumCulled={false} />;
}

// ───────────── cell sectors ─────────────
function sectorGeo(len: number, widthDeg: number, tiltDeg: number) {
  const g = new THREE.BufferGeometry();
  const n = 20, pos: number[] = [], alpha: number[] = [], idx: number[] = [];
  const half = (widthDeg * Math.PI) / 360, tilt = (tiltDeg * Math.PI) / 180;
  pos.push(0, 0, 0); alpha.push(0.0);
  for (let i = 0; i <= n; i++) {
    const a = -half + (2 * half * i) / n;
    // forward is −z (north) before the sector's rotation; down by the tilt
    pos.push(Math.sin(a) * len * Math.cos(tilt), -Math.sin(tilt) * len, -Math.cos(a) * len * Math.cos(tilt)); alpha.push(1);
  }
  for (let i = 1; i <= n; i++) idx.push(0, i, i + 1);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('fade', new THREE.Float32BufferAttribute(alpha, 1));
  g.setIndex(idx);
  return g;
}
const fadeMat = (color: THREE.Color) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  uniforms: { c: { value: color }, k: { value: 0 } },
  vertexShader: 'attribute float fade; varying float f; void main(){ f = fade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: 'uniform vec3 c; uniform float k; varying float f; void main(){ float a = smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.55, 1.0, f)); gl_FragColor = vec4(c * a * 0.22 * k, 1.0); }',
});
function Sectors({ s }: { s: SimSnapshot }) {
  const mat = useMemo(() => fadeMat(hdr(tech.cell, 1.4)), []);
  // a macro's sectors reach 320 m; a small cell on a lamp post is drawn to 90 m
  const geo = useMemo(() => ({ macro: sectorGeo(320, 65, 4), small: sectorGeo(90, 65, 6) }), []);
  useFrame(() => { mat.uniforms.k.value = visionK.v; });
  return (
    <>
      {visibleTx(s).filter((t) => t.kind === 'cell').flatMap((t) => (t.sectors ?? []).map((sc, i) => (
        <mesh key={`${t.id}-${i}`} geometry={t.model === 'UMi' ? geo.small : geo.macro} material={mat} position={w3(t.pos[0], t.pos[1], t.pos[2] - (t.model === 'UMi' ? 0.3 : 1.2))} rotation-y={(-sc.azDeg * Math.PI) / 180} frustumCulled={false} />
      )))}
    </>
  );
}

// ───────────── beacon rings (each AP announcing itself; slowed to be visible) ─────────────
const ringGeo = (() => { const g = new THREE.RingGeometry(0.94, 1, 64); g.rotateX(-Math.PI / 2); return g; })();
function Beacons({ s }: { s: SimSnapshot }) {
  const aps = visibleTx(s).filter((t) => t.kind === 'wifi');
  const refs = useRef<Array<THREE.Mesh | null>>([]);
  const mats = useMemo(() => aps.map((t) => new THREE.MeshBasicMaterial({ color: hdr(tech.wifi, 1.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0, userData: { ph: (t.pos[0] * 0.37 + t.pos[1] * 0.11) % 1 } })), [aps.map((t) => t.id).join()]);
  useFrame(() => {
    const t = driver.snap.t;
    refs.current.forEach((m, i) => {
      if (!m || !mats[i]) return;
      const u = (t / 1.6 + mats[i].userData.ph) % 1;
      m.scale.setScalar(0.3 + u * 14);
      // the ring is the colour of Infinet's verdict on this AP (its own memory, P5): blocked rings read red at once
      const tx = aps[i];
      const snap = driver.snap;
      const bssid = tx.id === 'twin' ? snap.truth.attackerBssid : tx.bssid;
      const tv = bssid ? snap.infinet.trust[bssid] : undefined;
      const tier = tv && (!tx.attacker || tv.net === tx.net) ? tv.tier : undefined;
      const hex = tier === 'trusted' ? tech.ok : tier === 'tunnel' ? tech.tunnel : tier === 'blocked' ? tech.threat : tier === 'checking' ? tech.check : tier === 'unreachable' ? '#8A93A6' : tech.wifi;
      if (mats[i].userData.hex !== hex) { mats[i].color.copy(hdr(hex, 1.8)); mats[i].userData.hex = hex; }
      mats[i].opacity = (1 - u) * (tier === 'blocked' ? 0.8 : 0.5) * visionK.v;
    });
  });
  return (
    <>
      {aps.map((t, i) => <mesh key={t.id} ref={(m) => { refs.current[i] = m; }} geometry={ringGeo} material={mats[i]} position={w3(t.pos[0], t.pos[1], t.pos[2] - 0.1)} />)}
    </>
  );
}

// ───────────── backhaul, Internet, anchor ─────────────
function Backbone({ s }: { s: SimSnapshot }) {
  const desert = s.zone === 'desert';
  const an = anchorPos(s.zone);
  const lines: Array<{ k: string; pts: V3[]; c: THREE.Color; w: number; dashed?: boolean }> = [];
  if (!desert) {
    const inet = internetPos(s.zone);
    // the hall: each AP's cable rises to the tray under the roof, runs to the back wall and down to the comms room
    const idf = sceneOf(s.zone) === 'hall' ? LAYOUT.visual.idfHall?.pos : undefined;
    if (idf) {
      const room = w3(idf[0], idf[1], idf[2]), tray = 12.4;
      for (const t of visibleTx(s)) {
        if (t.attacker || t.kind !== 'wifi') continue;
        const top = w3(t.pos[0], t.pos[1], t.pos[2]);
        lines.push({ k: `bh-${t.id}`, pts: [top, [top[0], tray, top[2]], [top[0], tray, room[2]], [room[0], tray, room[2]], room], c: hdr(tech.wired, 0.8), w: 1 });
      }
      lines.push({ k: 'idf-inet', pts: [room, inet], c: hdr(tech.wired, 1.1), w: 1.6 });
    }
    for (const t of visibleTx(s)) {
      if (t.attacker || (idf && t.kind === 'wifi')) continue;
      const top: V3 = t.kind === 'cell' ? w3(t.pos[0], t.pos[1], 2) : w3(t.pos[0], t.pos[1], t.pos[2]);
      // APs drop down the wall to the floor duct; towers run fibre from the base
      const foot: V3 = [top[0], 0.2, top[2]];
      lines.push({ k: `bh-${t.id}`, pts: t.kind === 'cell' ? [top, inet] : [top, foot, inet], c: hdr(tech.wired, 0.9), w: 1.2 });
    }
    lines.push({ k: 'inet-anchor', pts: [inet, an], c: hdr(tech.wired, 1.2), w: 2 });
  } else {
    const gw = gatewayPos();
    lines.push({ k: 'gw-anchor', pts: [gw, an], c: hdr(tech.wired, 1.2), w: 2 });
  }
  return (
    <>
      {lines.map((l) => <Line key={l.k} points={l.pts} color={l.c} lineWidth={l.w} transparent opacity={0.8} dashed={l.dashed} />)}
      {!desert && <mesh position={internetPos(s.zone)}><icosahedronGeometry args={[2.2, 1]} /><meshBasicMaterial color={hdr(tech.wired, 1.6)} wireframe /></mesh>}
      <AnchorPillar at={an} />
    </>
  );
}
function AnchorPillar({ at }: { at: V3 }) {
  const mat = useMemo(() => fadeMat(hdr(tech.tunnel, 3)), []);
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(1.6, 1.6, 120, 24, 1, true);
    const f = new Float32Array(g.attributes.position.count);
    for (let i = 0; i < f.length; i++) f[i] = 0.5 - g.attributes.position.getY(i) / 240; // bright at the base
    g.setAttribute('fade', new THREE.BufferAttribute(f, 1));
    return g;
  }, []);
  useFrame(() => { mat.uniforms.k.value = 0.6 + 3 * visionK.v; });
  return (
    <group position={[at[0], 0, at[2]]}>
      <mesh geometry={geo} material={mat} position-y={60} />
      <mesh position-y={at[1]}><octahedronGeometry args={[3, 0]} /><meshBasicMaterial color={hdr(tech.tunnel, 2.2)} /></mesh>
    </group>
  );
}

// ───────────── the tunnel ─────────────
const tubeVert = /* glsl */`varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }`;
const tubeFrag = /* glsl */`uniform vec3 c; uniform float t, L, k, dashed; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  float hex(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.732))), p.x); }
  void main(){
    vec2 p = vec2(vUv.x * L / 0.55 - t * 2.4, vUv.y * 7.0);
    vec2 r = vec2(1.0, 1.732); vec2 h = r * 0.5;
    vec2 a = mod(p, r) - h, b = mod(p - h, r) - h; vec2 g = dot(a,a) < dot(b,b) ? a : b;
    float edge = smoothstep(0.40, 0.48, hex(g));
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
    float gap = dashed > 0.5 ? step(0.45, fract(vUv.x * L / 1.6 - t * 1.2)) : 1.0;
    float alpha = (0.10 + 0.55 * edge + 0.45 * fres) * gap * k;
    gl_FragColor = vec4(c * (0.6 + 1.2 * edge), alpha);
  }`;
function Tunnel({ chain, dashed, color }: { chain: V3[]; dashed: boolean; color: string }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: tubeVert, fragmentShader: tubeFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { c: { value: hdr(color, 1.6) }, t: { value: 0 }, L: { value: 1 }, k: { value: 0 }, dashed: { value: 0 } },
  }), [color]);
  const mesh = useRef<THREE.Mesh>(null);
  const last = useRef('');
  useFrame(() => {
    const m = mesh.current;
    if (!m || chain.length < 2) return;
    mat.uniforms.t.value = driver.snap.t;
    mat.uniforms.k.value = visionK.v;
    mat.uniforms.dashed.value = dashed ? 1 : 0;
    const live = [phonePos(driver.snap), ...chain.slice(1)];
    const key = live.map((p) => p.map((v) => v.toFixed(1)).join()).join('|');
    if (key === last.current) return;
    last.current = key;
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i < live.length - 1; i++) path.add(new THREE.LineCurve3(new THREE.Vector3(...live[i]), new THREE.Vector3(...live[i + 1])));
    const L = path.getLength();
    m.geometry.dispose();
    m.geometry = new THREE.TubeGeometry(path, Math.min(600, Math.max(24, Math.round(L / 1.5))), 0.16, 10, false);
    mat.uniforms.L.value = L;
  });
  return <mesh ref={mesh} material={mat} frustumCulled={false} renderOrder={6} />;
}

function Paths({ s }: { s: SimSnapshot }) {
  const inf = s.policies.infinet;
  const base = s.policies[s.lab.baseline];
  const me = phonePos(s);
  const out: React.ReactNode[] = [];
  if (inf && inf.callState !== 'dropped') {
    const paths = inf.dupPaths.length ? inf.dupPaths : inf.activePath ? [inf.activePath] : [];
    const handing = inf.callState === 'handover' && !inf.dupPaths.length;
    for (const p of paths) {
      const e = endpoint(p, p.startsWith('wifi') ? inf : undefined);
      if (!e) continue;
      const chain = [me, e, ...onward(p, s)];
      if (inf.tunnel) out.push(<Tunnel key={`tun-${p}`} chain={chain} dashed={handing} color={tech.tunnel} />);
      else out.push(<Line key={`inf-${p}`} points={chain} color={hdr(tech.tunnel, 1.5)} lineWidth={3} transparent opacity={visionK.v} />);
    }
    const cand = s.infinet.candidate;
    if (cand && s.infinet.candidateState === 'checking' && !paths.includes(cand)) {
      const e = endpoint(cand);
      if (e) out.push(<Line key="cand" points={[me, e]} color={hdr(tech.check, 1.6)} lineWidth={2} dashed dashSize={0.5} gapSize={0.4} transparent opacity={visionK.v} />);
    }
  }
  // the comparison phone: plain traffic, red when it went to the copy
  if (base && base.activePath && base.callState !== 'dropped') {
    const e = endpoint(base.activePath, base);
    const onCopy = base.activePath === 'wifi:twin';
    const low: V3 = [me[0], me[1] - 0.25, me[2]];
    if (e) out.push(<Line key="base" points={[low, e, ...onward(base.activePath, s)]} color={onCopy ? hdr(tech.threat, 1.8) : hdr(tech.wired, 1.0)} lineWidth={onCopy ? 2.5 : 1.5} transparent opacity={0.85 * visionK.v} />);
  }
  return <>{out}</>;
}

// ───────────── packets (time-stretched ×4, labelled in Sim notes) ─────────────
const PK_MAX = 220;
function Packets() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.SphereGeometry(0.11, 10, 8), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true }), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), c: new THREE.Color(), zero: new THREE.Matrix4().makeScale(0, 0, 0), v: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3() }), []);
  const cols = useMemo(() => ({ sealed: hdr(tech.tunnel, 3), plain: hdr(tech.wired, 2.2), lost: hdr(tech.threat, 3.5), late: hdr(tech.check, 3), copy: hdr(tech.threat, 2.6) }), []);
  useFrame(() => {
    const im = mesh.current;
    if (!im) return;
    mat.opacity = visionK.v;
    im.visible = visionK.v > 0.01;
    if (!im.visible) return;
    const s = driver.snap;
    const me = phonePos(s);
    const chains = new Map<string, { pts: V3[]; cum: number[] }>();
    const chainFor = (policy: string, path: string) => {
      const k = `${policy}|${path}`;
      let c = chains.get(k);
      if (c) return c;
      const pv = s.policies[policy];
      const e = endpoint(path, path.startsWith('wifi') ? pv : undefined);
      if (!e) return null;
      const pts: V3[] = [policy === 'infinet' ? me : [me[0], me[1] - 0.25, me[2]], e, ...onward(path, s)];
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
      c = { pts, cum };
      chains.set(k, c);
      return c;
    };
    let i = 0;
    for (const p of s.packets) {
      if (i >= PK_MAX) break;
      if (p.policy !== 'infinet' && p.policy !== s.lab.baseline) continue;
      const D = Math.min(3, Math.max(0.5, (p.t1 - p.t0) * 4));
      const f = (s.t - p.t0) / D;
      if (f < 0 || f > 1) continue;
      const ch = chainFor(p.policy, p.path);
      if (!ch) continue;
      const total = ch.cum[ch.cum.length - 1];
      // the radio hop is short but where the action is: give it the first 45 % of the trip
      const radio = ch.cum[1];
      let d: number;
      if (p.lost) d = Math.min(radio, (f / 0.6) * radio);
      else d = f < 0.45 ? (f / 0.45) * radio : radio + ((f - 0.45) / 0.55) * (total - radio);
      let seg = 1;
      while (seg < ch.cum.length - 1 && ch.cum[seg] < d) seg++;
      const u = (d - ch.cum[seg - 1]) / Math.max(1e-6, ch.cum[seg] - ch.cum[seg - 1]);
      tmp.a.set(...ch.pts[seg - 1]); tmp.b.set(...ch.pts[seg]);
      tmp.v.copy(tmp.a).lerp(tmp.b, Math.min(1, u));
      const far = tmp.v.distanceTo(tmp.a.set(...me));
      const sc = (p.lost && f > 0.6 ? 2.4 * (1 - f) / 0.4 : 1) * (1 + far / 60);
      tmp.m.makeScale(sc, sc, sc).setPosition(tmp.v);
      const onCopy = p.path === 'wifi:twin';
      im.setColorAt(i, p.lost ? cols.lost : p.late ? cols.late : onCopy ? cols.copy : p.sealed ? cols.sealed : cols.plain);
      im.setMatrixAt(i++, tmp.m);
    }
    for (; i < PK_MAX; i++) im.setMatrixAt(i, tmp.zero);
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geo, mat, PK_MAX]} frustumCulled={false} renderOrder={7} />;
}

// ───────────── prediction (Feature 1) ─────────────
const edgeRing = (() => { const g = new THREE.RingGeometry(0.7, 0.95, 48); g.rotateX(-Math.PI / 2); return g; })();
function Prediction({ s }: { s: SimSnapshot }) {
  const inf = s.infinet;
  const onWifi = isOnWifi(s.policies.infinet);
  const show = onWifi && inf.ttlS !== undefined && inf.ttlS < 10 && !!inf.edgePoint;
  const ring = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: hdr(tech.check, 2.4), transparent: true, depthWrite: false, side: THREE.DoubleSide }), []);
  useFrame(() => {
    // Reality view keeps a faint glow; Vision shows it fully
    mat.opacity = 0.25 + 0.75 * visionK.v;
    if (ring.current) ring.current.scale.setScalar(1 + 0.12 * Math.sin(driver.snap.t * 5));
  });
  if (!onWifi) return null;
  const y = s.zone === 'desert' ? 0.25 : 0.16;
  const pts = inf.forecast.map((p) => w3(p[0], p[1], y));
  return (
    <>
      {pts.length > 1 && <Line points={pts} color={hdr(tech.check, 2)} lineWidth={3} dashed dashSize={0.5} gapSize={0.35} transparent opacity={0.15 + 0.85 * visionK.v} />}
      {show && <mesh ref={ring} geometry={edgeRing} material={mat} position={w3(inf.edgePoint![0], inf.edgePoint![1], y + 0.01)} />}
    </>
  );
}

// ───────────── desert sky ─────────────
function Satellites({ s }: { s: SimSnapshot }) {
  const leo = useModel('sat_leo', { shadows: false });
  const geo = useModel('sat_geo', { shadows: false });
  const gw = useModel('gateway_cluster');
  const leoRef = useRef<THREE.Group>(null);
  const track = useMemo(() => {
    const pts: V3[] = [];
    for (let i = 0; i <= 40; i++) { const { azDeg, elDeg } = leoPass(s, 0.15 + (0.7 * i) / 40); pts.push(skyPos(terminalPos(), azDeg, elDeg, SAT_R.leo)); }
    return pts;
  }, [s.truth.leoSatIndex]);  
  useFrame(() => {
    const p = leoSat(driver.snap);
    leoRef.current?.position.set(...p);
    leoRef.current?.lookAt(...terminalPos());
  });
  const leoUp = s.truth.uplink === 'LEO', geoUp = s.truth.uplink === 'GEO';
  const term = terminalPos(), dish = dishPos(), gp = gatewayPos();
  const beam = (a: V3, b: V3, on: boolean, k: string) => <Line key={k} points={[a, b]} color={on ? hdr(tech.sat, 2.2) : hdr(tech.sat, 0.5)} lineWidth={on ? 2.5 : 1} dashed={!on} dashSize={6} gapSize={6} transparent opacity={visionK.v} />;
  return (
    <>
      <group ref={leoRef} scale={14}><primitive object={leo} /></group>
      <group position={geoSat()} scale={30}><primitive object={geo} /></group>
      <group position={[gp[0], 0, gp[2]]}><primitive object={gw} /></group>
      <Line points={track} color={hdr(tech.sat, 1.2)} lineWidth={1.2} dashed dashSize={10} gapSize={8} transparent opacity={0.7 * visionK.v} />
      {beam(term, leoSat(s), leoUp && !s.truth.leoOutage, 'leo-up')}
      {beam(leoSat(s), gp, leoUp && !s.truth.leoOutage, 'leo-down')}
      {beam(dish, geoSat(), geoUp, 'geo-up')}
      {beam(geoSat(), gp, geoUp, 'geo-down')}
    </>
  );
}

// ───────────── root ─────────────
export function NetworkLayer() {
  const s = useUi((st) => st.snap);
  const root = useRef<THREE.Group>(null);
  const vision = useUi((st) => st.vision);
  useFrame(() => {
    const g = root.current;
    if (!g) return;
    g.traverse((o) => { o.layers.set(NET_LAYER); });
  });
  if (!s) return null;
  const desert = s.zone === 'desert';
  return (
    <group ref={root}>
      <Prediction s={s} />
      {(vision || visionK.v > 0.01) && (
        <>
          <Heatmap />
          <Sectors s={s} />
          <Beacons s={s} />
          <Backbone s={s} />
          <Paths s={s} />
          {desert && <Satellites s={s} />}
        </>
      )}
      <Packets />
    </group>
  );
}
