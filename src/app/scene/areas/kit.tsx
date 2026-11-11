/**
 * Shared pieces for the four places added on 11 Nov (park, Downtown, metro station, old souk). Everything is built
 * in code from the same local geometry the radio model uses (src/engine/world/areas.ts) plus the props already in
 * public/models: no new downloads. Surfaces that have no Poly Haven set (grass, water, curtain wall, arched façades)
 * are drawn once on a canvas at start-up, generic patterns only: no words, logos or anyone's building.
 *
 * Coordinates here are the area's own frame (x east, y north, metres); `<Area>` moves the group to the area's
 * origin in the world, so vertices stay small numbers and keep their precision 20–30 km from the city.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type JSX, type ReactNode } from 'react';
import * as THREE from 'three';
import { AREA_ORIGIN, type AreaId, type Vec2 } from '../../../engine/index';
import { boxGeo, floorGeo, MAT, useModel, type ModelName } from '../assets';
import { camOccluders } from '../vision';

export const faceCompass = (deg: number) => ((180 - deg) * Math.PI) / 180;
/** local (x east, y north, h up) → three.js */
export const L3 = (x: number, y: number, h = 0): [number, number, number] => [x, h, -y];

export function Area({ id, children }: { id: AreaId; children: ReactNode }) {
  const [ox, oy] = AREA_ORIGIN[id];
  return <group position={[ox, 0, -oy]}>{children}</group>;
}

/** a GLB prop at a local position; `face` is the compass heading its front turns to */
export function P({ id, name, at, h = 0.02, face, rotY = 0, scale = 1, tint, part, occluder }: {
  id: AreaId; name: ModelName; at: Vec2; h?: number; face?: number; rotY?: number; scale?: number; tint?: Record<string, string>; part?: string;
  /** hide while the camera is inside it (palm crowns, lamp posts) */
  occluder?: { y: number; r: number; h?: number };
}) {
  const obj = useModel(name, { tint, part });
  useEffect(() => {
    if (!occluder) return;
    const [ox, oy] = AREA_ORIGIN[id];
    const e = { obj, x: ox + at[0], y: h + occluder.y * scale, z: -(oy + at[1]), r: occluder.r * scale, h: occluder.h === undefined ? undefined : occluder.h * scale };
    camOccluders.add(e);
    return () => { camOccluders.delete(e); };
  }, [obj, id, at[0], at[1], h, scale]);
  return <primitive object={obj} position={[at[0], h, -at[1]]} rotation-y={face === undefined ? rotY : faceCompass(face)} scale={scale} />;
}

export const Palm = ({ id, at, i = 0, s = 1 }: { id: AreaId; at: Vec2; i?: number; s?: number }) => (
  <P id={id} name="palm" at={at} rotY={i * 1.3} scale={s * (0.9 + ((i * 37) % 10) / 40)} occluder={{ y: 7.5, r: 5.5 }} />
);
export const Lamp = ({ id, at, face = 0 }: { id: AreaId; at: Vec2; face?: number }) => (
  <P id={id} name="street_lamp" at={at} face={face} occluder={{ y: 0, r: 1.4, h: 9 }} />
);

// ───────────── deterministic scatter ─────────────
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// ───────────── canvas textures (metre UVs: `tileM` is the real size of one tile) ─────────────
const texCache = new Map<string, THREE.CanvasTexture>();
function canvasTex(key: string, w: number, h: number, tileM: [number, number], draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.repeat.set(1 / tileM[0], 1 / tileM[1]);
  texCache.set(key, t);
  return t;
}

const matCache = new Map<string, THREE.Material>();
function once<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) { m = make(); matCache.set(key, m); }
  return m;
}

/** mown lawn: thousands of short strokes in a few greens over a mottled base (6 m tile) */
function grassTex() {
  return canvasTex('grass', 1024, 1024, [6, 6], (g, w, h) => {
    g.fillStyle = '#5c8436'; g.fillRect(0, 0, w, h);
    const r = rng(11);
    for (let i = 0; i < 260; i++) {
      const x = r() * w, y = r() * h, s = 40 + r() * 120;
      const gr = g.createRadialGradient(x, y, 0, x, y, s);
      const c = r() < 0.5 ? '112,150,60' : '70,112,44';
      gr.addColorStop(0, `rgba(${c},0.22)`); gr.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = gr;
      for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) g.fillRect(x - s + dx, y - s + dy, 2 * s, 2 * s);
    }
    const tones = ['#4a7a2c', '#6c9a3e', '#7aa648', '#527f31', '#8bb155', '#3f6d27'];
    g.lineWidth = 1.3;
    for (let i = 0; i < 52000; i++) {
      const x = r() * w, y = r() * h, a = -Math.PI / 2 + (r() - 0.5) * 1.2, l = 3 + r() * 6;
      g.strokeStyle = tones[Math.floor(r() * tones.length)];
      g.globalAlpha = 0.5 + r() * 0.4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    g.globalAlpha = 1;
  });
}
/** small ripples as a normal map (tileable sum of sines) */
function rippleTex() {
  return canvasTex('ripple', 256, 256, [9, 9], (g, w, h) => {
    const img = g.createImageData(w, h);
    const k = (2 * Math.PI) / w;
    const waves = [[3, 1, 0.9], [-2, 4, 0.7], [5, -3, 0.5], [1, 7, 0.4], [-6, 2, 0.35], [8, 5, 0.25], [-4, -9, 0.2]];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let dx = 0, dy = 0;
      for (const [a, b, amp] of waves) { const c = Math.cos(k * (a * x + b * y)) * amp; dx += c * a; dy += c * b; }
      const n = new THREE.Vector3(-dx * 0.09, -dy * 0.09, 1).normalize();
      const i = 4 * (y * w + x);
      img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, false);
}
/** a glass curtain wall: 1.5 m panes on 4 m floors, a spandrel band at each slab, panes a little different from each other */
function curtainTex(key: string, base: [number, number, number], fins = false) {
  return canvasTex(`curtain:${key}`, 256, 512, [12, 32], (g, w, h) => {
    const r = rng(key.length * 97 + base[0]);
    const cols = 8, rows = 8, pw = w / cols, ph = h / rows;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const d = (r() - 0.5) * 26;
      g.fillStyle = `rgb(${base[0] + d},${base[1] + d},${base[2] + d * 1.1})`;
      g.fillRect(i * pw, j * ph, pw, ph);
    }
    for (let j = 0; j < rows; j++) {
      g.fillStyle = 'rgba(20,28,36,0.55)'; g.fillRect(0, j * ph, w, ph * 0.2);
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, j * ph + ph * 0.2, w, 1.5);
    }
    g.fillStyle = fins ? 'rgba(235,240,245,0.75)' : 'rgba(18,24,30,0.6)';
    for (let i = 0; i < cols; i++) g.fillRect(i * pw - (fins ? 2 : 1), 0, fins ? 4 : 2, h);
  });
}
/** a plastered façade with rows of arched windows behind timber screens (8 m × 7 m tile: two storeys) */
function archedTex(key: string, wall: string) {
  return canvasTex(`arched:${key}`, 512, 448, [8, 7], (g, w, h) => {
    g.fillStyle = wall; g.fillRect(0, 0, w, h);
    const r = rng(key.length * 31 + 5);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '90,70,40'},${0.03 + r() * 0.04})`; g.fillRect(r() * w, r() * h, 2 + r() * 26, 1 + r() * 5); }
    const storey = h / 2;
    for (let s = 0; s < 2; s++) for (let i = 0; i < 2; i++) {
      const cx = (i + 0.5) * (w / 2), top = s * storey + storey * 0.2, ww = w * 0.2, hh = storey * 0.56;
      g.fillStyle = 'rgba(70,52,34,0.35)'; g.fillRect(cx - ww / 2 - 5, top + ww / 2 - 5, ww + 10, hh - ww / 2 + 12);
      g.beginPath(); g.arc(cx, top + ww / 2, ww / 2 + 5, Math.PI, 0); g.fill();
      g.fillStyle = '#2c333a';
      g.beginPath(); g.moveTo(cx - ww / 2, top + hh); g.lineTo(cx - ww / 2, top + ww / 2); g.arc(cx, top + ww / 2, ww / 2, Math.PI, 0); g.lineTo(cx + ww / 2, top + hh); g.closePath(); g.fill();
      // the timber screen over the lower half
      g.strokeStyle = '#6b4a2c'; g.lineWidth = 2;
      for (let k = 0; k <= 6; k++) { const x = cx - ww / 2 + (k * ww) / 6; g.beginPath(); g.moveTo(x, top + hh * 0.5); g.lineTo(x, top + hh); g.stroke(); }
      for (let k = 0; k <= 4; k++) { const y = top + hh * 0.5 + (k * hh * 0.5) / 4; g.beginPath(); g.moveTo(cx - ww / 2, y); g.lineTo(cx + ww / 2, y); g.stroke(); }
      g.fillStyle = 'rgba(60,44,28,0.5)'; g.fillRect(cx - ww / 2 - 8, top + hh, ww + 16, 6);
    }
    g.fillStyle = 'rgba(80,60,36,0.28)'; g.fillRect(0, storey - 5, w, 5); g.fillRect(0, h - 5, w, 5);
  });
}
/** plain office or flat façade for the blocks round an area: punched windows on 3.4 m floors (6 m × 6.8 m tile) */
function punchedTex(key: string, wall: string) {
  return canvasTex(`punched:${key}`, 384, 432, [6, 6.8], (g, w, h) => {
    g.fillStyle = wall; g.fillRect(0, 0, w, h);
    const r = rng(key.length * 53 + 3);
    for (let s = 0; s < 2; s++) for (let i = 0; i < 2; i++) {
      const x = (i + 0.5) * (w / 2) - w * 0.14, y = s * (h / 2) + h * 0.11;
      g.fillStyle = r() < 0.25 ? '#c8c2ae' : `rgb(${52 + r() * 30},${70 + r() * 30},${84 + r() * 30})`;
      g.fillRect(x, y, w * 0.28, h * 0.27);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y, w * 0.28, 4);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x - 3, y + h * 0.27, w * 0.28 + 6, 4);
    }
  });
}

export const AMAT = {
  grass: () => once('grass', () => new THREE.MeshStandardMaterial({ map: grassTex(), roughness: 1, color: '#e9efe2' })),
  /** still or gently moving water: sky reflection from the environment, ripples from a scrolling normal map */
  water: (color = '#1f5a63', opacity = 1) => once(`water:${color}:${opacity}`, () => {
    const n = rippleTex();
    const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.06, metalness: 0.2, envMapIntensity: 1.5, normalMap: n, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    m.normalScale.setScalar(0.35);
    return m;
  }),
  curtain: (key: string, base: [number, number, number], fins = false) => once(`curtain:${key}`, () => new THREE.MeshPhysicalMaterial({
    map: curtainTex(key, base, fins), roughness: fins ? 0.26 : 0.14, metalness: 0.82, envMapIntensity: 1.25, clearcoat: 0.4, clearcoatRoughness: 0.1,
  })),
  arched: (key: string, wall: string) => once(`arched:${key}`, () => new THREE.MeshStandardMaterial({ map: archedTex(key, wall), roughness: 0.92 })),
  punched: (key: string, wall: string) => once(`punched:${key}`, () => new THREE.MeshStandardMaterial({ map: punchedTex(key, wall), roughness: 0.9 })),
  flat: (color: string, rough = 0.85, metal = 0) => once(`flat:${color}:${rough}:${metal}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })),
  cloth: (color: string) => once(`cloth:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide })),
  glow: (color: string, k = 1.2) => once(`glow:${color}:${k}`, () => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: color, emissiveIntensity: k, roughness: 0.5 })),
  glass: () => once('glass', () => MAT.glassClear()),
  frame: () => once('frame', () => MAT.frame()),
  steel: () => once('steel', () => new THREE.MeshStandardMaterial({ color: '#c9ced3', roughness: 0.32, metalness: 0.9 })),
  timber: () => once('timber', () => new THREE.MeshStandardMaterial({ color: '#6b4a2e', roughness: 0.8 })),
  paving: (tint = '#e3d9c8') => once(`paving:${tint}`, () => { const m = MAT.paving(); m.color.set(tint); return m; }),
  plaster: (tint: string) => once(`plaster:${tint}`, () => MAT.paint(tint)),
  stone: (tint: string) => once(`stone:${tint}`, () => MAT.concrete(tint)),
  asphalt: () => once('asphalt', () => MAT.asphalt()),
  sand: () => once('sand', () => MAT.sand()),
  terrazzo: () => once('terrazzo', () => MAT.terrazzo()),
  wood: () => once('wood', () => MAT.wood()),
};

/** scrolls every water surface's ripples (one shared normal map) */
export function WaterDrift() {
  useFrame((_, dt) => {
    const t = texCache.get('ripple');
    if (t) { t.offset.x += Math.min(dt, 0.1) * 0.012; t.offset.y += Math.min(dt, 0.1) * 0.007; }
  });
  return null;
}

// ───────────── geometry ─────────────
export { boxGeo, floorGeo };
export const ellipsePoly = (cx: number, cy: number, rx: number, ry: number, n = 48): Array<[number, number]> =>
  Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * 2 * Math.PI) * rx, cy + Math.sin((i / n) * 2 * Math.PI) * ry] as [number, number]);

/** a flat ring between two outlines (same vertex count), with metre UVs: kerbs, a running track, a pond's rim */
export function bandGeo(inner: Array<[number, number]>, outer: Array<[number, number]>, y = 0): THREE.BufferGeometry {
  const n = inner.length, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i < n; i++) {
    pos.push(inner[i][0], y, -inner[i][1], outer[i][0], y, -outer[i][1]);
    uv.push(inner[i][0], inner[i][1], outer[i][0], outer[i][1]);
    const a = 2 * i, b = 2 * ((i + 1) % n);
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** a strip of ground `w` wide along a polyline */
export function ribbonGeo(pts: Vec2[], w: number, y = 0): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    const p = pts[i];
    pos.push(p[0] + (nx * w) / 2, y, -(p[1] + (ny * w) / 2), p[0] - (nx * w) / 2, y, -(p[1] - (ny * w) / 2));
    uv.push(p[0] + (nx * w) / 2, p[1] + (ny * w) / 2, p[0] - (nx * w) / 2, p[1] - (ny * w) / 2);
    if (i < pts.length - 1) { const k = 2 * i; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** a smooth curve through waypoints, sampled every `step` metres or so */
export function smooth(pts: Vec2[], step = 2): Vec2[] {
  const c = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, 0, y)), false, 'centripetal');
  const n = Math.max(2, Math.round(c.getLength() / step));
  return c.getSpacedPoints(n).map((v) => [v.x, v.z] as Vec2);
}

/** a box set down on the ground: centre (x, y), size (sx east, sy north, h up), from height z0 */
export function Box({ at, size, z0 = 0, rot = 0, mat, shadow = true }: { at: Vec2; size: [number, number, number]; z0?: number; rot?: number; mat: THREE.Material; shadow?: boolean }) {
  const g = useMemo(() => boxGeo(size[0], size[2], size[1]), [size[0], size[1], size[2]]);
  return <mesh position={[at[0], z0 + size[2] / 2, -at[1]]} rotation-y={rot} geometry={g} material={mat} castShadow={shadow} receiveShadow />;
}
export function Cyl({ at, r, h, z0 = 0, r2, mat, seg = 20, shadow = true }: { at: Vec2; r: number; h: number; z0?: number; r2?: number; mat: THREE.Material; seg?: number; shadow?: boolean }) {
  return (
    <mesh position={[at[0], z0 + h / 2, -at[1]]} material={mat} castShadow={shadow} receiveShadow>
      <cylinderGeometry args={[r2 ?? r, r, h, seg]} />
    </mesh>
  );
}
/** a flat polygon of ground */
export function Ground({ poly, y = 0, mat }: { poly: Array<[number, number]>; y?: number; mat: THREE.Material }) {
  const g = useMemo(() => floorGeo(poly, y), [poly, y]);
  return <mesh geometry={g} material={mat} receiveShadow />;
}
export const rectPoly = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** posts and a top rail along a polyline, with glass or mesh between (a lake railing, a park fence) */
export function Railing({ pts, h = 1.1, every = 2, fill = 'glass', closed = false }: { pts: Vec2[]; h?: number; every?: number; fill?: 'glass' | 'bars' | 'none'; closed?: boolean }) {
  const els = useMemo(() => {
    const out: JSX.Element[] = [];
    const post = AMAT.frame();
    const posts: THREE.Matrix4[] = [];
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.01) continue;
      const rot = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const mid: [number, number, number] = [(a[0] + b[0]) / 2, 0, -(a[1] + b[1]) / 2];
      out.push(<mesh key={`r${i}`} position={[mid[0], h, mid[2]]} rotation-y={rot} geometry={boxGeo(L, 0.05, 0.07)} material={post} castShadow />);
      if (fill === 'glass') out.push(<mesh key={`g${i}`} position={[mid[0], h / 2 + 0.03, mid[2]]} rotation-y={rot} geometry={boxGeo(L, h - 0.14, 0.012)} material={AMAT.glass()} />);
      const k = Math.max(1, Math.round(L / (fill === 'bars' ? 0.14 * 8 : every)));
      for (let j = 0; j <= k; j++) posts.push(new THREE.Matrix4().makeTranslation(a[0] + ((b[0] - a[0]) * j) / k, h / 2, -(a[1] + ((b[1] - a[1]) * j) / k)));
      if (fill === 'bars') {
        out.push(<mesh key={`b${i}`} position={[mid[0], 0.18, mid[2]]} rotation-y={rot} geometry={boxGeo(L, 0.04, 0.04)} material={post} />);
        out.push(<mesh key={`m${i}`} position={[mid[0], h / 2 + 0.08, mid[2]]} rotation-y={rot} geometry={boxGeo(L, h - 0.3, 0.01)} material={AMAT.flat('#3d4a3a', 0.8)} />);
      }
    }
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, h, 0.06), post, posts.length);
    posts.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = true;
    out.push(<primitive key="posts" object={im} />);
    return out;
  }, [pts, h, every, fill, closed]);
  return <>{els}</>;
}

/** a clipped hedge along a polyline: the park's boundary */
export function Hedge({ pts, h = 1.3, w = 1.1 }: { pts: Vec2[]; h?: number; w?: number }) {
  const m = AMAT.flat('#3f6a2e', 1);
  return (
    <>
      {pts.slice(0, -1).map((a, i) => {
        const b = pts[i + 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return <mesh key={i} position={[(a[0] + b[0]) / 2, h / 2, -(a[1] + b[1]) / 2]} rotation-y={Math.atan2(b[1] - a[1], b[0] - a[0])} geometry={boxGeo(L + w, h, w)} material={m} castShadow receiveShadow />;
      })}
    </>
  );
}

/** a block of flats or offices in the middle distance, so an area has a town round it */
export function Block({ at, size, kind = 0 }: { at: Vec2; size: [number, number, number]; kind?: number }) {
  const walls = ['#e9dfcd', '#ddd1bb', '#f1ece2', '#d9cdb8', '#e6ddd0'];
  const mat = AMAT.punched(`b${kind % 5}`, walls[kind % 5]);
  const g = useMemo(() => boxGeo(size[0], size[2], size[1]), [size[0], size[1], size[2]]);
  return (
    <>
      <mesh position={[at[0], size[2] / 2, -at[1]]} geometry={g} material={mat} castShadow receiveShadow />
      <mesh position={[at[0], size[2] + 0.4, -at[1]]} geometry={boxGeo(size[0] + 0.3, 0.8, size[1] + 0.3)} material={AMAT.flat(walls[kind % 5], 0.9)} castShadow />
    </>
  );
}
/** a glass tower: a shaft, a crown set back from it, a dark plinth */
export function GlassTower({ at, size, tone = 0, rot = 0 }: { at: Vec2; size: [number, number, number]; tone?: number; rot?: number }) {
  const tones: Array<[number, number, number]> = [[96, 128, 150], [120, 144, 160], [84, 112, 128], [140, 152, 160], [104, 124, 136], [150, 140, 124]];
  const mat = AMAT.curtain(`t${tone % tones.length}`, tones[tone % tones.length]);
  const [sx, sy, h] = size;
  const shaft = useMemo(() => boxGeo(sx, h * 0.9, sy), [sx, sy, h]);
  const crown = useMemo(() => boxGeo(sx * 0.72, h * 0.1, sy * 0.72), [sx, sy, h]);
  return (
    <group position={[at[0], 0, -at[1]]} rotation-y={rot}>
      <mesh position-y={h * 0.45} geometry={shaft} material={mat} />
      <mesh position-y={h * 0.95} geometry={crown} material={mat} />
      <mesh position-y={3} geometry={boxGeo(sx + 4, 6, sy + 4)} material={AMAT.stone('#b9ad98')} />
    </group>
  );
}

/** a monopole mast for the area's mobile site (the Blender-built 30 m monopole) */
export function Mast({ id, at, h, az }: { id: AreaId; at: Vec2; h: number; az: number }) {
  return <P id={id} name="tower_monopole" at={at} h={0} rotY={(-az * Math.PI) / 180} scale={h / 30} />;
}

/** a small shade tree: a trunk and a crown of the Poly Haven scrub pieces, scaled up */
export function Tree({ id, at, i = 0, s = 1 }: { id: AreaId; at: Vec2; i?: number; s?: number }) {
  const trunk = AMAT.flat('#6a5540', 0.95);
  const hT = 2.3 * s;
  return (
    <>
      <Cyl at={at} r={0.16 * s} r2={0.11 * s} h={hT} mat={trunk} seg={8} />
      {[0, 1, 2].map((k) => {
        const a = i * 1.7 + (k * 2 * Math.PI) / 3;
        return <P key={k} id={id} name="ph_bush" part={`piece_${(i + k) % 5}`} at={[at[0] + Math.cos(a) * 0.7 * s, at[1] + Math.sin(a) * 0.7 * s]} h={hT - 0.5 * s + k * 0.25 * s} rotY={a} scale={(3.6 + ((i + k) % 3) * 0.5) * s} />;
      })}
    </>
  );
}

/** a fabric awning over a shopfront, sloping away from the wall it hangs on */
export function Awning({ at, w, depth = 1.6, h = 2.9, face, color }: { at: Vec2; w: number; depth?: number; h?: number; face: number; color: string }) {
  const m = AMAT.cloth(color);
  return (
    <group position={[at[0], h, -at[1]]} rotation-y={faceCompass(face)}>
      <group position={[0, 0, depth / 2]} rotation-x={0.26}>
        <mesh geometry={boxGeo(w, 0.03, depth)} material={m} castShadow receiveShadow />
        <mesh position={[0, -0.12, depth / 2]} geometry={boxGeo(w, 0.24, 0.02)} material={m} castShadow />
      </group>
    </group>
  );
}

/** fountain jets that rise and fall in a travelling wave (scene only) */
export function Jets({ pts, height, r = 0.22, speed = 0.9, phase = 0.45 }: { pts: Vec2[]; height: number; r?: number; speed?: number; phase?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.CylinderGeometry(r * 0.35, r, 1, 8, 1, true).translate(0, 0.5, 0), [r]);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f4fbff', emissive: '#cfe9f5', emissiveIntensity: 0.25, roughness: 0.3, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide }), []);
  const t = useRef(0);
  const m = useMemo(() => new THREE.Matrix4(), []);
  useFrame((_, dt) => {
    const im = ref.current;
    if (!im) return;
    t.current += Math.min(dt, 0.1);
    pts.forEach((p, i) => {
      const s = 0.5 + 0.5 * Math.sin(t.current * speed - i * phase);
      const hgt = Math.max(0.05, height * (0.15 + 0.85 * s * s));
      m.makeScale(1 + 0.6 * (1 - s), hgt, 1 + 0.6 * (1 - s)).setPosition(p[0], 0, -p[1]);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, pts.length]} frustumCulled={false} />;
}
