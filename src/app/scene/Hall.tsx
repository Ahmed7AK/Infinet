/**
 * The venue hall (scene 4): drawn entirely from VENUE.plan, the private venue file (src/engine/world/venue.ts,
 * src/app/venueLoad.ts). The shell (concrete walls, the glazed Link façade, the door into the immersive tunnel) is
 * the radio model's own walls, at their real heights; stands, drapes, furniture, trusses, screens and the stage are
 * visual only (the engine treats the drapes and stand panels as collision, not as radio walls).
 *
 * Built for one big room on a laptop: every repeated thing (stand panels, posters, counters, chairs, stools,
 * poufs, truss segments, ceiling lights) is one instanced mesh, and the stand numbers are one merged mesh on a
 * canvas atlas. Posters, screens and hoardings are generic canvas artwork: no real logos, names, text, faces or
 * anyone's content. The look (white boards with blue edges, cabinets, ring number signs, stools with backs, purple
 * pixel hoardings, black drapes, white shell chairs, lavender carpet) follows our set-up-day photos of 9 November.
 * The ceiling, its trusses and lights lift away in Network Vision, like the office roof.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type JSX } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYOUT, VENUE, type HallArt, type Vec2, type VenuePlan } from '../../engine/index';
import { boxGeo, MAT, pbr, useModel } from './assets';
import { visionK } from './vision';

type V3 = [number, number, number];
const UP = new THREE.Vector3(0, 1, 0);
const rad = (d: number) => (d * Math.PI) / 180;
/** rotation.y that turns a +Z-forward model toward compass `deg` */
const faceCompass = (deg: number) => ((180 - deg) * Math.PI) / 180;
const w3 = (p: Vec2, h = 0): V3 => [p[0], h, -p[1]];

function mat4(x: number, y: number, z: number, rotY = 0, s: V3 = [1, 1, 1]) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, rotY), new THREE.Vector3(...s));
}
function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, ms: THREE.Matrix4[], colors?: THREE.Color[], shadow = true, receive = true) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, ms.length));
  ms.forEach((x, i) => m.setMatrixAt(i, x));
  colors?.forEach((c, i) => m.setColorAt(i, c));
  m.count = ms.length;
  m.castShadow = shadow;
  m.receiveShadow = receive;
  m.computeBoundingSphere();
  return m;
}
/** shared plain materials, keyed by colour and finish */
const matCache = new Map<string, THREE.MeshStandardMaterial>();
function plain(color: string, o: { rough?: number; metal?: number; emissive?: number; side?: THREE.Side } = {}) {
  const key = `${color}|${o.rough ?? 0.85}|${o.metal ?? 0}|${o.emissive ?? 0}|${o.side ?? 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0, side: o.side ?? THREE.FrontSide });
    if (o.emissive) { m.emissive.set(color); m.emissiveIntensity = o.emissive * 2.2; }
    matCache.set(key, m);
  }
  return m;
}
/** flat carpet: a whisper of the concrete set's normal map for texture, no albedo map (keeps the colour true) */
function carpet(color: string) {
  const m = pbr('concrete', 0.9, { tint: color, normal: 0.22 });
  m.map = null; m.roughnessMap = null; m.roughness = 1;
  return m;
}
/** floor polygon with metre UVs taken from the hall's own origin (UVs near 40 000 would shimmer in float32) */
function hallFloor(poly: Vec2[], y: number, o: Vec2) {
  const shape = new THREE.Shape(poly.map(([x, yy]) => new THREE.Vector2(x - o[0], yy - o[1])));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[2 * i] = pos.getX(i); uv[2 * i + 1] = -pos.getZ(i); }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.translate(o[0], y, -o[1]);
  return g;
}

// ───────────── canvas artwork (generic) ─────────────
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
/** a carpet with pale flowing bands (the floor marked `waves` in the plan), 8 m a tile */
function wavesMat(color: string) {
  const t = canvasTex(512, 512, (g) => {
    g.fillStyle = color; g.fillRect(0, 0, 512, 512);
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    for (let k = 0; k < 6; k++) {
      g.lineWidth = 10 + (k % 3) * 8;
      g.beginPath();
      for (let x = -10; x <= 522; x += 8) { const y = 40 + k * 86 + 26 * Math.sin((x / 512) * Math.PI * 2 + k * 0.9); if (x < 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 8, 1 / 8);
  const m = carpet('#ffffff');
  m.map = t;
  return m;
}
/** a student research poster (A0): title band, author line, columns of text, figures. Seeded, so stable. */
const POSTER_ACCENT = ['#16205a', '#2bb6a8', '#5e2aa8', '#f08a2c', '#1d5fd6', '#d0338f'];
function posterTex(seed: number, title?: string) {
  let s = seed * 7919 + 13;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const acc = POSTER_ACCENT[seed % POSTER_ACCENT.length];
  return canvasTex(256, 362, (g) => {
    g.fillStyle = '#f7f6f2'; g.fillRect(0, 0, 256, 362);
    g.fillStyle = acc; g.fillRect(0, 0, 256, 58);
    if (title) {
      g.fillStyle = '#ffffff'; g.font = '700 34px Inter, Arial, sans-serif'; g.textAlign = 'center'; g.fillText(title, 128, 40);
    } else {
      g.fillStyle = 'rgba(255,255,255,0.92)'; g.fillRect(18, 16, 150 + rnd() * 60, 12); g.fillRect(18, 34, 90 + rnd() * 80, 9);
    }
    g.fillStyle = 'rgba(30,30,40,0.35)'; g.fillRect(18, 66, 120, 5);
    const cols = rnd() < 0.5 ? 2 : 3, cw = (256 - 18 * 2 - 10 * (cols - 1)) / cols;
    for (let c = 0; c < cols; c++) {
      let y = 82;
      const x = 18 + c * (cw + 10);
      while (y < 330) {
        if (rnd() < 0.22) {
          const fh = 34 + rnd() * 40;
          g.fillStyle = rnd() < 0.5 ? acc : ['#cfd8e3', '#e6d9c3', '#d5e8e2'][Math.floor(rnd() * 3)];
          g.globalAlpha = 0.75; g.fillRect(x, y, cw, fh); g.globalAlpha = 1;
          if (rnd() < 0.6) { // a bar chart
            g.fillStyle = '#ffffff';
            for (let b = 0; b < 5; b++) { const bh = fh * (0.2 + rnd() * 0.65); g.fillRect(x + 6 + b * (cw - 12) / 5, y + fh - bh - 4, (cw - 12) / 5 - 4, bh); }
          }
          y += fh + 8;
        } else {
          g.fillStyle = 'rgba(40,42,52,0.42)';
          g.fillRect(x, y, cw * (0.7 + rnd() * 0.3), 3);
          y += 7;
        }
      }
    }
    g.fillStyle = acc; g.fillRect(0, 346, 256, 16);
  });
}
/** generic LED-screen artwork: a soft gradient in the screen's colour with flowing arcs (no text, no logos) */
function screenTex(color: string) {
  return canvasTex(512, 256, (g) => {
    const c = new THREE.Color(color);
    const lit = c.clone().lerp(new THREE.Color('#7fd8ff'), 0.55);
    const grd = g.createLinearGradient(0, 0, 512, 256);
    grd.addColorStop(0, `#${c.getHexString()}`); grd.addColorStop(1, `#${lit.getHexString()}`);
    g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 6;
    for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(380, 300, 120 + k * 46, Math.PI, Math.PI * 1.75); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(48, 92, 170, 18); g.fillRect(48, 122, 120, 10);
    g.fillStyle = 'rgba(244,196,48,0.9)'; g.fillRect(48, 150, 56, 8);
  });
}

/** LED wall in a silver angular frame, with a pixel dissolve in one corner (the stage, from the photos) */
function framedTex(color: string) {
  return canvasTex(1024, 366, (g) => {
    const c = new THREE.Color(color), lit = c.clone().lerp(new THREE.Color('#ffffff'), 0.18);
    const grd = g.createLinearGradient(0, 0, 1024, 366);
    grd.addColorStop(0, `#${c.getHexString()}`); grd.addColorStop(1, `#${lit.getHexString()}`);
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 366);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 26; i++) for (let j = 0; j < 9; j++) if ((i * 7 + j * 13) % 5 < 2 && i + j > 22) g.fillRect(1024 - 16 - i * 16, 366 - 16 - j * 16, 13, 13);
    g.strokeStyle = '#d9dde6'; g.lineWidth = 9; g.lineJoin = 'miter';
    g.beginPath();
    g.moveTo(14, 120); g.lineTo(14, 40); g.lineTo(54, 14); g.lineTo(380, 14); g.lineTo(400, 30); g.lineTo(1010, 30);
    g.moveTo(1010, 250); g.lineTo(1010, 330); g.lineTo(970, 352); g.lineTo(640, 352); g.lineTo(620, 336); g.lineTo(14, 336); g.lineTo(14, 200);
    g.stroke();
  });
}
/** a round LED: teal face, a segmented silver ring, concentric rings inside */
function roundTex(color: string) {
  return canvasTex(512, 512, (g) => {
    g.fillStyle = '#1a1840'; g.beginPath(); g.arc(256, 256, 256, 0, Math.PI * 2); g.fill();
    g.fillStyle = color; g.beginPath(); g.arc(256, 256, 170, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#d9dde6'; g.lineWidth = 16;
    for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(256, 256, 214, (k * Math.PI) / 3 + 0.12, ((k + 1) * Math.PI) / 3 - 0.12); g.stroke(); }
    g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,0.7)';
    for (const r of [186, 242]) { g.beginPath(); g.arc(256, 256, r, 0, Math.PI * 2); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 10;
    for (const r of [70, 120]) { g.beginPath(); g.arc(256, 256, r, -0.4, Math.PI + 0.4); g.stroke(); }
  });
}
/** pixel icons for the hoardings (8 × 8; '.' empty) */
const ICONS: Record<'leaf' | 'bulb', { rows: string[]; ink: Record<string, string> }> = {
  leaf: { rows: ['.....GG.', '...GGGG.', '..GGGDG.', '.GGGDGG.', '.GGDGGG.', '.GDGGG..', '.DGGG...', 'D.......'], ink: { G: '#7ccc4f', D: '#3f8f2e' } },
  bulb: { rows: ['..YYYY..', '.YYWYYY.', 'YYWYYYYY', 'YYYYYYYY', '.YYYYYY.', '..YYYY..', '..SSSS..', '...SS...'], ink: { Y: '#f4c430', W: '#fff4c2', S: '#d6d7de' } },
};
/**
 * printed hoarding artwork drawn to the panel's size, mapped once over its face (boxGeo has metre UVs). 'pixel':
 * purple with stepped lilac squares (25 cm) along the foot and an optional pixel icon; 'loading': magenta with a
 * rounded progress bar filling in pixels; 'fascia': a magenta header with white rules. No text, so mirrored backs read.
 */
function artMat(art: HallArt, color: string, wM: number, hM: number, seed: number, icon?: 'leaf' | 'bulb') {
  const ppm = 64, W = Math.min(4096, Math.max(64, Math.round(wM * ppm))), Hh = Math.min(1024, Math.max(32, Math.round(hM * ppm)));
  const P = 0.25 * ppm;
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const t = canvasTex(W, Hh, (g) => {
    g.fillStyle = color; g.fillRect(0, 0, W, Hh);
    if (art === 'pixel') {
      const rows = Math.max(2, Math.floor((Hh * 0.55) / P)), cols = Math.ceil(W / P);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        if ((i + j) % 2 || rnd() > 0.62 - j * 0.11) continue;
        g.fillStyle = rnd() < 0.75 ? '#b9a9f2' : '#d6ccfa';
        g.fillRect(i * P + 1, Hh - (j + 1) * P + 1, P - 2, P - 2);
      }
      if (icon) {
        const ic = ICONS[icon], q = Math.min(P * 0.9, (Hh * 0.45) / 8), x0 = W * 0.3, y0 = Hh * 0.12;
        ic.rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') { g.fillStyle = ic.ink[ch]; g.fillRect(x0 + i * q, y0 + j * q, q, q); } }));
      }
    } else if (art === 'loading') {
      const grd = g.createLinearGradient(0, 0, 0, Hh);
      grd.addColorStop(0, '#d65bd2'); grd.addColorStop(1, color);
      g.fillStyle = grd; g.fillRect(0, 0, W, Hh);
      const bw = 3.2 * ppm, bh = Math.min(0.42 * ppm, Hh * 0.4), by = Hh * 0.45;
      for (let x = 0.6 * ppm; x + bw < W; x += 5 * ppm) {
        g.fillStyle = '#ffffff'; g.strokeStyle = '#2a2f7a'; g.lineWidth = 5;
        g.beginPath(); g.roundRect(x, by, bw, bh, bh / 2); g.fill(); g.stroke();
        const q = bh / 4, fill = bw * 0.6;
        g.fillStyle = '#2a2f7a'; g.fillRect(x + bh / 2, by + 2, fill - bh, bh - 4);
        for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) if (rnd() < 0.5 - i * 0.06) g.fillRect(x + fill - bh / 2 + i * q, by + j * q, q, q);
      }
    } else {
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(0, Hh * 0.1, W, 3); g.fillRect(0, Hh * 0.9 - 3, W, 3);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, Hh * 0.1 + 3, W, Hh * 0.8 - 6);
      for (let x = P; x < W; x += 6 * ppm) for (let k = 0; k < 4; k++) { g.fillStyle = '#e9a3e6'; g.fillRect(x + k * P, Hh * 0.9 - 3 - (k + 1) * P * 0.6, P * 0.55, P * 0.55); }
    }
  });
  t.repeat.set(1 / wM, 1 / hM);
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.75 });
}

// ───────────── reusable geometry ─────────────
const bx = (sx: number, sy: number, sz: number, x: number, y: number, z: number, tiltX = 0) => {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (tiltX) g.rotateX(tiltX);
  return g.translate(x, y, z);
};
/** a moulded shell chair (the photos: white, on four splayed wooden legs): the shell, then the legs, the sitter faces +Z */
const shellGeo = mergeGeometries([bx(0.46, 0.045, 0.43, 0, 0.45, 0.01), bx(0.46, 0.34, 0.04, 0, 0.66, -0.2, -0.16), bx(0.44, 0.06, 0.04, 0, 0.47, 0.21)])!;
const legsGeo = (() => {
  const parts: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[0.17, 0.15], [-0.17, 0.15], [0.17, -0.15], [-0.17, -0.15]]) {
    const g = new THREE.CylinderGeometry(0.014, 0.011, 0.45, 4, 1, true);
    g.rotateZ(-x * 0.5); g.rotateX(z * 0.5);
    parts.push(g.translate(x * 1.12, 0.215, z * 1.12));
  }
  return mergeGeometries(parts)!;
})();
/** a bar stool with a back (white upholstery) on a chrome gas lift, foot ring and round base */
const stoolSeatGeo = mergeGeometries([bx(0.42, 0.07, 0.4, 0, 0.74, 0.02), bx(0.4, 0.3, 0.06, 0, 0.94, -0.19, -0.12)])!;
const stoolMetalGeo = (() => {
  const c = (r: number, h: number, y: number) => new THREE.CylinderGeometry(r, r, h, 10).translate(0, y, 0);
  const ring = new THREE.TorusGeometry(0.17, 0.011, 4, 16).rotateX(Math.PI / 2).translate(0, 0.42, 0);
  return mergeGeometries([c(0.026, 0.7, 0.36), c(0.22, 0.025, 0.012), ring])!;
})();
/** the number sign's navy ring and the two loops it hangs in (gap at the bottom, sitting on the board) */
const signRingGeo = new THREE.TorusGeometry(0.455, 0.035, 6, 32).rotateY(Math.PI / 2);
const loopGeo = (R: number) => new THREE.TorusGeometry(R, 0.028, 5, 26, Math.PI * 1.6).rotateZ(-Math.PI * 0.3).rotateY(Math.PI / 2);
/** the high-bay fixture's lens: a cluster of seven LEDs */
const clusterGeo = mergeGeometries([[0, 0], ...Array.from({ length: 6 }, (_, k) => [Math.cos((k * Math.PI) / 3) * 0.2, Math.sin((k * Math.PI) / 3) * 0.2])]
  .map(([x, z]) => new THREE.CircleGeometry(0.085, 14).rotateX(Math.PI / 2).translate(x, -0.175, z)))!;
/** a pleated drape: a plane folded every 24 cm, hanging from its top edge */
function drapeGeo(len: number, h: number) {
  const g = new THREE.PlaneGeometry(len, h, Math.max(1, Math.round(len / 0.06)), 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setZ(i, 0.05 * Math.sin((p.getX(i) / 0.24) * Math.PI * 2));
  g.computeVertexNormals();
  return g;
}
const poufGeo = new THREE.CylinderGeometry(1, 1, 0.42, 24).translate(0, 0.21, 0);
/** one metre of square box truss (four chords, zigzag lacing on each face), 0.3 m across, along +Y */
const trussGeo = (() => {
  const parts: THREE.BufferGeometry[] = [];
  const s = 0.15, r = 0.022;
  for (const [x, z] of [[s, s], [-s, s], [-s, -s], [s, -s]]) parts.push(new THREE.CylinderGeometry(r, r, 1, 6).translate(x, 0, z));
  const lace = (a: THREE.Vector3, b: THREE.Vector3) => {
    const d = b.clone().sub(a), L = d.length();
    const g = new THREE.CylinderGeometry(0.011, 0.011, L, 5);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push(g);
  };
  const faces: Array<[number, number, number, number]> = [[s, s, -s, s], [-s, s, -s, -s], [-s, -s, s, -s], [s, -s, s, s]];
  for (const [x0, z0, x1, z1] of faces) {
    lace(new THREE.Vector3(x0, -0.5, z0), new THREE.Vector3(x1, 0, z1));
    lace(new THREE.Vector3(x1, 0, z1), new THREE.Vector3(x0, 0.5, z0));
  }
  return mergeGeometries(parts)!;
})();
/** truss segments (1 m each, stretched to fit) between two points (three coords), at a scale */
function trussMatrices(a: THREE.Vector3, b: THREE.Vector3, k = 1, out: THREE.Matrix4[] = []) {
  const d = b.clone().sub(a);
  const L = d.length();
  const n = Math.max(1, Math.round(L / k));
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize());
  for (let i = 0; i < n; i++) {
    const p = a.clone().addScaledVector(d, (i + 0.5) / n);
    out.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(k, L / n, k)));
  }
  return out;
}

// ───────────── the shell: the radio model's walls, the roof, the outside ─────────────
function Shell({ plan }: { plan: VenuePlan }) {
  const roof = useRef<THREE.Group>(null);
  useFrame(() => { if (roof.current) roof.current.visible = visionK.v < 0.5; });
  const els = useMemo(() => {
    const out: JSX.Element[] = [];
    const wallMat = MAT.paint('#c9c7c1'), linkMat = MAT.paint('#e7e3da'), glass = MAT.glassLowE(), frame = MAT.frame();
    LAYOUT.walls.forEach((w, i) => {
      if (w.zone !== 'hall' || w.rfIgnore) return;
      const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], len = Math.hypot(dx, dy), rot = Math.atan2(dy, dx);
      const mid = [(w.a[0] + w.b[0]) / 2, -(w.a[1] + w.b[1]) / 2];
      const inHall = w.h >= plan.wallH;
      const top = inHall ? plan.ceilingH + 0.3 : w.h + 0.3;
      if (w.door) { // an opening 3.2 m high, the wall closed above it
        out.push(<mesh key={`d${i}`} position={[mid[0], (3.2 + top) / 2, mid[1]]} rotation-y={rot} geometry={boxGeo(len, top - 3.2, 0.3)} material={wallMat} castShadow receiveShadow />);
        return;
      }
      if (w.material.includes('glass')) {
        out.push(<mesh key={`g${i}`} position={[mid[0], w.h / 2, mid[1]]} rotation-y={rot} geometry={boxGeo(len, w.h, 0.05)} material={glass} />);
        const n = Math.max(1, Math.round(len / 1.8));
        const ms: THREE.Matrix4[] = [];
        for (let k = 0; k <= n; k++) { const t = k / n; ms.push(mat4(w.a[0] + dx * t, w.h / 2, -(w.a[1] + dy * t), rot)); }
        out.push(<primitive key={`gm${i}`} object={instanced(new THREE.BoxGeometry(0.08, w.h, 0.16), frame, ms)} />);
        for (const y of [0.05, 3.0, w.h - 0.05]) out.push(<mesh key={`gt${i}-${y}`} position={[mid[0], y, mid[1]]} rotation-y={rot} geometry={boxGeo(len, 0.1, 0.16)} material={frame} />);
        return;
      }
      out.push(<mesh key={`w${i}`} position={[mid[0], top / 2, mid[1]]} rotation-y={rot} geometry={boxGeo(len + 0.3, top, 0.3)} material={inHall ? wallMat : linkMat} castShadow receiveShadow />);
      if (!inHall) return;
      if (plan.drapeH) { // black pleated drapes down the wall, on the hall side (the photos)
        const [cx, cy] = [plan.origin[0] + plan.size[0] / 2, plan.origin[1] - plan.size[1] / 2];
        let nx = -dy / len, ny = dx / len;
        if (nx * (cx - (w.a[0] + w.b[0]) / 2) + ny * (cy - (w.a[1] + w.b[1]) / 2) < 0) { nx = -nx; ny = -ny; }
        out.push(<mesh key={`dr${i}`} position={[mid[0] + nx * 0.4, plan.drapeH / 2, mid[1] - ny * 0.4]} rotation-y={rot} geometry={drapeGeo(len - 0.4, plan.drapeH)} material={plain('#141519', { rough: 0.95, side: THREE.DoubleSide })} />);
      } else {  // a dark skirting band, as halls have, so the wall meets the floor
        out.push(<mesh key={`sk${i}`} position={[mid[0], 0.6, mid[1]]} rotation-y={rot} geometry={boxGeo(len, 1.2, 0.32)} material={plain('#3b3e45')} receiveShadow />);
      }
    });
    return out;
  }, [plan]);
  const roofEls = useMemo(() => {
    const [ox, oy] = plan.origin, [W, H] = plan.size;
    const out: JSX.Element[] = [];
    const hallMid: V3 = [ox + W / 2, plan.ceilingH + 0.15, -(oy - H / 2)];
    out.push(<mesh key="roof" position={hallMid} geometry={boxGeo(W + 0.6, 0.3, H + 0.6)} material={plain('#2f3238', { rough: 0.95 })} castShadow receiveShadow />);
    // the Link's lower roof (6 m), over the strip west of the hall wall
    const link = LAYOUT.walls.find((w) => w.zone === 'hall' && w.material.includes('glass'));
    if (link) {
      const x0 = link.a[0], lh = link.h;
      const y0 = Math.min(link.a[1], link.b[1]), y1 = Math.max(link.a[1], link.b[1]);
      out.push(<mesh key="linkroof" position={[(x0 + ox) / 2, lh + 0.15, -(y0 + y1) / 2]} geometry={boxGeo(ox - x0 + 0.3, 0.3, y1 - y0 + 0.3)} material={plain('#ebe8e1', { rough: 0.9 })} castShadow receiveShadow />);
      // a row of downlights in the Link
      const ms: THREE.Matrix4[] = [];
      for (let y = y0 + 3; y < y1 - 1; y += 4.5) ms.push(mat4((x0 + ox) / 2, lh - 0.02, -y));
      out.push(<primitive key="linklights" object={instanced(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.1, 1.9) }), ms, undefined, false)} />);
    }
    // roof trusses spanning the hall every ~9 m (deep box trusses, dark grey), and the high-bay lights
    const tm: THREE.Matrix4[] = [];
    for (let x = ox + 4.5; x < ox + W; x += 9.15) trussMatrices(new THREE.Vector3(x, plan.ceilingH - 0.6, -oy), new THREE.Vector3(x, plan.ceilingH - 0.6, -(oy - H)), 3, tm);
    out.push(<primitive key="rtruss" object={instanced(trussGeo, plain('#3f434b', { rough: 0.75, metal: 0.25 }), tm, undefined, false)} />);
    const lm = plan.lights.map((p) => mat4(p[0], plan.ceilingH - 1.4, -p[1]));
    out.push(<primitive key="lbody" object={instanced(new THREE.CylinderGeometry(0.24, 0.36, 0.34, 16), plain('#5a5e66', { rough: 0.5, metal: 0.5 }), lm, undefined, false)} />);
    out.push(<primitive key="llens" object={instanced(clusterGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.5, 2.3) }), lm, undefined, false)} />);
    return out;
  }, [plan]);
  const ground = useMemo(() => {
    const [ox, oy] = plan.origin, [W, H] = plan.size;
    const g = new THREE.PlaneGeometry(420, 420).rotateX(-Math.PI / 2);
    return <mesh position={[ox + W / 2, -0.02, -(oy - H / 2)]} geometry={g} material={MAT.paving()} receiveShadow />;
  }, [plan]);
  return <>{els}{ground}<group ref={roof}>{roofEls}</group></>;
}

// ───────────── floors ─────────────
function Floors({ plan }: { plan: VenuePlan }) {
  const els = useMemo(() => plan.floors.map((f, i) => {
    // the Link's terrazzo and the hall's light grey floor (the photos) at 0; event carpets a little proud of it
    const y = f.y ?? (i < 2 ? 0 : 0.012 + i * 0.0015);
    const mat = f.color === 'terrazzo' ? MAT.terrazzo() : f.waves ? wavesMat(f.color) : carpet(f.color);
    return <mesh key={i} geometry={hallFloor(f.poly, y, plan.origin)} material={mat} receiveShadow />;
  }), [plan]);
  return <>{els}</>;
}

// ───────────── stands: back-to-back boards, posters, ring number signs, cabinets, stools ─────────────
const OURS = '31';
/** stable yaw for a stool at a spot (they stand at all angles in the photos) */
const yawAt = (p: Vec2) => (((Math.sin(p[0] * 12.9898 + p[1] * 78.233) * 43758.5453) % 1) + 1) % 1 * Math.PI * 2;
function Stands({ plan }: { plan: VenuePlan }) {
  const laptop = useModel('laptop');
  const { meshes, ours } = useMemo(() => {
    const panel: THREE.Matrix4[] = [], panelCol: THREE.Color[] = [], trim: THREE.Matrix4[] = [], counter: THREE.Matrix4[] = [], seam: THREE.Matrix4[] = [];
    const ring: THREE.Matrix4[] = [], loopA: THREE.Matrix4[] = [], loopB: THREE.Matrix4[] = [];
    const posters: THREE.Matrix4[][] = [[], [], [], [], [], []];
    const ourPoster: THREE.Matrix4[] = [];
    const numGeos: THREE.BufferGeometry[] = [];
    let ours: { p: V3; rot: number } | null = null;
    const white = new THREE.Color('#f2f2f0'), slate = new THREE.Color('#38435e');
    plan.stands.forEach((s, si) => {
      const th = rad(s.rotDeg);
      const base = mat4(s.at[0], 0, -s.at[1], th);
      // numbered boards (the ATP): white with royal-blue edges; the unnumbered rings of the other programme: slate frames (the photos)
      const atp = s.nums.some(Boolean);
      panel.push(base.clone().multiply(mat4(0, 1.2, 0)));
      panelCol.push(atp ? white : slate);
      if (atp) for (const z of [-0.6, 0.6]) trim.push(base.clone().multiply(mat4(0, 1.2, z)));
      ring.push(base.clone().multiply(mat4(0, 2.88, 0)));
      loopA.push(base.clone().multiply(mat4(0.05, 2.95, 0)));
      loopB.push(base.clone().multiply(mat4(-0.05, 3.0, 0)));
      [-1, 1].forEach((sx, side) => {
        const num = s.nums[side];
        const face = sx < 0 ? -Math.PI / 2 : Math.PI / 2;
        counter.push(base.clone().multiply(mat4(sx * 0.23, 0.4, 0)));
        seam.push(base.clone().multiply(mat4(sx * 0.381, 0.37, 0)));
        const pm = base.clone().multiply(mat4(sx * 0.07, 1.625, 0, face));
        if (num === OURS) {
          ourPoster.push(pm);
          const v = new THREE.Vector3(sx * 0.23, 0.8, 0.1).applyMatrix4(base);
          ours = { p: [v.x, v.y, v.z], rot: th + (sx < 0 ? -Math.PI / 2 : Math.PI / 2) + Math.PI };
        } else posters[(si * 2 + side) % posters.length].push(pm);
        // the sign: its number (cell 64 of the atlas is a blank card, for the rings whose numbers we don't have)
        const n = num ? Number(num) : 64;
        if (!(n >= 1 && n <= 64)) return;
        const g = new THREE.PlaneGeometry(0.88, 0.88);
        const col = (n - 1) % 8, row = Math.floor((n - 1) / 8);
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + uv.getX(i)) / 8, 1 - (row + 1 - uv.getY(i)) / 8);
        g.applyMatrix4(base.clone().multiply(mat4(sx * 0.02, 2.88, 0, face)));
        numGeos.push(g);
      });
    });
    const out: THREE.Object3D[] = [];
    out.push(instanced(boxGeo(0.12, 2.4, 1.2), plain('#ffffff', { rough: 0.7 }), panel, panelCol));
    out.push(instanced(boxGeo(0.15, 2.42, 0.07), plain('#4560d0', { rough: 0.5 }), trim));
    out.push(instanced(boxGeo(0.3, 0.8, 1.2), plain('#f2f2f0', { rough: 0.55 }), counter));
    // the cabinet's two doors: a seam down the middle and one under the top
    const seamGeo = mergeGeometries([new THREE.BoxGeometry(0.004, 0.66, 0.006), new THREE.BoxGeometry(0.004, 0.006, 1.14).translate(0, 0.34, 0)])!;
    out.push(instanced(seamGeo, plain('#b9b9b6'), seam, undefined, false, false));
    const navy = plain('#2a3570', { rough: 0.45, metal: 0.2 });
    // the signs hang high and thin: no shadows (an instanced mesh is never culled, so all would draw into the shadow map)
    out.push(instanced(signRingGeo, navy, ring, undefined, false), instanced(loopGeo(0.6), navy, loopA, undefined, false), instanced(loopGeo(0.68), navy, loopB, undefined, false));
    const pg = new THREE.PlaneGeometry(1.0, 1.45);
    // posters take no shadows: the overhead light grazes vertical faces and its shadow map would streak them
    posters.forEach((ms, k) => { if (ms.length) out.push(instanced(pg, new THREE.MeshStandardMaterial({ map: posterTex(k + 1), roughness: 0.8 }), ms, undefined, false, false)); });
    if (ourPoster.length) out.push(instanced(pg, new THREE.MeshStandardMaterial({ map: posterTex(0, 'Infinet'), roughness: 0.8 }), ourPoster, undefined, false, false));
    if (numGeos.length) {
      const atlas = numberAtlas();
      const m = new THREE.Mesh(mergeGeometries(numGeos)!, new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, roughness: 0.6, side: THREE.DoubleSide }));
      m.receiveShadow = true;
      out.push(m);
    }
    return { meshes: out, ours: ours as { p: V3; rot: number } | null };
  }, [plan]);
  const stools = useMemo(() => {
    const ms = plan.stools.map((p) => mat4(p[0], 0.015, -p[1], yawAt(p)));
    return [instanced(stoolSeatGeo, plain('#f4f4f2', { rough: 0.45 }), ms), instanced(stoolMetalGeo, plain('#d8d9de', { rough: 0.25, metal: 0.9 }), ms, undefined, false)];
  }, [plan]);
  return (
    <>
      {meshes.map((m, i) => <primitive key={i} object={m} />)}
      {stools.map((m, i) => <primitive key={`st${i}`} object={m} />)}
      {ours && <primitive object={laptop} position={ours.p} rotation-y={ours.rot} />}
    </>
  );
}
/** stand number cards 1 … 63 on white discs (8 × 8 cells; cell 64 is a card with its code lines only), redrawn once
 *  the UI font has loaded */
function numberAtlas() {
  const draw = (g: CanvasRenderingContext2D) => {
    g.clearRect(0, 0, 1024, 1024);
    for (let n = 1; n <= 64; n++) {
      const cx = ((n - 1) % 8) * 128 + 64, cy = Math.floor((n - 1) / 8) * 128 + 64;
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, 63, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f7f7f5'; g.fillRect(cx - 30, cy - 34, 60, 70);
      g.fillStyle = '#9a9ca3'; g.fillRect(cx - 20, cy + 20, 40, 5);
      if (n === 64) { g.fillRect(cx - 14, cy - 12, 28, 18); continue; }
      g.fillStyle = '#16171c'; g.font = '700 46px Inter, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), cx, cy - 6);
    }
  };
  const t = canvasTex(1024, 1024, draw);
  void document.fonts?.ready.then(() => { draw((t.image as HTMLCanvasElement).getContext('2d')!); t.needsUpdate = true; });
  return t;
}

// ───────────── drapes, partitions, boxes, stage, furniture, screens ─────────────
function Fitout({ plan }: { plan: VenuePlan }) {
  const els = useMemo(() => {
    const out: JSX.Element[] = [];
    plan.walls.forEach((w, i) => {
      const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], len = Math.hypot(dx, dy);
      if (len < 0.01) return;
      const y0 = w.y ?? 0, t = w.thick ?? 0.1;
      const mat = w.art ? artMat(w.art, w.color, len, w.h, i + 1, w.icon) : plain(w.color, { rough: 0.95, emissive: w.emissive });
      out.push(<mesh key={`v${i}`} position={[(w.a[0] + w.b[0]) / 2, y0 + w.h / 2, -(w.a[1] + w.b[1]) / 2]} rotation-y={Math.atan2(dy, dx)} geometry={boxGeo(len, w.h, t)} material={mat} castShadow={!w.emissive} receiveShadow />);
    });
    plan.boxes.forEach((b, i) => {
      const [sx, sy, h] = b.size, y0 = b.y ?? 0;
      const mat = b.art ? artMat(b.art, b.color, sx, h, 100 + i) : plain(b.color, { rough: 0.7, emissive: b.emissive });
      out.push(<mesh key={`b${i}`} position={[b.at[0], y0 + h / 2, -b.at[1]]} rotation-y={rad(b.rotDeg ?? 0)} geometry={boxGeo(sx, h, sy)} material={mat} castShadow receiveShadow />);
    });
    plan.cylinders.forEach((c, i) => {
      const y0 = c.y ?? 0;
      out.push(<mesh key={`c${i}`} position={[c.at[0], y0 + c.h / 2, -c.at[1]]} material={plain(c.color, { rough: 0.6, emissive: c.emissive })} castShadow receiveShadow><cylinderGeometry args={[c.r, c.r, c.h, 40]} /></mesh>);
    });
    plan.domes.forEach((d, i) => {
      out.push(<mesh key={`dm${i}`} position={[d.at[0], 0, -d.at[1]]} material={plain(d.color, { rough: 0.5, side: THREE.DoubleSide })} castShadow receiveShadow><sphereGeometry args={[d.r, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>);
      // its frame: a geodesic lattice laid over the shell
      out.push(<mesh key={`dl${i}`} position={[d.at[0], 0, -d.at[1]]} scale={[1.01, 1.01, 1.01]}><icosahedronGeometry args={[d.r, 2]} /><meshBasicMaterial color="#9aa3b5" wireframe /></mesh>);
    });
    plan.screens.forEach((s, i) => {
      const rot = faceCompass(s.faceDeg);
      const f = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
      const at = new THREE.Vector3(s.at[0], s.y + s.h / 2, -s.at[1]);
      const glow = new THREE.Color(1.25, 1.25, 1.25);
      if (s.round) {
        out.push(<mesh key={`sb${i}`} position={at.clone().addScaledVector(f, -0.07)} rotation-y={rot} geometry={new THREE.CylinderGeometry(s.w / 2 + 0.12, s.w / 2 + 0.12, 0.12, 64).rotateX(Math.PI / 2)} material={plain('#cfd3dc', { rough: 0.3, metal: 0.8 })} />);
        out.push(<mesh key={`s${i}`} position={at.clone().addScaledVector(f, 0.002)} rotation-y={rot}><circleGeometry args={[s.w / 2, 64]} /><meshBasicMaterial map={roundTex(s.color)} color={glow} /></mesh>);
        return;
      }
      out.push(<mesh key={`sb${i}`} position={at.clone().addScaledVector(f, -0.06)} rotation-y={rot} geometry={boxGeo(s.w + 0.12, s.h + 0.12, 0.1)} material={plain('#111216', { rough: 0.4 })} castShadow />);
      out.push(<mesh key={`s${i}`} position={at.clone().addScaledVector(f, 0.002)} rotation-y={rot}><planeGeometry args={[s.w, s.h]} /><meshBasicMaterial map={s.frame ? framedTex(s.color) : screenTex(s.color)} color={s.frame ? undefined : glow} /></mesh>);
    });
    return out;
  }, [plan]);
  const inst = useMemo(() => {
    const out: THREE.Object3D[] = [];
    const def = new THREE.Color('#f3f3f1');
    const cm = plan.chairs.map((c) => mat4(c.at[0], 0.015, -c.at[1], faceCompass(c.faceDeg)));
    out.push(instanced(shellGeo, plain('#ffffff', { rough: 0.45 }), cm, plan.chairs.map((c) => (c.color ? new THREE.Color(c.color) : def))));
    out.push(instanced(legsGeo, plain('#b88a58', { rough: 0.6 }), cm, undefined, false));
    out.push(instanced(poufGeo, plain('#ffffff', { rough: 0.95 }), plan.poufs.map((p) => mat4(p.at[0], 0.015, -p.at[1], 0, [p.r, 1, p.r])), plan.poufs.map((p) => new THREE.Color(p.color))));
    const tm: THREE.Matrix4[] = [];
    for (const t of plan.trusses) trussMatrices(new THREE.Vector3(t.a[0], t.a[2], -t.a[1]), new THREE.Vector3(t.b[0], t.b[2], -t.b[1]), 1, tm);
    out.push(instanced(trussGeo, plain('#c9ccd2', { rough: 0.35, metal: 0.85 }), tm));
    return out;
  }, [plan]);
  return <>{els}{inst.map((m, i) => <primitive key={i} object={m} />)}</>;
}

// ───────────── network hardware: the venue's APs on drop rods, the mobile mast outside ─────────────
function ApMount({ at, ceiling }: { at: V3; ceiling: number }) {
  const ap = useModel('ap_ceiling');
  return (
    <>
      <primitive object={ap} position={at} />
      <mesh position={[at[0], (at[1] + ceiling) / 2, at[2]]} material={plain('#8d9199', { rough: 0.4, metal: 0.7 })}><cylinderGeometry args={[0.02, 0.02, ceiling - at[1], 8]} /></mesh>
    </>
  );
}
function Mast({ at, scale }: { at: V3; scale: number }) {
  const m = useModel('tower_monopole');
  return <primitive object={m} position={at} scale={scale} />;
}
function Network({ plan }: { plan: VenuePlan }) {
  const txs = LAYOUT.transmitters.filter((t) => t.zone === 'hall');
  return (
    <>
      {txs.filter((t) => t.kind === 'wifi').map((t) => <ApMount key={t.id} at={w3([t.pos[0], t.pos[1]], t.pos[2])} ceiling={plan.ceilingH} />)}
      {txs.filter((t) => t.kind === 'cell').map((t) => <Mast key={t.id} at={w3([t.pos[0], t.pos[1]], 0)} scale={t.pos[2] / 30} />)}
    </>
  );
}

export function Hall() {
  const plan = VENUE?.plan;
  const fill = useRef<THREE.HemisphereLight>(null);
  // the hall's own light: high bays give an even, slightly warm wash; the ceiling light (World.tsx) adds the shadows
  useFrame(() => { if (fill.current) fill.current.intensity = 0.9 * (1 - 0.6 * visionK.v); });
  if (!plan) return null;
  return (
    <>
      <hemisphereLight ref={fill} args={['#fff4e6', '#5b5852', 0.9]} />
      <Shell plan={plan} />
      <Floors plan={plan} />
      <Stands plan={plan} />
      <Fitout plan={plan} />
      <Network plan={plan} />
    </>
  );
}
