/**
 * In-world HTML labels in ONE DOM layer over the canvas (like CSS2DRenderer). Items are rebuilt from the
 * snapshot at the HUD rate; positions are projected every animation frame with the live camera.
 * Replaces drei <Html>, whose per-label React roots threw on unmount under React 19 at the booth.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useUi } from '../driver';
import { worldLabels } from './Networks';

export type V3 = [number, number, number];
export interface LabelItem { key: string; pos: V3 | (() => V3); z?: number; node: ReactNode; /** cards: placed beside the point, kept inside the clear world area between the panels */ card?: 'left' | 'below-left' }

export const camRef: { cam: THREE.Camera | null; w: number; h: number } = { cam: null, w: 1, h: 1 };

/** inside <Canvas>: publish the camera and the canvas size for the label layer */
export function CamExport() {
  const { camera, size } = useThree();
  useFrame(() => { camRef.cam = camera; camRef.w = size.width; camRef.h = size.height; });
  return null;
}

export function LabelLayer() {
  const snap = useUi((s) => s.snap);
  const view = useUi((s) => s.view);
  const items = useMemo(() => (snap ? worldLabels(snap, view) : []), [snap, view]);
  const els = useRef(new Map<string, HTMLDivElement>());
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    let raf = 0;
    const v = new THREE.Vector3();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cam = camRef.cam;
      if (!cam) return;
      const k = Number(document.documentElement.style.getPropertyValue('--hs')) || 1;
      for (const it of itemsRef.current) {
        const el = els.current.get(it.key);
        if (!el) continue;
        const p = typeof it.pos === 'function' ? it.pos() : it.pos;
        v.set(p[0], p[1], p[2]).project(cam);
        const behind = v.z > 1 || v.z < -1;
        const x = (v.x * 0.5 + 0.5) * camRef.w, y = (-v.y * 0.5 + 0.5) * camRef.h;
        const off = behind || x < -600 || x > camRef.w + 600 || y < -400 || y > camRef.h + 400;
        el.style.display = off ? 'none' : '';
        if (off) continue;
        let px = x, py = y;
        if (it.card) {
          const w = el.offsetWidth * k, h = el.offsetHeight * k;
          if (it.card === 'left') { px = x - w - 24 * k; py = y - h * 0.9; } else { px = x - w - 24 * k; py = y + 16 * k; }
          const safeL = (48 + 420 + 16) * k, safeR = camRef.w - (48 + 420 + 16) * k;
          const safeT = 130 * k, safeB = camRef.h - (48 + 140 + 70) * k;
          px = Math.min(Math.max(px, safeL), safeR - w);
          py = Math.min(Math.max(py, safeT), safeB - h);
        }
        el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) scale(${k})`;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="labels">
      {items.map((it) => (
        <div
          key={it.key}
          className="lbl"
          style={{ zIndex: it.z ?? 1, display: 'none' }}
          ref={(el) => { if (el) els.current.set(it.key, el); else els.current.delete(it.key); }}
        >
          {it.node}
        </div>
      ))}
    </div>
  );
}
