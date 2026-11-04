/** Sky and sun energy in each HDRI (calibration aid for World.tsx): npx tsx tools/assets/hdr-stats.ts */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
for (const f of ['midday', 'golden']) {
  const buf = readFileSync(`public/hdri/${f}.hdr`);
  const l = new HDRLoader().setDataType(THREE.FloatType);
  const r: any = l.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const { width: w, height: h, data } = r;
  let sum = 0, cnt = 0, max = 0, Esky = 0, Esun = 0;
  for (let y = 0; y < h / 2; y += 2) for (let x = 0; x < w; x += 4) { const k = 4 * (y * w + x); sum += 0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2]; cnt++; }
  const cap = (sum / cnt) * 3;
  for (let y = 0; y < h / 2; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI; // row 0 top
    const dO = (2 * Math.PI / w) * (Math.PI / h) * Math.cos(lat);
    for (let x = 0; x < w; x++) {
      const k = 4 * (y * w + x); const L = 0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2];
      max = Math.max(max, L);
      const Lc = Math.min(L, cap);
      Esky += Lc * dO * Math.sin(lat); // horizontal irradiance from sky (clamped)
      if (L > cap) Esun += (L - cap) * dO;
    }
  }
  console.log(f, { w, h, meanSky: +(sum / cnt).toFixed(3), max: +max.toFixed(0), EskyHoriz: +Esky.toFixed(2), EsunNormal: +Esun.toFixed(2) });
}
