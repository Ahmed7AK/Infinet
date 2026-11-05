/**
 * Shared, per-frame state between the background people and the traffic (scene only; the engine never sees it).
 * People on or about to step onto the road register here so cars brake for them; the traffic says when the
 * zebra crossing is safe to start across.
 */
import type { Vec2 } from '../../engine/index';

/** the zebra crossing at the café (engine coords): it spans the road at y −130 … −126 */
export const CROSSING = { y: -128, half: 2, x0: 8, x1: 24 };

export const crowd = {
  /** people on the carriageway right now (id → position) */
  onRoad: new Map<string, Vec2>(),
  /** someone is waiting at the kerb to cross */
  request: false,
  /** set by the traffic each frame: every car near the crossing has stopped or is far enough away */
  crossingClear: false,
};
