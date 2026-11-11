/**
 * Background people for the four places added on 11 Nov (ambience only: the engine never sees them). Positions are
 * written in each area's own frame and moved to the engine frame here, like the geometry in world/areas.ts.
 */
import { AREA_ORIGIN, type AreaId, type Vec2 } from '../../../engine/index';
import type { Npc } from '../Character';

type Local = Omit<Npc, 'at' | 'walk'> & { at: Vec2; walk?: Omit<NonNullable<Npc['walk']>, 'path'> & { path: Vec2[] } };

function place(id: AreaId, list: Local[]): Npc[] {
  const [ox, oy] = AREA_ORIGIN[id];
  const p = (q: Vec2): Vec2 => [ox + q[0], oy + q[1]];
  return list.map((n) => ({ ...n, at: p(n.at), walk: n.walk ? { ...n.walk, path: n.walk.path.map(p) } : undefined }));
}
/** half of an ellipse as a walking path (people walk to the end and back) */
const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 14): Vec2[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as Vec2; });

export const AREA_NPCS: Record<AreaId, Npc[]> = {
  park: place('park', [
    // the promenade and the jogging loop
    { who: 'street_f1', at: [-1.6, -30], face: 0, act: 'idle', walk: { path: [[-1.6, -64], [-1.6, 16]], speed: 1.15 } },
    { who: 'street_m2', at: [1.8, 0], face: 180, act: 'idle', walk: { path: [[1.8, 18], [1.8, -66]], speed: 0.8, gait: 'stroll' } },
    { who: 'street_m1', at: [68, 5], face: 0, act: 'idle', walk: { path: arc(0, 5, 68, 60, -0.9, 2.3), speed: 1.6 } },
    { who: 'street_f3', at: [-68, 5], face: 0, act: 'idle', walk: { path: arc(0, 5, 68, 60, 2.6, 5.2), speed: 1.4 } },
    { who: 'office_f2', at: [30, 44], face: 0, act: 'idle', walk: { path: arc(0, 44, 29.6, 18.6, -0.4, 2.2, 10), speed: 0.75, gait: 'stroll', pause: 5 } },
    // the plaza, the kiosk, the picnic lawn, the gazebo
    { who: 'cafe_f1', at: [-3.2, 26], face: 100, act: 'talk' },
    { who: 'cafe_m1', at: [-1.9, 25.7], face: 280, act: 'listen' },
    { who: 'street_m4', at: [5.2, 30.6], face: 20, act: 'look' },
    { who: 'barista', at: [9.1, -47.5], face: 270, act: 'work' },
    { who: 'cafe_f3', at: [7.8, -47.2], face: 90, act: 'wait' },
    { who: 'cafe_m2', at: [7.1, -46.0], face: 110, act: 'text' },
    { who: 'gardener', at: [-22, -9], face: 200, act: 'crouch' },
    { who: 'street_f4', at: [-55.2, -15.2], face: 120, act: 'talk' },
    { who: 'street_m5', at: [-54.2, -16.6], face: 320, act: 'drink' },
    { who: 'office_m3', at: [-39.4, -40.6], face: 60, act: 'text' },
    { who: 'street_f5', at: [42.6, -20.6], face: 200, act: 'look' },
    { who: 'cafe_f4', at: [-4.3, -26], face: 90, act: 'sit' },
  ]),
  downtown: place('downtown', [
    // strollers on the promenade, both ways; a few at the railing looking at the water
    { who: 'street_f2', at: [-100, 0.6], face: 90, act: 'idle', walk: { path: [[-132, 0.6], [132, 0.6]], speed: 1.1 } },
    { who: 'office_m1', at: [80, -2.4], face: 270, act: 'idle', walk: { path: [[134, -2.4], [-134, -2.4]], speed: 1.3 } },
    { who: 'street_m3', at: [-20, 1.8], face: 90, act: 'idle', walk: { path: [[-60, 1.8], [50, 1.8]], speed: 0.75, gait: 'stroll', pause: 6 } },
    { who: 'cafe_f2', at: [20, -4.6], face: 270, act: 'idle', walk: { path: [[110, -4.6], [-90, -4.6]], speed: 0.9, gait: 'stroll' } },
    { who: 'office_f4', at: [-40, -3.4], face: 90, act: 'idle', walk: { path: [[-120, -3.4], [-10, -3.4]], speed: 1.2, pause: 3 } },
    { who: 'street_m1', at: [12, 7.8], face: 0, act: 'look' },
    { who: 'street_f1', at: [13.2, 7.7], face: 350, act: 'text' },
    { who: 'cafe_m3', at: [-52, 7.8], face: 10, act: 'call' },
    { who: 'office_f1', at: [84, 7.7], face: 0, act: 'talk' },
    { who: 'office_m2', at: [85.2, 7.5], face: 320, act: 'listen' },
    // the pier's deck and the arcade
    { who: 'street_f5', at: [54, 66.6], face: 0, act: 'look' },
    { who: 'cafe_m4', at: [66, 65.8], face: 340, act: 'text' },
    { who: 'guard', at: [-44, -8], face: 0, act: 'wait' },
    { who: 'office_m5', at: [-14, -7.2], face: 180, act: 'look' },
    { who: 'cafe_f1', at: [45, -7.4], face: 60, act: 'talk' },
    { who: 'office_f3', at: [46.2, -6.8], face: 240, act: 'drink' },
  ]),
  metro: place('metro', [
    // the forecourt: people coming and going, the bus stop
    { who: 'street_m2', at: [-1.4, -20], face: 0, act: 'idle', walk: { path: [[-1.4, -40], [-1.4, 13.5]], speed: 1.3, pause: 3 } },
    { who: 'office_f2', at: [1.6, -5], face: 180, act: 'idle', walk: { path: [[1.6, 13], [1.6, -40], [30, -41.5]], speed: 1.2, pause: 4 } },
    { who: 'street_f3', at: [-30, -18], face: 90, act: 'idle', walk: { path: [[-60, -18], [-6, -14], [-2.5, 6]], speed: 1.0, gait: 'stroll', pause: 5 } },
    { who: 'street_m4', at: [38.6, -45.6], face: 180, act: 'wait' },
    { who: 'street_f4', at: [41.4, -45.8], face: 200, act: 'text' },
    { who: 'cafe_m2', at: [-30, -8], face: 90, act: 'sit' },
    { who: 'office_m4', at: [12, -2], face: 300, act: 'call' },
    // the concourse: at the machines, the help desk, the gates
    { who: 'office_f5', at: [-20.4, 11.9], face: 180, act: 'work_mid' },
    { who: 'cafe_f4', at: [20.4, 11.9], face: 180, act: 'work_mid' },
    { who: 'street_m5', at: [22.4, 12.6], face: 200, act: 'wait' },
    { who: 'guard', at: [-34, 14.2], face: 170, act: 'idle' },
    { who: 'office_m6', at: [8.4, 15], face: 30, act: 'look' },
    // the platform: waiting at the screen doors
    { who: 'street_f1', at: [-8, 24.2], face: 0, act: 'wait' },
    { who: 'office_m1', at: [-6.6, 24.4], face: 0, act: 'text' },
    { who: 'cafe_f2', at: [14, 24.3], face: 0, act: 'look' },
    { who: 'street_m3', at: [29, 24.2], face: 350, act: 'call' },
    { who: 'office_f1', at: [-40, 20.2], face: 0, act: 'sit' },
    { who: 'cafe_m1', at: [-22, 22], face: 90, act: 'idle', walk: { path: [[-50, 22], [48, 22]], speed: 1.0, pause: 6 } },
    { who: 'street_f5', at: [-24, 38], face: 180, act: 'wait' },
    { who: 'site_m2', at: [26, 37.6], face: 180, act: 'text' },
  ]),
  souk: place('souk', [
    // shoppers in the two alleys
    { who: 'street_f2', at: [-0.9, -20], face: 0, act: 'idle', walk: { path: [[-0.9, -58], [-0.9, 38]], speed: 0.8, gait: 'stroll', pause: 4 } },
    { who: 'cafe_m3', at: [1.0, 10], face: 180, act: 'idle', walk: { path: [[1.0, 40], [1.0, -56]], speed: 1.05 } },
    { who: 'office_f3', at: [-12, 0.7], face: 90, act: 'idle', walk: { path: [[-29, 0.7], [29, 0.7]], speed: 0.8, gait: 'stroll', pause: 5 } },
    { who: 'street_m1', at: [10, -0.8], face: 270, act: 'idle', walk: { path: [[28, -0.8], [0.6, -0.8], [0.6, 40]], speed: 1.1, pause: 3 } },
    // shopkeepers and customers at the stalls
    { who: 'cafe_m4', at: [-1.5, -40.2], face: 90, act: 'talk' },
    { who: 'street_f4', at: [-0.2, -40], face: 270, act: 'listen' },
    { who: 'site_m3', at: [1.5, -17.2], face: 270, act: 'work_mid' },
    { who: 'cafe_f1', at: [0.3, -27.5], face: 250, act: 'look' },
    { who: 'gardener', at: [-1.6, 22.6], face: 90, act: 'crouch' },
    { who: 'office_m3', at: [-1.4, 12], face: 120, act: 'drink' },
    { who: 'street_m4', at: [-17, 1.6], face: 180, act: 'wait' },
    { who: 'cafe_f3', at: [16.5, -1.5], face: 10, act: 'text' },
    // the one with the bag: the look-alike hotspot sits beside them
    { who: 'site_m4', at: [23.1, -1.6], face: 300, act: 'text' },
    // the quay
    { who: 'street_f5', at: [-8, 48.9], face: 0, act: 'sit' },
    { who: 'street_m5', at: [4, 49], face: 0, act: 'look' },
    { who: 'office_f4', at: [-20, 46], face: 90, act: 'idle', walk: { path: [[-30, 46], [30, 46]], speed: 0.8, gait: 'stroll', pause: 6 } },
    { who: 'cafe_m1', at: [12, 44.4], face: 180, act: 'talk' },
    { who: 'cafe_f2', at: [13, 45.4], face: 340, act: 'listen' },
  ]),
};
