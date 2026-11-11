/**
 * Four more places to explore (11 Nov): a park, Downtown by the tower, a metro station and the old souk.
 * Each is its own chunk far from the city (like the desert site), with a different form of network:
 *
 *   park      public mesh Wi-Fi on solar "Wi-Fi palms" (Enhanced Open, 2.4 GHz, wireless backhaul) · 4G macro
 *   downtown  Passpoint Wi-Fi (WPA3-Enterprise, certificate profile, six APs) · 5G small cells on lamp posts
 *   metro     station Wi-Fi with a sign-in page · indoor antennas (DAS) under a metal shell that blocks the mast
 *   souk      old shop routers (WPA-TKIP, WEP, WPA2/3 transition), one sound public Wi-Fi and a look-alike · 4G
 *
 * One geometry for the radio model and the renderer (plan D9): everything here is in metres, in each area's own
 * frame (x east, y north, origin at the area's centre); `AREAS` is the same data moved to the engine frame, and
 * world/layout.ts appends it to the shared layout. The renderer (src/app/scene/areas/) draws from the local
 * frame inside a group at the area's origin.
 *
 * ASSUMPTIONS (also in the phone's Sim notes): Wi-Fi palms at 17 dBm EIRP (solar powered); the promenade's access
 * points lose signal with distance at n = 2.8 (open air, mostly line of sight; the default 3.2 is for offices); small
 * cells 20 dB and indoor antennas 32 dB below the macro's power per resource element; the mesh hop adds 6 ms. The places are
 * generic: no operator, mall or shop is named.
 */
import type { Scenario } from '../scenario/scenarios';
import type { Vec2, Vec3, ZoneId } from '../types';
import type { Building, Region, Transmitter, Wall, Zone } from './layout';

export type AreaId = 'park' | 'downtown' | 'metro' | 'souk';

/** where each area sits in the engine frame (west of the city; the desert and the hall are to the east) */
export const AREA_ORIGIN: Record<AreaId, Vec2> = {
  park: [-20000, 0],
  downtown: [-24000, 0],
  metro: [-28000, 0],
  souk: [-32000, 0],
};

// ───────────── local-frame helpers ─────────────
type LWall = Omit<Wall, 'zone'>;
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** the closed outline of a polygon as walls */
function ring(poly: Vec2[], h: number, material: string, extra: Partial<LWall> = {}): LWall[] {
  return poly.map((a, i) => ({ a, b: poly[(i + 1) % poly.length], h, material, ...extra }));
}
/** a straight wall a→b with openings (metres along it) */
function gapped(a: Vec2, b: Vec2, gaps: Array<[number, number]>, h: number, material: string, extra: Partial<LWall> = {}): LWall[] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const at = (d: number): Vec2 => [a[0] + ((b[0] - a[0]) * d) / L, a[1] + ((b[1] - a[1]) * d) / L];
  const out: LWall[] = [];
  let from = 0;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g0 > from) out.push({ a: at(from), b: at(g0), h, material, ...extra });
    from = g1;
  }
  if (from < L) out.push({ a: at(from), b: at(L), h, material, ...extra });
  return out;
}
const ellipse = (cx: number, cy: number, rx: number, ry: number, n: number): Vec2[] =>
  Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * 2 * Math.PI) * rx, cy + Math.sin((i / n) * 2 * Math.PI) * ry] as Vec2);
/** people and the camera stop here; radio passes (a fence, a railing, a hedge) */
const SOFT = { rfIgnore: true } as const;

// ───────────── the park ─────────────
export const PARK = {
  bounds: [[-80, -70], [80, 80]] as [Vec2, Vec2],
  gate: { at: [0, -70] as Vec2, w: 10 },
  /** the central promenade, from the south gate to the pond plaza */
  promenade: { x: 0, y0: -70, y1: 22, w: 6 },
  plaza: { at: [0, 24] as Vec2, r: 9 },
  pond: { at: [0, 44] as Vec2, rx: 26, ry: 15 },
  /** the rubber jogging loop */
  track: { at: [0, 5] as Vec2, rx: 68, ry: 60, w: 3 },
  /** solar Wi-Fi palms: one network, A has the fibre, B and C reach it over a wireless hop */
  palms: [[-6, -38], [48, 66], [-62, -8]] as Vec2[],
  kiosk: { x0: 10, y0: -50, x1: 15, y1: -45, h: 3 },
  sails: { at: [-40, -40] as Vec2 },
  gazebo: { at: [44, -22] as Vec2, r: 4.2 },
  picnic: [[-56, -16], [-66, -2], [-54, 2], [-68, -18]] as Vec2[],
  mast: [300, -260, 30] as Vec3,
};

// ───────────── Downtown: the lakeside promenade, the pier, the tower across the water ─────────────
export const DOWNTOWN = {
  promenade: { x0: -140, x1: 140, y0: -9, y1: 9 },
  /** three podium blocks behind the arcade, with two lanes between them */
  podium: [[-140, -48], [-40, 40], [48, 140]].map(([x0, x1]) => ({ x0, x1, y0: -45, y1: -9, h: 15 })),
  pier: { x0: 56, x1: 64, y0: 9, y1: 52 },
  deck: { x0: 50, x1: 70, y0: 52, y1: 68 },
  /** the lake's outline (the promenade's railing is its south shore) */
  lake: { x0: -260, x1: 260, y0: 9, y1: 330 },
  tower: { at: [0, 560] as Vec2, h: 828 },
  /** Passpoint access points under the arcade */
  aps: [-75, -45, -15, 15, 45, 75].map((x) => [x, -8.6, 4.2] as Vec3),
  /** 5G small cells on smart poles along the railing */
  cells: [-105, -35, 35, 105].map((x) => [x, 7.6, 8] as Vec3),
};

// ───────────── the metro station ─────────────
export const METRO = {
  /** the shell: platforms and concourse under one metal vault */
  station: { x0: -65, x1: 65, y0: 10, y1: 47, h: 16 },
  door: { x0: -4, x1: 4 },
  /** the fare line between the concourse and the platform, and its three lanes */
  gateY: 17.5,
  lanes: [[-5, -3.4], [-0.8, 0.8], [3.4, 5]] as Array<[number, number]>,
  /** platform screen doors along the track */
  psdY: 26,
  tracks: [28.3, 32.7],
  farPlatform: { y0: 35, y1: 43.5 },
  plaza: { x0: -70, x1: 70, y0: -44, y1: 10 },
  aps: [[-10, 14, 4.2], [10, 14, 4.2], [-34, 22, 4.5], [34, 22, 4.5]] as Vec3[],
  das: [[-30, 24, 6], [30, 24, 6]] as Vec3[],
  mast: [280, -240, 30] as Vec3,
};

// ───────────── the old souk ─────────────
export const SOUK = {
  /** four blocks of shops round a crossing of two alleys (5 m wide) */
  blocks: [
    { id: 'sw', x0: -32, y0: -62, x1: -2.5, y1: -2.5, h: 6 },
    { id: 'se', x0: 2.5, y0: -62, x1: 32, y1: -2.5, h: 7 },
    { id: 'nw', x0: -32, y0: 2.5, x1: -2.5, y1: 42, h: 6.5 },
    { id: 'ne', x0: 2.5, y0: 2.5, x1: 32, y1: 42, h: 6 },
  ],
  alley: 2.5,
  /** the creek-side walk and the water beyond it */
  quay: { y0: 42, y1: 50 },
  /** the shops' routers and the public Wi-Fi; the last is the look-alike in someone's bag */
  spice: [-2.3, -40, 2.4] as Vec3,
  textile: [2.3, -18, 2.4] as Vec3,
  guest: [-2.3, 22, 2.4] as Vec3,
  free: [12, 2.3, 3.0] as Vec3,
  rogue: [22, -2.2, 0.9] as Vec3,
  mast: [140, -180, 28] as Vec3,
};

// ───────────── per-area layout (local frame) ─────────────
interface AreaDef {
  id: AreaId;
  label: string;
  /** half-size of the zone box (m) */
  reach: number;
  spawn: { pos: Vec2; headingDeg: number };
  regions: Array<{ id: string; poly: Vec2[] }>;
  buildings: Array<Omit<Building, 'poly'> & { poly: Vec2[] }>;
  walls: LWall[];
  transmitters: Array<Omit<Transmitter, 'grid' | 'zone'> & { grid: { bounds: [Vec2, Vec2]; res: number } }>;
  routes: Record<string, Vec2[]>;
  anchor: Vec2;
  internet: Vec2;
}

const cellA = { kind: 'cell' as const, net: 'cell-a', operator: 'Cellular A' };
/** three sectors, the first turned toward the area's centre from a mast at `pos` */
const facing = (pos: Vec3, downtiltDeg = 4) => {
  const az = Math.round(((Math.atan2(-pos[0], -pos[1]) * 180) / Math.PI + 360) % 360);
  return [0, 120, 240].map((d) => ({ azDeg: (az + d) % 360, downtiltDeg }));
};

const PARK_GRID = { bounds: [[-95, -85], [95, 95]] as [Vec2, Vec2] };
const park: AreaDef = {
  id: 'park', label: 'The park', reach: 400,
  spawn: { pos: [0, -58], headingDeg: 0 },
  regions: [{ id: 'park', poly: rect(-80, -70, 80, 80) }],
  buildings: [{ id: 'park-kiosk', poly: rect(PARK.kiosk.x0, PARK.kiosk.y0, PARK.kiosk.x1, PARK.kiosk.y1), o2i: 'low', kind: 'kiosk', height: PARK.kiosk.h }],
  walls: [
    // the park's hedge and fence, open at the south gate
    ...gapped([-80, -70], [80, -70], [[80 - PARK.gate.w / 2, 80 + PARK.gate.w / 2]], 1.3, 'metal', SOFT),
    ...ring([[80, -70], [80, 80], [-80, 80], [-80, -70]], 1.3, 'metal', SOFT).slice(0, 3),
    ...ring(ellipse(PARK.pond.at[0], PARK.pond.at[1], PARK.pond.rx + 0.5, PARK.pond.ry + 0.5, 20), 0.35, 'concrete', SOFT),
    ...ring(rect(PARK.kiosk.x0, PARK.kiosk.y0, PARK.kiosk.x1, PARK.kiosk.y1), PARK.kiosk.h, 'metal', SOFT),
  ],
  transmitters: [
    ...PARK.palms.map((p, i): AreaDef['transmitters'][number] => ({
      id: `park-palm-${'abc'[i]}`, kind: 'wifi', net: 'park-wifi', ssid: 'Park_Free_WiFi', bssid: `0a:3c:70:00:0${i + 1}:0a`,
      security: 'OWE', pmf: 'required', band: '2.4', channel: [1, 6, 11][i], pos: [p[0], p[1], 4.6], eirpDbm: 17, std: 6, saved: true, title: 'Wi-Fi palm',
      backhaul: i === 0
        ? [{ name: 'Fibre at the palm', owdMs: 2 }]
        : [{ name: 'Wireless mesh hop to the next palm', owdMs: 6, jitterMs: 3, loss: 0.003 }, { name: 'Fibre at that palm', owdMs: 2 }],
      grid: { ...PARK_GRID, res: 1 },
    })),
    { id: 'cellA-park', ...cellA, title: '4G mast', fcGHz: 1.8, model: 'UMa', rat: 'LTE', pos: PARK.mast, sectors: facing(PARK.mast), grid: { bounds: [[-100, -90], [100, 100]], res: 2 } },
  ],
  routes: { 'park-walk': [[0, -58], [0, -20], [1.5, 0], [0, 14]] },
  anchor: [-260, 380], internet: [-300, 300],
};

const D = DOWNTOWN;
const downtown: AreaDef = {
  id: 'downtown', label: 'Downtown', reach: 900,
  spawn: { pos: [30, -1], headingDeg: 90 },
  regions: [
    { id: 'promenade', poly: rect(D.promenade.x0, D.promenade.y0, D.promenade.x1, D.promenade.y1) },
    { id: 'pier', poly: rect(D.pier.x0, D.pier.y0, D.pier.x1, D.deck.y1) },
  ],
  buildings: D.podium.map((b, i) => ({ id: `dt-podium-${i + 1}`, poly: rect(b.x0, b.y0, b.x1, b.y1), o2i: 'low' as const, kind: 'podium', height: b.h })),
  walls: [
    // the arcade's shopfronts, with the two lanes closed by planters
    ...D.podium.map((b): LWall => ({ a: [b.x0, b.y1], b: [b.x1, b.y1], h: b.h, material: 'clear_glass', ...SOFT })),
    { a: [-48, -12], b: [-40, -12], h: 1.0, material: 'concrete', ...SOFT }, { a: [40, -12], b: [48, -12], h: 1.0, material: 'concrete', ...SOFT },
    { a: [-48, -9], b: [-48, -12], h: 15, material: 'concrete', ...SOFT }, { a: [-40, -9], b: [-40, -12], h: 15, material: 'concrete', ...SOFT },
    { a: [40, -9], b: [40, -12], h: 15, material: 'concrete', ...SOFT }, { a: [48, -9], b: [48, -12], h: 15, material: 'concrete', ...SOFT },
    // both ends of the promenade, the lake railing, the pier and its deck
    { a: [D.promenade.x0, -9], b: [D.promenade.x0, 9], h: 1.1, material: 'metal', ...SOFT },
    { a: [D.promenade.x1, -9], b: [D.promenade.x1, 9], h: 1.1, material: 'metal', ...SOFT },
    ...gapped([D.promenade.x0, 9], [D.promenade.x1, 9], [[D.pier.x0 - D.promenade.x0, D.pier.x1 - D.promenade.x0]], 1.1, 'metal', SOFT),
    { a: [D.pier.x0, D.pier.y0], b: [D.pier.x0, D.pier.y1], h: 1.1, material: 'metal', ...SOFT },
    { a: [D.pier.x1, D.pier.y0], b: [D.pier.x1, D.pier.y1], h: 1.1, material: 'metal', ...SOFT },
    { a: [D.deck.x0, D.deck.y0], b: [D.pier.x0, D.deck.y0], h: 1.1, material: 'metal', ...SOFT },
    { a: [D.pier.x1, D.deck.y0], b: [D.deck.x1, D.deck.y0], h: 1.1, material: 'metal', ...SOFT },
    { a: [D.deck.x0, D.deck.y0], b: [D.deck.x0, D.deck.y1], h: 1.1, material: 'metal', ...SOFT },
    { a: [D.deck.x1, D.deck.y0], b: [D.deck.x1, D.deck.y1], h: 1.1, material: 'metal', ...SOFT },
    { a: [D.deck.x0, D.deck.y1], b: [D.deck.x1, D.deck.y1], h: 1.1, material: 'metal', ...SOFT },
  ],
  transmitters: [
    ...D.aps.map((p, i): AreaDef['transmitters'][number] => ({
      id: `dt-ap-${i + 1}`, kind: 'wifi', net: 'boulevard', ssid: 'Boulevard_WiFi', bssid: `02:7b:d0:00:0${i + 1}:01`,
      security: 'WPA3-ENT', pmf: 'required', band: '5', channel: [36, 52, 100, 116, 132, 149][i], pos: p, eirpDbm: 20, plExp: 2.8, std: 6, saved: true, enrolled: true,
      backhaul: [{ name: 'Fibre to the hotspot operator', owdMs: 3 }],
      grid: { bounds: [[-150, -20], [150, 80]], res: 1 },
    })),
    ...D.cells.map((p, i): AreaDef['transmitters'][number] => ({
      id: `dt-sc-${i + 1}`, ...cellA, title: '5G small cell', fcGHz: 3.5, model: 'UMi', pos: p, rsrpOffsetDb: -20,
      sectors: [{ azDeg: 90, downtiltDeg: 6 }, { azDeg: 270, downtiltDeg: 6 }, { azDeg: 0, downtiltDeg: 6 }],
      grid: { bounds: [[-160, -20], [160, 80]], res: 2 },
    })),
  ],
  routes: { 'downtown-walk': [[30, -1], [57, -1], [60, 6], [60, 60]] },
  anchor: [-420, -260], internet: [-360, -200],
};

const M = METRO, ST = METRO.station;
const METRO_GRID = { bounds: [[-75, -50], [75, 50]] as [Vec2, Vec2] };
const metro: AreaDef = {
  id: 'metro', label: 'Metro station', reach: 400,
  spawn: { pos: [0, -16], headingDeg: 0 },
  regions: [
    { id: 'station', poly: rect(ST.x0, ST.y0, ST.x1, ST.y1) },
    { id: 'platform', poly: rect(ST.x0, M.gateY, ST.x1, M.psdY) },
  ],
  buildings: [{ id: 'metro-station', poly: rect(ST.x0, ST.y0, ST.x1, ST.y1), o2i: 'high', kind: 'station', height: ST.h }],
  walls: [
    // the shell: a glass front with the doors, metal on the other three sides
    ...gapped([ST.x0, ST.y0], [ST.x1, ST.y0], [[M.door.x0 - ST.x0, M.door.x1 - ST.x0]], 6, 'clear_glass'),
    { a: [ST.x1, ST.y0], b: [ST.x1, ST.y1], h: 6, material: 'metal' },
    { a: [ST.x1, ST.y1], b: [ST.x0, ST.y1], h: 6, material: 'metal' },
    { a: [ST.x0, ST.y1], b: [ST.x0, ST.y0], h: 6, material: 'metal' },
    // the fare line (glass either side of the gates, the cabinets between the lanes) and the platform screen doors
    ...gapped([ST.x0, M.gateY], [ST.x1, M.gateY], [[-7 - ST.x0, 7 - ST.x0]], 2.2, 'clear_glass', SOFT),
    ...gapped([-7, M.gateY], [7, M.gateY], M.lanes.map(([a, b]) => [a + 7, b + 7] as [number, number]), 1.1, 'metal', SOFT),
    { a: [ST.x0, M.psdY], b: [ST.x1, M.psdY], h: 2.4, material: 'clear_glass', ...SOFT },
    // the forecourt's planters
    { a: [M.plaza.x0, M.plaza.y1], b: [M.plaza.x0, M.plaza.y0], h: 0.9, material: 'concrete', ...SOFT },
    { a: [M.plaza.x0, M.plaza.y0], b: [M.plaza.x1, M.plaza.y0], h: 0.9, material: 'concrete', ...SOFT },
    { a: [M.plaza.x1, M.plaza.y0], b: [M.plaza.x1, M.plaza.y1], h: 0.9, material: 'concrete', ...SOFT },
  ],
  transmitters: [
    ...M.aps.map((p, i): AreaDef['transmitters'][number] => ({
      id: `metro-ap-${i + 1}`, kind: 'wifi', net: 'metro-wifi', ssid: 'Metro_Free_WiFi', bssid: `0e:41:9a:00:0${i + 1}:20`,
      security: 'OPEN', pmf: 'none', band: '5', channel: [36, 44, 149, 157][i], pos: p, eirpDbm: 20, std: 5, saved: true, captivePortal: true, airtimeLoad: true,
      backhaul: [{ name: 'Station fibre', owdMs: 2 }],
      grid: { ...METRO_GRID, res: 1 },
    })),
    ...M.das.map((p, i): AreaDef['transmitters'][number] => ({
      id: `metro-das-${i + 1}`, ...cellA, title: 'Indoor 5G antenna', fcGHz: 3.5, model: 'UMi', pos: p, rsrpOffsetDb: -32, omni: true, indoor: true, sectors: [],
      grid: { ...METRO_GRID, res: 2 },
    })),
    { id: 'cellA-metro', ...cellA, title: '5G mast', fcGHz: 3.5, model: 'UMa', pos: M.mast, sectors: facing(M.mast), grid: { ...METRO_GRID, res: 2 } },
  ],
  routes: { 'metro-station': [[0, -16], [0, 16], [0, 21.5], [34, 21.5]] },
  anchor: [-260, 380], internet: [-300, 300],
};

const S = SOUK;
const SOUK_GRID = { bounds: [[-40, -70], [40, 58]] as [Vec2, Vec2], res: 1 };
const shop = { kind: 'wifi' as const, pmf: 'none' as const, band: '2.4' as const, eirpDbm: 18, std: 4 };
const dsl = [{ name: 'Shop broadband (DSL)', owdMs: 9, jitterMs: 3 }];
const souk: AreaDef = {
  id: 'souk', label: 'Old souk', reach: 300,
  spawn: { pos: [0, -44], headingDeg: 0 },
  regions: [{ id: 'souk', poly: rect(-32, -62, 32, 50) }],
  buildings: S.blocks.map((b) => ({ id: `souk-${b.id}`, poly: rect(b.x0, b.y0, b.x1, b.y1), o2i: 'low' as const, kind: 'souk', height: b.h })),
  walls: [
    // coral-stone and plaster shop walls: these block Wi-Fi round the corners
    ...S.blocks.flatMap((b) => ring(rect(b.x0, b.y0, b.x1, b.y1), b.h, 'brick')),
    // the gate at the south end, the ends of the cross alley, the quay's ends and its railing
    { a: [-S.alley, -62], b: [S.alley, -62], h: 1.0, material: 'wood_door', ...SOFT },
    { a: [-32, -S.alley], b: [-32, S.alley], h: 1.0, material: 'wood_door', ...SOFT },
    { a: [32, -S.alley], b: [32, S.alley], h: 1.0, material: 'wood_door', ...SOFT },
    { a: [-32, S.quay.y0], b: [-32, S.quay.y1], h: 1.0, material: 'wood_door', ...SOFT },
    { a: [32, S.quay.y0], b: [32, S.quay.y1], h: 1.0, material: 'wood_door', ...SOFT },
    { a: [-32, S.quay.y1], b: [32, S.quay.y1], h: 1.0, material: 'metal', ...SOFT },
  ],
  transmitters: [
    { id: 'souk-spice', ...shop, net: 'souk-spice', ssid: 'Spice_Shop', bssid: '00:1d:7e:4c:20:11', security: 'WPA-TKIP', channel: 1, pos: S.spice, saved: true, backhaul: dsl, grid: SOUK_GRID },
    { id: 'souk-textile', ...shop, net: 'souk-textile', ssid: 'Textile_House', bssid: '00:18:39:a1:07:5c', security: 'WEP', channel: 6, pos: S.textile, backhaul: dsl, grid: SOUK_GRID },
    { id: 'souk-guest', ...shop, net: 'souk-guest', ssid: 'Souk_Guest', bssid: '0c:80:63:12:9e:40', security: 'WPA2/3', channel: 11, pos: S.guest, backhaul: dsl, grid: SOUK_GRID },
    { id: 'souk-free', kind: 'wifi', net: 'souk-free', ssid: 'Souk_Free_WiFi', bssid: '0a:55:c2:00:01:30', security: 'WPA2-PSK', pmf: 'optional', band: '5', channel: 44, pos: S.free, eirpDbm: 20, std: 5, saved: true,
      backhaul: [{ name: 'Fibre in the quarter', owdMs: 3 }], grid: SOUK_GRID },
    // the look-alike: "Souk_Free_WiFi" with a Cyrillic о (U+043E). Same to the eye, different bytes
    { id: 'souk-rogue', kind: 'wifi', net: 'rogue-souk', ssid: 'Sоuk_Free_WiFi', bssid: '5a:9e:14:c7:3b:02', security: 'OPEN', pmf: 'none', band: '2.4', channel: 6, pos: S.rogue, eirpDbm: 20,
      attacker: true, rogue: true, grid: SOUK_GRID },
    { id: 'cellA-souk', ...cellA, title: '4G mast', fcGHz: 1.8, model: 'UMa', rat: 'LTE', pos: S.mast, sectors: facing(S.mast), grid: { bounds: SOUK_GRID.bounds, res: 2 } },
  ],
  routes: { 'souk-alley': [[0, -44], [0, 0], [20, 0]] },
  anchor: [-240, 300], internet: [-280, 240],
};

const DEFS: AreaDef[] = [park, downtown, metro, souk];

// ───────────── moved to the engine frame, in the shape world/layout.ts merges ─────────────
export interface AreaLayout {
  zones: Zone[]; regions: Region[]; buildings: Building[]; walls: Wall[]; transmitters: Transmitter[];
  routes: Record<string, Vec2[]>; visual: Record<string, { pos: Vec3; label?: string }>;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export const AREAS: AreaLayout = (() => {
  const out: AreaLayout = { zones: [], regions: [], buildings: [], walls: [], transmitters: [], routes: {}, visual: {} };
  for (const d of DEFS) {
    const [ox, oy] = AREA_ORIGIN[d.id];
    const p = (q: Vec2): Vec2 => [ox + q[0], oy + q[1]];
    const zone = d.id as ZoneId;
    out.zones.push({ id: zone, label: d.label, bounds: [[ox - d.reach, oy - d.reach], [ox + d.reach, oy + d.reach]], spawn: { pos: p(d.spawn.pos), headingDeg: d.spawn.headingDeg } });
    for (const r of d.regions) out.regions.push({ id: r.id, poly: r.poly.map(p) });
    for (const b of d.buildings) out.buildings.push({ ...b, poly: b.poly.map(p) });
    for (const w of d.walls) out.walls.push({ ...w, a: p(w.a), b: p(w.b), zone });
    for (const t of d.transmitters) {
      out.transmitters.push({ ...t, zone, pos: [ox + t.pos[0], oy + t.pos[1], t.pos[2]], grid: { bounds: [p(t.grid.bounds[0]), p(t.grid.bounds[1])], res: t.grid.res } });
    }
    for (const [k, pts] of Object.entries(d.routes)) out.routes[k] = pts.map(p);
    out.visual[`anchor${cap(d.id)}`] = { pos: [ox + d.anchor[0], oy + d.anchor[1], 0], label: 'Anchor server' };
    out.visual[`internet${cap(d.id)}`] = { pos: [ox + d.internet[0], oy + d.internet[1], 0] };
  }
  return out;
})();

export const AREA_IDS = DEFS.map((d) => d.id);
export const isArea = (zone: string): zone is AreaId => (AREA_IDS as string[]).includes(zone);
/** the area whose origin is nearest to an engine-frame x (the areas lie in a row along x) */
export function areaAtX(x: number): AreaId {
  let best: AreaId = 'park', bd = Infinity;
  for (const id of AREA_IDS) { const dd = Math.abs(x - AREA_ORIGIN[id][0]); if (dd < bd) { bd = dd; best = id; } }
  return best;
}

// ───────────── the walks ─────────────
const onCell = { route: 'cell:cell-a', wifi: null, infinetTrusted: ['cell:cell-a'] };
export const AREA_SCENARIOS: Scenario[] = [
  {
    id: 'park-walk', label: 'A walk in the park', proves: 'PUBLIC MESH WI-FI · CHECKED, USED, LEFT IN TIME',
    zone: 'park', route: 'park-walk', durationS: 64, prewarmS: 0, startDelayS: 1, defaultBaseline: 'b1', init: onCell, events: [],
    captions: [
      { at: 0.5, text: "A public park. You're on a call over 4G; the solar Wi-Fi palms here share one free network." },
      { on: 'trust.tunnel', text: 'Infinet checked the park Wi-Fi: no red flags, and the handshake with our anchor server passed. Wi-Fi first, inside the tunnel, so no mobile data is spent.' },
      { on: 'predict.edge', text: "The palm's signal ends ahead. Infinet saw the edge on its map and has 4G checked again." },
      { on: 'switch.done', to: 'cell:', text: "Back on 4G before the Wi-Fi faded. Today's phone hangs on until the call breaks." },
    ],
  },
  {
    id: 'downtown-walk', label: 'Downtown, by the tower', proves: 'PASSPOINT WI-FI · 5G SMALL CELLS · TRUSTED BY CERTIFICATE',
    zone: 'downtown', route: 'downtown-walk', durationS: 74, prewarmS: 0, startDelayS: 1, defaultBaseline: 'b1', init: onCell, events: [],
    captions: [
      { at: 0.5, text: 'Downtown, on the lakeside promenade. The call is on 5G from a small cell on a lamp post: there is one every 70 m.' },
      { on: 'trust.trusted', text: "The promenade Wi-Fi is Passpoint: the phone holds its certificate profile, so Infinet's check ends in Trusted and the call moves onto it." },
      { at: 24, text: 'Six access points, one network. The phone roams from one to the next with no new check.' },
      { on: 'predict.edge', text: 'Out on the pier the Wi-Fi ends. Infinet saw it on its map and has the nearest small cell checked.' },
      { on: 'switch.done', to: 'cell:', text: 'On 5G before the Wi-Fi faded, with the tower across the water.' },
    ],
  },
  {
    id: 'metro-station', label: 'Into the metro station', proves: 'SIGN-IN WI-FI · INDOOR ANTENNAS · NOTHING LEAVES THE TUNNEL',
    zone: 'metro', route: 'metro-station', durationS: 62, prewarmS: 0, startDelayS: 1, defaultBaseline: 'b1', init: onCell, events: [],
    captions: [
      { at: 0.5, text: 'Outside a metro station, on a call over 5G from a mast across the road.' },
      { on: 'trust.checking', text: 'The station Wi-Fi shows a sign-in page, so the call stays on 5G. Tap Sign in by the phone (or press L).' },
      { on: 'portal.signin', text: 'Signed in. Infinet checks the Wi-Fi again, then moves the call onto it, inside the tunnel.' },
      { at: 22, text: "Inside, the metal shell blocks the mast. The station's own indoor antennas carry 5G: same operator, so the phone stays attached." },
      { at: 40, text: 'Press N to see the station Wi-Fi and the indoor 5G from the ceiling.' },
    ],
  },
  {
    id: 'souk-alley', label: 'The old souk', proves: 'OLD ROUTERS AND A LOOK-ALIKE · FLAGGED, THEN BLOCKED',
    zone: 'souk', route: 'souk-alley', durationS: 66, prewarmS: 0, startDelayS: 1, defaultBaseline: 'b2', init: onCell, events: [],
    captions: [
      { at: 0.5, text: "The old souk, on a call over 4G. The shops' routers are years old." },
      { at: 9, text: 'The spice shop still runs WPA with TKIP, the textile shop WEP. Weak crypto is a red flag: tunnel only, and only as a backup. The call stays on 4G.' },
      { on: 'trust.blocked', text: 'A look-alike: "Sоuk_Free_WiFi" spelt with a Cyrillic о. Same to the eye, different bytes. Infinet blocked it.' },
      { on: 'switch.done', to: 'wifi:', text: 'The real Souk_Free_WiFi passed its check, so the call moves onto it: Wi-Fi first, inside the tunnel.' },
    ],
  },
];
