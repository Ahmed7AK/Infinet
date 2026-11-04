/**
 * Coverage cells: one InstancedMesh of 0.84 m squares on the 1 m grid, colour per instance from the fixed
 * signal bins (style guide p. 22). Orange only in the edge band; weaker cells are not drawn.
 *
 *  belief (default) — Infinet's coverage map: what the product knows (no attacker in it).
 *  truth  (N)       — Simulation view: the simulated true signal, attacker's copy included.
 *  error  (Shift+N) — Simulation view: map minus truth, |dB| binned.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { driver, useUi } from '../driver';
import { binColor, color, EDGE_FLOOR_DBM } from '../tokens';

const HALF = 60;               // cells drawn in a 120 m × 120 m window around you
const N = (2 * HALF) * (2 * HALF);
const ERR_BINS: Array<[number, string]> = [[10, color.orange], [6, color.violet], [3, '#3C0D85'], [0, '#1E1F33']];

export function Coverage() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const key = useRef('');
  const view = useUi((s) => s.view);
  const geo = useMemo(() => { const g = new THREE.PlaneGeometry(0.84, 0.84); g.rotateX(-Math.PI / 2); return g; }, []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff' }), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), c: new THREE.Color(), zero: new THREE.Matrix4().makeScale(0, 0, 0) }), []);

  useFrame(() => {
    const im = mesh.current;
    if (!im) return;
    const s = driver.snap;
    const [px, py] = s.player.pos;
    const cx = Math.round(px / 6) * 6, cy = Math.round(py / 6) * 6;
    const k = `${cx},${cy},${view},${driver.sim.mapsVersion},${s.truth.attackerOn},${s.lab.attackerOffsetDb},${driver.sim.seed},${driver.sim.scenario}`;
    if (k === key.current) return;
    key.current = k;
    let i = 0;
    for (let gx = -HALF; gx < HALF; gx++) {
      for (let gy = -HALF; gy < HALF; gy++) {
        const x = cx + gx + 0.5, y = cy + gy + 0.5;
        let col: string | null = null;
        if (view === 'error') {
          const b = driver.sim.wifiCoverage([x, y], 'belief');
          const t = driver.sim.wifiCoverage([x, y], 'truth');
          if (Math.max(b.dbm, t.dbm) >= EDGE_FLOOR_DBM && b.txId) {
            const e = Math.abs(b.dbm - t.dbm);
            for (const [lo, c] of ERR_BINS) if (e >= lo) { col = c; break; }
          }
        } else {
          const r = driver.sim.wifiCoverage([x, y], view);
          if (r.dbm >= EDGE_FLOOR_DBM) col = binColor(r.dbm);
        }
        if (col) {
          tmp.m.makeTranslation(x, 0.03, -y);
          im.setMatrixAt(i, tmp.m);
          im.setColorAt(i, tmp.c.set(col));
        } else im.setMatrixAt(i, tmp.zero);
        i++;
      }
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geo, mat, N]} frustumCulled={false} />;
}
