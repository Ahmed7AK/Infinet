/**
 * Minimap (plan §8.3): Infinet's own coverage map (belief, P6) around you, turned with the camera so
 * "up" is where you are looking. Buildings in outline, you as an arrow, the predicted edge as a dashed
 * amber line. It never shows the attacker: the phone does not know where it is (P5).
 */
import { useEffect, useRef } from 'react';
import { LAYOUT, type Vec2 } from '../../engine/index';
import { driver, useUi } from '../driver';
import { tech, THRESH } from '../tokens';

const W = 422, H = 173;
const SPAN = 240, PX = 2, STEP = 2; // offscreen: 240 m square, 2 px per metre, map sampled every 2 m
const SCALE = 2.0;                   // minimap px per metre (211 m across)

export function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const zone = useUi((s) => s.snap?.zone);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    const off = document.createElement('canvas');
    off.width = off.height = SPAN * PX;
    const og = off.getContext('2d')!;
    let key = '', cx = 0, cy = 0, raf = 0, last = 0;
    const paintOff = (x0: number, y0: number) => {
      og.clearRect(0, 0, off.width, off.height);
      const N = SPAN / STEP;
      const img = og.createImageData(N, N);
      const wifi = hex(tech.wifi), cell = hex(tech.cell);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const p: Vec2 = [x0 - SPAN / 2 + (i + 0.5) * STEP, y0 + SPAN / 2 - (j + 0.5) * STEP];
        const w = driver.sim.wifiCoverage(p, 'belief').dbm;
        const k = 4 * (j * N + i);
        let a = 0, col = wifi;
        if (w > -85) { a = 40 + 150 * clamp01((w + 85) / 35); if (w > THRESH.wifiVoice) a += 40; }
        else { const ce = driver.sim.cellCoverage(p, 'belief').dbm; if (ce > THRESH.cellEdge) { col = cell; a = 45; } }
        img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = a;
      }
      const tmp = document.createElement('canvas');
      tmp.width = tmp.height = N;
      tmp.getContext('2d')!.putImageData(img, 0, 0);
      og.imageSmoothingEnabled = true;
      og.drawImage(tmp, 0, 0, SPAN * PX, SPAN * PX);
      // buildings and walls
      og.strokeStyle = 'rgba(242,244,247,0.55)'; og.lineWidth = 1.5;
      const tx = (p: Vec2): [number, number] => [(p[0] - (x0 - SPAN / 2)) * PX, ((y0 + SPAN / 2) - p[1]) * PX];
      for (const b of LAYOUT.buildings) {
        og.beginPath();
        (b.poly as Vec2[]).forEach((p, i) => { const [x, y] = tx(p); if (i) og.lineTo(x, y); else og.moveTo(x, y); });
        og.closePath();
        og.fillStyle = b.kind === 'block' ? 'rgba(160,170,185,0.22)' : 'rgba(0,0,0,0)';
        og.fill(); og.stroke();
      }
      og.strokeStyle = 'rgba(242,244,247,0.35)'; og.lineWidth = 1;
      for (const wl of LAYOUT.walls) { if (wl.door) continue; const [ax, ay] = tx(wl.a as Vec2), [bx, by] = tx(wl.b as Vec2); og.beginPath(); og.moveTo(ax, ay); og.lineTo(bx, by); og.stroke(); }
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 66) return; // 15 Hz is plenty
      last = now;
      const s = driver.snap;
      const [px, py] = s.player.pos;
      const k = `${Math.round(px / 20)},${Math.round(py / 20)},${driver.sim.mapsVersion},${s.lab.mapStaleness},${driver.sim.scenario}`;
      if (k !== key) { key = k; cx = Math.round(px / 20) * 20; cy = Math.round(py / 20) * 20; paintOff(cx, cy); }
      const yaw = driver.cameraYaw;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, H);
      g.fillStyle = 'rgba(8,10,14,0.55)'; g.fillRect(0, 0, W, H);
      g.save();
      g.translate(W / 2, H * 0.62);
      g.rotate(-yaw);
      const sc = SCALE / PX;
      g.scale(sc, sc);
      // offscreen pixel of the player
      g.drawImage(off, -(px - (cx - SPAN / 2)) * PX, -((cy + SPAN / 2) - py) * PX);
      // predicted edge: forecast path and the edge point (only what Infinet itself predicts)
      const inf = s.infinet;
      if (inf.forecast.length > 1 && inf.ttlS !== undefined && inf.ttlS < 10) {
        g.setLineDash([6, 5]); g.strokeStyle = tech.check; g.lineWidth = 3 / sc;
        g.beginPath();
        inf.forecast.forEach((p, i) => { const x = (p[0] - px) * PX, y = (py - p[1]) * PX; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        g.stroke(); g.setLineDash([]);
        if (inf.edgePoint) { g.fillStyle = tech.check; g.beginPath(); g.arc((inf.edgePoint[0] - px) * PX, (py - inf.edgePoint[1]) * PX, 5 / sc, 0, Math.PI * 2); g.fill(); }
      }
      g.restore();
      // you: an arrow pointing up (the camera's direction), turned by your heading relative to it
      const rel = (s.player.headingDeg * Math.PI) / 180 - yaw;
      g.save(); g.translate(W / 2, H * 0.62); g.rotate(rel);
      g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -9); g.lineTo(6.5, 7); g.lineTo(0, 3.5); g.lineTo(-6.5, 7); g.closePath(); g.stroke(); g.fill();
      g.restore();
      // north tick
      g.save(); g.translate(W - 22, H - 22); g.rotate(-yaw);
      g.fillStyle = 'rgba(242,244,247,0.8)'; g.font = '600 12px JetBrains Mono'; g.textAlign = 'center'; g.fillText('N', 0, -6);
      g.beginPath(); g.moveTo(0, -2); g.lineTo(3, 6); g.lineTo(-3, 6); g.fill();
      g.restore();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [zone]);
  return (
    <div className="minimap glass">
      <canvas ref={ref} width={W} height={H} />
      <div className="cap">INFINET MAP · WHAT THE PHONE KNOWS</div>
    </div>
  );
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
function hex(h: string): [number, number, number] { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
