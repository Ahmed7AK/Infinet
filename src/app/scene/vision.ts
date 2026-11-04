/** Network Vision state shared by the renderer, the grade and the network layer (plan §4.2, §7.3). */
/** blend 0..1, eased over about 600 ms (World.tsx drives it) */
export const visionK = { v: 0 };
/** three.js layer that holds the network layer, so the Vision grade can leave it in colour */
export const NET_LAYER = 2;
/** objects the camera may pass through (palm crowns): hidden while the camera is inside or right next to them */
export const camOccluders = new Set<{ obj: { visible: boolean }; x: number; y: number; z: number; r: number; /** vertical pole of this height from y instead of a sphere */ h?: number }>();
