/**
 * First-load screen. Over the web the models, people and textures take a while to arrive, and until they do the
 * 3D view is black. This covers the scene with a progress bar (files loaded of files queued, from three.js's
 * loading manager via drei's useProgress) and holds the simulation clock, so the scripted scenes start when the
 * world is on screen, not part-way through. At the booth (local disk) it shows for about a second.
 */
import { useProgress } from '@react-three/drei';
import { useEffect, useRef, useState } from 'react';
import { driver } from '../driver';

/** set once the scene inside <Suspense> has mounted (its models have resolved) */
export const sceneState = { mounted: false };
export function SceneMounted() {
  useEffect(() => { sceneState.mounted = true; }, []);
  return null;
}

const POLL_MS = 250;
const SETTLE_POLLS = 3; // nothing loading for 0.75 s: textures queue only after the models resolve, so wait out the gap
const GIVE_UP_MS = 180_000; // never keep the booth on a loading screen: show the world after 3 min whatever happened

export function Loader() {
  const { loaded, total, errors } = useProgress();
  const [phase, setPhase] = useState<'loading' | 'fading' | 'done'>('loading');
  const best = useRef(0);
  useEffect(() => {
    const t0 = performance.now();
    let settled = 0;
    const id = setInterval(() => {
      const p = useProgress.getState();
      const idle = !p.active && p.total > 0 && p.loaded >= p.total;
      settled = idle && sceneState.mounted ? settled + 1 : 0;
      if (settled >= SETTLE_POLLS || performance.now() - t0 > GIVE_UP_MS) {
        clearInterval(id);
        driver.release();
        setPhase('fading');
        setTimeout(() => setPhase('done'), 700);
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);
  if (phase === 'done') return null;
  // the queue grows as the scene mounts, so the raw fraction can step back: show the best so far
  const frac = total > 0 ? loaded / total : 0;
  best.current = Math.max(best.current, phase === 'fading' ? 1 : Math.min(frac, 0.99));
  const pct = Math.round(best.current * 100);
  return (
    <div className="loader" style={{ opacity: phase === 'fading' ? 0 : 1 }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Loading the simulation">
      <div className="loader-card">
        <div className="loader-k">Loading the simulation</div>
        <div className="loader-bar"><div style={{ width: `${pct}%` }} /></div>
        <div className="loader-row">
          <span className="num">{pct} %</span>
          <span className="num">{loaded} of {total} assets{errors.length ? ` · ${errors.length} failed` : ''}</span>
        </div>
        <p className="loader-p">The first visit downloads every model, person and texture. Later visits are quicker.</p>
        <p className="loader-keys"><b>WASD</b> walk · <b>drag</b> look · <b>N</b> Network Vision · <b>1 2 3</b> jump to a scene · <b>M</b> skip to the moment · <b>T</b> tour · <b>↑</b> phone</p>
      </div>
    </div>
  );
}
