/**
 * What the office monitors show: four generic work screens drawn on canvases at start-up (a spreadsheet, a mail
 * client, a dashboard, a code editor). Text is drawn as grey bars, so there are no words, names or logos to read.
 * The desk set's Screen mesh has no UVs (it is a box from build_all.py), so they are added here once.
 */
import * as THREE from 'three';

type Draw = (x: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => void;

const bars = (x: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, c: string) => { x.fillStyle = c; x.fillRect(x0, y0, w, h); };

const DRAW: Draw[] = [
  // spreadsheet
  (x, w, h, rnd) => {
    bars(x, 0, 0, w, h, '#f7f8f9');
    bars(x, 0, 0, w, 22, '#1f6f4a');
    bars(x, 0, 22, w, 18, '#e6e9ec');
    x.strokeStyle = '#d5d9dd'; x.lineWidth = 1;
    for (let r = 40; r < h; r += 14) { x.beginPath(); x.moveTo(0, r + 0.5); x.lineTo(w, r + 0.5); x.stroke(); }
    for (let c = 34; c < w; c += 58) { x.beginPath(); x.moveTo(c + 0.5, 40); x.lineTo(c + 0.5, h); x.stroke(); }
    for (let r = 44; r < h - 10; r += 14) for (let c = 38; c < w - 40; c += 58) if (rnd() > 0.25) bars(x, c, r, 14 + rnd() * 36, 6, rnd() > 0.9 ? '#2f7d58' : '#6b737b');
  },
  // mail
  (x, w, h, rnd) => {
    bars(x, 0, 0, w, h, '#ffffff');
    bars(x, 0, 0, 92, h, '#eef1f5');
    bars(x, 0, 0, w, 24, '#2d5b8c');
    for (let r = 34; r < h - 10; r += 26) { bars(x, 98, r, 150, 7, '#3b4450'); bars(x, 98, r + 11, 120 + rnd() * 60, 5, '#a0a8b2'); if (r === 60) bars(x, 92, r - 6, 3, 24, '#2d5b8c'); }
    for (let r = 34; r < h; r += 16) bars(x, 10, r, 50 + rnd() * 24, 6, '#7d8793');
    bars(x, 300, 36, 180, 9, '#2c333c');
    for (let r = 58; r < h - 20; r += 12) bars(x, 300, r, 160 + rnd() * 50, 5, '#8a929c');
  },
  // dashboard
  (x, w, h, rnd) => {
    bars(x, 0, 0, w, h, '#f2f4f7');
    bars(x, 0, 0, w, 22, '#2b3440');
    const panel = (px: number, py: number, pw: number, ph: number) => { bars(x, px, py, pw, ph, '#ffffff'); bars(x, px + 8, py + 8, pw * 0.4, 6, '#59626d'); };
    panel(8, 30, 160, 110); panel(176, 30, 160, 110); panel(344, 30, 160, 110); panel(8, 148, 328, 130); panel(344, 148, 160, 130);
    for (let i = 0; i < 9; i++) { const bh = 20 + rnd() * 60; bars(x, 18 + i * 16, 130 - bh, 10, bh, '#3f7fbf'); }
    x.strokeStyle = '#d9822b'; x.lineWidth = 2.5; x.beginPath();
    for (let i = 0; i <= 20; i++) { const px = 186 + i * 7, py = 110 - 40 * Math.sin(i * 0.45) * (0.6 + 0.4 * rnd()); if (i) x.lineTo(px, py); else x.moveTo(px, py); }
    x.stroke();
    x.fillStyle = '#2f9d6a'; x.beginPath(); x.arc(424, 92, 36, -Math.PI / 2, Math.PI * 0.9); x.lineTo(424, 92); x.fill();
    x.strokeStyle = '#3f7fbf'; x.lineWidth = 2; x.beginPath();
    for (let i = 0; i <= 40; i++) { const px = 18 + i * 7.8, py = 250 - 50 * (0.5 + 0.5 * Math.sin(i * 0.3)) * (0.7 + 0.3 * rnd()); if (i) x.lineTo(px, py); else x.moveTo(px, py); }
    x.stroke();
    for (let r = 172; r < 270; r += 16) bars(x, 354, r, 90 + rnd() * 50, 6, '#8a929c');
  },
  // code editor
  (x, w, h, rnd) => {
    bars(x, 0, 0, w, h, '#1e2329');
    bars(x, 0, 0, 70, h, '#252b32');
    bars(x, 0, 0, w, 20, '#2c333b');
    const cols = ['#8fb6e8', '#d6a86a', '#9ccc8c', '#c792ea', '#b8c0c8'];
    let indent = 0;
    for (let r = 28; r < h - 6; r += 11) {
      bars(x, 76, r, 12, 5, '#4b545e');
      if (rnd() < 0.12) { indent = Math.max(0, indent - 1); continue; }
      let cx = 96 + indent * 16;
      const n = 1 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) { const ww = 14 + rnd() * 60; bars(x, cx, r, ww, 5, cols[Math.floor(rnd() * cols.length)]); cx += ww + 6; }
      if (rnd() < 0.2) indent = Math.min(4, indent + 1);
    }
    for (let r = 28; r < h; r += 14) bars(x, 8, r, 40 + rnd() * 16, 5, '#6c7680');
  },
];

let mats: THREE.MeshStandardMaterial[] | null = null;
/** the four screen materials (lit from within: emissive = the picture) */
export function screenMaterials(): THREE.MeshStandardMaterial[] {
  if (mats) return mats;
  mats = DRAW.map((draw, i) => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 288;
    const x = c.getContext('2d')!;
    let seed = 97 + i * 31;
    draw(x, c.width, c.height, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.25, metalness: 0 });
  });
  return mats;
}

const mapped = new WeakSet<THREE.BufferGeometry>();
/** planar UVs across a screen box's face (three local x → u, y → v), once per shared geometry */
export function screenUVs(g: THREE.BufferGeometry) {
  if (mapped.has(g)) return;
  mapped.add(g);
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[2 * i] = (p.getX(i) - b.min.x) / (b.max.x - b.min.x || 1);
    uv[2 * i + 1] = (p.getY(i) - b.min.y) / (b.max.y - b.min.y || 1);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
