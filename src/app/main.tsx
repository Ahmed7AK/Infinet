import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { driver, useUi, type Playable, type ViewMode } from './driver';
import { SCENARIOS } from '../engine/index';
import { visionK } from './scene/vision';
import { startLive } from './live';

// Booth hardening (plan §17): on an uncaught error, reload and resume the last scene (kept in sessionStorage).
if (import.meta.env.PROD) {
  let reloading = false;
  const reload = () => { if (!reloading) { reloading = true; setTimeout(() => location.reload(), 1500); } };
  addEventListener('error', reload);
  addEventListener('unhandledrejection', reload);
}

createRoot(document.getElementById('root')!).render(<App />);

// Debug / recording hooks: ?scene=cafe-twin&t=25&vision=1&view=truth&app=4&baseline=b2
(window as any).__infinet = { driver, useUi };
const q = new URLSearchParams(location.search);
// live hotspot scanner (Security spec §6): ?live=1&token=… when the Infinet Scanner app serves this page
startLive(q);
const sc = q.get('scene') as Playable | null;
if (sc && SCENARIOS[sc]) {
  driver.load(sc, false);
  if (q.get('stale')) driver.setLab({ mapStaleness: Number(q.get('stale')) });
  if (q.get('baseline')) driver.setLab({ baseline: q.get('baseline') as 'b1' | 'b2' | 'b3' });
  // Lab attacks for recording/rehearsal: ?attack=beacon,uplink,site
  for (const a of (q.get('attack') ?? '').split(',')) {
    if (a === 'beacon') driver.setLab({ beaconFlood: true });
    if (a === 'uplink') driver.setLab({ uplinkFlood: true });
    if (a === 'site') driver.setLab({ siteTwin: true });
  }
  if (q.get('t')) driver.fastForward(Number(q.get('t')));
  if (q.get('view')) useUi.setState({ view: q.get('view') as ViewMode });
  if (q.get('vision')) { useUi.setState({ vision: true }); visionK.v = 1; }
  if (q.get('app')) useUi.setState({ phoneUp: true, app: q.get('app') === 'home' ? null : Number(q.get('app')) });
  if (q.get('pause')) (window as any).__infinetPaused = true;
  if (q.get('cam')) (window as any).__infinetCam = q.get('cam')!.split(',').map(Number);
}
