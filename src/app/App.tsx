import { useEffect } from 'react';
import { CREDITS_APP, driver, NOTES_APP, SCENE_ORDER, useUi, type Playable } from './driver';
import { World } from './scene/World';
import { LabelLayer } from './scene/labels';
import { Hud, useStageScale } from './ui/Hud';
import { APPS, LAB, Phone } from './phone/Phone';
import { Loader } from './ui/Loader';

/** 1 … 8 jump to the scenes in the order of the chips under the title */
const TRAVEL: Record<string, Playable> = Object.fromEntries(SCENE_ORDER.map((s, i) => [`Digit${i + 1}`, s]));

function onKeyDown(e: KeyboardEvent) {
  if (e.repeat && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) { if (/^Key[WASD]$/.test(e.code)) return; }
  if (driver.input()) { e.preventDefault(); return; }
  const ui = useUi.getState();
  const set = useUi.setState;
  const c = e.code;
  if (/^Key[WASD]$/.test(c) || c.startsWith('Shift')) { driver.keys.add(c); }
  // N: Network Vision on/off · Shift+N (in Vision): Infinet's map → true signal → map error
  if (c === 'KeyN' && !e.repeat) {
    if (e.shiftKey) set({ vision: true, view: ui.vision ? (ui.view === 'belief' ? 'truth' : ui.view === 'truth' ? 'error' : 'belief') : ui.view });
    else set({ vision: !ui.vision });
  }
  if (c === 'KeyC' && !e.repeat) driver.cycleBaseline();
  if (c === 'KeyB') set({ holdB: true });
  if (c === 'Space') { e.preventDefault(); set({ slow: true }); }
  if (TRAVEL[c] && !e.repeat) driver.travel(TRAVEL[c], 'free');
  if (c === 'KeyT' && !e.repeat) driver.startTour();
  if (c === 'KeyH' && !e.repeat) set({ help: !ui.help });
  if (c === 'F9') { e.preventDefault(); driver.reset(); }
  if (c === 'F10') { e.preventDefault(); set({ perf: !ui.perf }); }

  // phone
  if (c === 'KeyM' && !e.repeat) driver.skipToMoment();
  if (c === 'KeyL' && !e.repeat) driver.signIn();
  const arrows: Record<string, number> = { ArrowUp: -3, ArrowDown: 3, ArrowLeft: -1, ArrowRight: 1 };
  if (c in arrows || c === 'Enter' || ((c === 'Backspace' || c === 'Escape') && ui.phoneUp)) driver.touchPhone();
  if (c in arrows) {
    e.preventDefault();
    if (!ui.phoneUp) { if (c === 'ArrowUp') set({ phoneUp: true, unread: 0 }); return; }
    if (ui.app === null) set({ sel: (ui.sel + arrows[c] + APPS.length) % APPS.length });
    else if (ui.app === 5 && ui.snap) {
      if (c === 'ArrowUp' || c === 'ArrowDown') set({ labSel: (ui.labSel + (c === 'ArrowUp' ? -1 : 1) + LAB.length) % LAB.length });
      else LAB[ui.labSel].change?.(c === 'ArrowLeft' ? -1 : 1, ui.snap);
    }
  }
  if (c === 'Enter' && ui.phoneUp) {
    if (ui.app === null) set({ app: ui.sel });
    else if (ui.app === 5 && ui.snap) { const ctl = LAB[ui.labSel]; (ctl.press ?? ((s) => ctl.change?.(1, s)))(ui.snap); }
  }
  if ((c === 'Backspace' || c === 'Escape') && ui.phoneUp) {
    e.preventDefault();
    if (ui.app === NOTES_APP || ui.app === CREDITS_APP) set({ app: 5 });
    else if (ui.app !== null) set({ app: null });
    else set({ phoneUp: false });
  }
  if (c === 'Escape' && ui.help) set({ help: false });
}

function onKeyUp(e: KeyboardEvent) {
  driver.keys.delete(e.code);
  if (e.code === 'Space') useUi.setState({ slow: false });
  if (e.code === 'KeyB') useUi.setState({ holdB: false });
}

export function App() {
  const { k, w } = useStageScale();
  const fading = useUi((s) => s.fading);
  useEffect(() => {
    const down = (e: KeyboardEvent) => onKeyDown(e);
    const blur = () => { driver.keys.clear(); useUi.setState({ slow: false, holdB: false }); };
    const any = () => driver.input();
    addEventListener('keydown', down);
    addEventListener('keyup', onKeyUp);
    addEventListener('blur', blur);
    addEventListener('pointerdown', any);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', onKeyUp); removeEventListener('blur', blur); removeEventListener('pointerdown', any); };
  }, []);
  return (
    <>
      <div className="canvas-wrap"><World /></div>
      <LabelLayer />
      <div className="stage" style={{ width: w, transform: `scale(${k})` }}>
        <Hud />
        <Phone />
      </div>
      <Loader />
      <div className="fade" style={{ opacity: fading ? 1 : 0 }} />
    </>
  );
}
