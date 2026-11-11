/**
 * The old souk (11 Nov): four blocks of coral-stone shops round a crossing of two shaded alleys, wind towers on the
 * roofs, timber slats overhead that stripe the floor with sun, lanterns, spice baskets and cloth, and a creek-side
 * quay with wooden boats. Its networks are three old shop routers (WPA-TKIP, WEP, WPA2/3 transition), one sound
 * public Wi-Fi, a look-alike in someone's bag, and a 4G mast. Geometry from src/engine/world/areas.ts (SOUK).
 */
import { useMemo, type JSX } from 'react';
import * as THREE from 'three';
import { LAYOUT, SOUK, type Vec2 } from '../../../engine/index';
import { AMAT, Area, Awning, Block, Box, boxGeo, Cyl, Ground, HideInVision, L3, Mast, P, Palm, Railing, rectPoly, rng, WaterDrift } from './kit';

const ID = 'souk' as const;
const S = SOUK;
const WATER = -0.5;
const A = S.alley;
const WALLS = ['#d8c29b', '#dcc8a4', '#d2bb93', '#e0cdaa'];
const CLOTH = ['#a63d2f', '#c98a2b', '#2f6d6a', '#3b4f7a', '#7a3b5e', '#d9c9a3', '#8a5a2b'];
const SPICE = ['#c8791f', '#b5341f', '#d6b12c', '#6b4a22', '#8a9a3a', '#e0d3b0'];

/** a wind tower (barjeel): an open-sided shaft above the roof that catches the breeze */
function WindTower({ at, z0, s = 1 }: { at: Vec2; z0: number; s?: number }) {
  const w = 3.4 * s, h = 5.2 * s;
  const dark = AMAT.flat('#2a2119', 0.95);
  return (
    <group position={L3(at[0], at[1], z0)}>
      <mesh position-y={h / 2} geometry={boxGeo(w, h, w)} material={AMAT.plaster('#dcc7a0')} castShadow />
      <mesh position-y={h + 0.15} geometry={boxGeo(w + 0.4, 0.3, w + 0.4)} material={AMAT.plaster('#cdb68c')} castShadow />
      {[0, 1, 2, 3].flatMap((f) => [-1, 0, 1].map((k) => (
        <group key={`${f}${k}`} rotation-y={(f * Math.PI) / 2}>
          <mesh position={[k * w * 0.29, h * 0.62, w / 2 + 0.01]} geometry={boxGeo(w * 0.17, h * 0.56, 0.06)} material={dark} />
        </group>
      )))}
      {[0, 1, 2, 3].map((f) => (
        <group key={`p${f}`} rotation-y={(f * Math.PI) / 2}>
          {[-1, 1].map((k) => <mesh key={k} position={[k * w * 0.4, h * 0.25, w / 2 + 0.25]} rotation-x={Math.PI / 2} material={AMAT.timber()}><cylinderGeometry args={[0.05, 0.05, 0.9, 6]} /></mesh>)}
        </group>
      ))}
    </group>
  );
}

/** a wooden creek boat with a cloth canopy */
function Boat({ at, rot = 0 }: { at: Vec2; rot?: number }) {
  return (
    <group position={L3(at[0], at[1], WATER)} rotation-y={rot}>
      <mesh position-y={0.25} geometry={boxGeo(8.4, 0.8, 2.5)} material={AMAT.timber()} castShadow />
      <mesh position={[4.7, 0.42, 0]} rotation-z={0.35} geometry={boxGeo(1.8, 0.6, 1.9)} material={AMAT.timber()} castShadow />
      <mesh position={[-4.6, 0.38, 0]} rotation-z={-0.3} geometry={boxGeo(1.5, 0.6, 2.0)} material={AMAT.timber()} castShadow />
      <mesh position-y={0.68} geometry={boxGeo(7.6, 0.06, 2.1)} material={AMAT.flat('#8a6a44', 0.85)} />
      <mesh position-y={1.05} geometry={boxGeo(5.6, 0.36, 0.5)} material={AMAT.flat('#7a2f24', 0.9)} />
      {[[-2.8, -1], [-2.8, 1], [2.8, -1], [2.8, 1]].map(([x, z], i) => <mesh key={i} position={[x, 1.75, z]} material={AMAT.timber()}><cylinderGeometry args={[0.04, 0.04, 2.1, 6]} /></mesh>)}
      <mesh position-y={2.82} geometry={boxGeo(6.4, 0.05, 2.6)} material={AMAT.cloth('#e6dcc4')} castShadow />
    </group>
  );
}

/** one shop bay on an alley wall: a dark opening in a timber frame, an awning, and goods set out in front */
function bay(key: string, at: Vec2, face: number, i: number, r: () => number): JSX.Element[] {
  const out: JSX.Element[] = [];
  const ns = face === 90 || face === 270;                       // the wall runs north–south
  const n: Vec2 = face === 90 ? [1, 0] : face === 270 ? [-1, 0] : face === 0 ? [0, 1] : [0, -1];
  const along = (d: number, off: number): Vec2 => (ns ? [at[0] + n[0] * off, at[1] + d] : [at[0] + d, at[1] + n[1] * off]);
  const size = (w: number, t: number, h: number): [number, number, number] => (ns ? [t, w, h] : [w, t, h]);
  const shut = r() < 0.14;
  out.push(<Box key={`${key}o`} at={along(0, 0.03)} size={size(3.5, 0.08, 2.75)} mat={shut ? AMAT.flat('#6f5a3c', 0.8) : AMAT.flat('#241c15', 0.95)} shadow={false} />);
  out.push(<Box key={`${key}l`} at={along(0, 0.08)} size={size(3.9, 0.16, 0.2)} z0={2.75} mat={AMAT.timber()} shadow={false} />);
  for (const d of [-1.85, 1.85]) out.push(<Box key={`${key}j${d}`} at={along(d, 0.08)} size={size(0.18, 0.16, 2.75)} mat={AMAT.timber()} shadow={false} />);
  if (shut) {
    for (let k = 0; k < 7; k++) out.push(<Box key={`${key}s${k}`} at={along(0, 0.09)} size={size(3.5, 0.03, 0.04)} z0={0.3 + k * 0.36} mat={AMAT.flat('#4d3d28', 0.8)} shadow={false} />);
    return out;
  }
  if (r() < 0.75) out.push(<Awning key={`${key}a`} at={along(0, 0.1)} w={3.7} depth={1.15} h={3.05} face={face} color={CLOTH[(i * 3 + Math.floor(r() * 3)) % CLOTH.length]} />);
  const kind = Math.floor(r() * 4);
  if (kind === 0) {
    // spices: baskets heaped with colour
    for (let k = 0; k < 4; k++) {
      const p = along(-1.2 + k * 0.8, 0.5 + (k % 2) * 0.28);
      out.push(<Cyl key={`${key}b${k}`} at={p} r={0.26} r2={0.33} h={0.34} mat={AMAT.flat('#8a6a44', 0.95)} seg={12} />);
      out.push(<mesh key={`${key}c${k}`} position={L3(p[0], p[1], 0.47)} material={AMAT.flat(SPICE[(i + k) % SPICE.length], 1)}><coneGeometry args={[0.3, 0.3, 14]} /></mesh>);
    }
  } else if (kind === 1) {
    // cloth: bolts standing in a crate, lengths hung by the door
    out.push(<P key={`${key}cr`} id={ID} name="ph_crate" at={along(-0.9, 0.55)} rotY={i} />);
    for (let k = 0; k < 5; k++) out.push(<Cyl key={`${key}r${k}`} at={along(0.2 + k * 0.26, 0.42 + (k % 2) * 0.16)} r={0.085} h={1.25 + (k % 3) * 0.12} mat={AMAT.flat(CLOTH[(i + k * 2) % CLOTH.length], 0.95)} seg={10} />);
    for (let k = 0; k < 3; k++) out.push(<Box key={`${key}h${k}`} at={along(-1.4 + k * 0.5, 0.14)} size={size(0.42, 0.02, 1.5)} z0={1.1} mat={AMAT.cloth(CLOTH[(i + k + 3) % CLOTH.length])} shadow={false} />);
  } else if (kind === 2) {
    // pottery and brass
    out.push(<P key={`${key}v1`} id={ID} name="ph_vase" at={along(-1.1, 0.5)} rotY={i} scale={1.6} />);
    out.push(<P key={`${key}v2`} id={ID} name="ph_vase_white" at={along(-0.5, 0.42)} rotY={i * 2} scale={1.5} />);
    out.push(<P key={`${key}j1`} id={ID} name="ph_jug" at={along(0.3, 0.5)} rotY={i} scale={1.8} />);
    out.push(<P key={`${key}bk`} id={ID} name="ph_basket" at={along(1.1, 0.5)} rotY={i} scale={1.4} />);
  } else {
    // sacks, crates and a drum of dates
    out.push(<P key={`${key}c1`} id={ID} name="ph_crate" at={along(-1.0, 0.5)} rotY={i * 0.7} />);
    out.push(<P key={`${key}c2`} id={ID} name="ph_plastic_crate" at={along(0.1, 0.45)} rotY={i} />);
    out.push(<P key={`${key}d`} id={ID} name="ph_basket" at={along(1.1, 0.5)} rotY={i} scale={1.5} />);
  }
  // a lamp over the door
  out.push(<mesh key={`${key}lm`} position={L3(...along(0, 0.3), 3.25)} material={AMAT.glow('#ffcf8a', 1.5)}><sphereGeometry args={[0.11, 10, 8]} /></mesh>);
  return out;
}

export function Souk() {
  const mast = LAYOUT.transmitters.find((t) => t.id === 'cellA-souk')!;

  const shops = useMemo(() => {
    const out: JSX.Element[] = [];
    const r = rng(23);
    let i = 0;
    for (let y = -58; y <= 38; y += 5) {
      if (Math.abs(y) < 5.5) continue;
      out.push(...bay(`w${y}`, [-A, y], 90, i++, r), ...bay(`e${y}`, [A, y + 1.2], 270, i++, r));
    }
    for (let x = 7; x <= 29; x += 5.4) for (const s of [-1, 1]) {
      out.push(...bay(`n${s}${x}`, [s * x, A], 180, i++, r), ...bay(`s${s}${x}`, [s * x + 1, -A], 0, i++, r));
    }
    for (let x = -28; x <= 28; x += 6.2) if (Math.abs(x) > 5) out.push(...bay(`q${x}`, [x, S.quay.y0], 0, i++, r));
    return out;
  }, []);

  /** the alleys' roof: timber slats with gaps, so the sun falls in stripes; lanterns strung under it */
  const roof = useMemo(() => {
    const m = new THREE.Matrix4();
    const ns: number[] = [], ew: number[] = [];
    for (let y = -61.6; y <= 41.6; y += 1.05) ns.push(y);
    for (let x = -31.6; x <= 31.6; x += 1.05) if (Math.abs(x) > A + 0.2) ew.push(x);
    const slatsNS = new THREE.InstancedMesh(new THREE.BoxGeometry(2 * A + 0.5, 0.07, 0.5), AMAT.timber(), ns.length);
    ns.forEach((y, i) => slatsNS.setMatrixAt(i, m.makeTranslation(0, 5.5, -y)));
    const slatsEW = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.07, 2 * A + 0.5), AMAT.timber(), ew.length);
    ew.forEach((x, i) => slatsEW.setMatrixAt(i, m.makeTranslation(x, 5.5, 0)));
    slatsNS.castShadow = slatsEW.castShadow = true;
    const lamps: Array<[number, number, number]> = [];
    for (let y = -57; y <= 39; y += 6) for (let k = 0; k < 4; k++) lamps.push([-1.65 + k * 1.1, y, 4.35 - 0.28 * Math.sin((k / 3) * Math.PI)]);
    for (let x = -29; x <= 29; x += 6) if (Math.abs(x) > 4) for (let k = 0; k < 4; k++) lamps.push([x, -1.65 + k * 1.1, 4.35 - 0.28 * Math.sin((k / 3) * Math.PI)]);
    const lanterns = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 10, 8), AMAT.glow('#ffc070', 1.7), lamps.length);
    lamps.forEach(([x, y, h], i) => lanterns.setMatrixAt(i, m.makeTranslation(x, h, -y)));
    return { slatsNS, slatsEW, lanterns };
  }, []);

  const beams = useMemo(() => {
    const out: JSX.Element[] = [];
    for (let y = -60; y <= 40; y += 5) out.push(<Box key={`bn${y}`} at={[0, y]} size={[2 * A + 0.3, 0.22, 0.28]} z0={5.18} mat={AMAT.timber()} />);
    for (let x = -30; x <= 30; x += 5) if (Math.abs(x) > 4) out.push(<Box key={`be${x}`} at={[x, 0]} size={[0.22, 2 * A + 0.3, 0.28]} z0={5.18} mat={AMAT.timber()} />);
    for (let y = -57; y <= 39; y += 6) out.push(<Box key={`wn${y}`} at={[0, y]} size={[2 * A, 0.012, 0.012]} z0={4.5} mat={AMAT.frame()} shadow={false} />);
    return out;
  }, []);

  const gates = useMemo(() => {
    const out: JSX.Element[] = [];
    const gate = (key: string, at: Vec2, ns: boolean, w: number, arch = true) => {
      const size = (a: number, t: number, h: number): [number, number, number] => (ns ? [t, a, h] : [a, t, h]);
      out.push(<Box key={`${key}g`} at={at} size={size(w, 0.1, 1.0)} mat={AMAT.timber()} />);
      if (!arch) return;
      for (const s of [-1, 1]) out.push(<Box key={`${key}p${s}`} at={ns ? [at[0], at[1] + s * (w / 2 + 0.35)] : [at[0] + s * (w / 2 + 0.35), at[1]]} size={[0.9, 0.9, 5.2]} mat={AMAT.plaster('#d8c29b')} />);
      out.push(<Box key={`${key}t`} at={at} size={size(w + 1.6, 1.0, 1.1)} z0={4.6} mat={AMAT.plaster('#d2bb93')} />);
      out.push(<Box key={`${key}c`} at={at} size={size(w + 2.0, 1.2, 0.22)} z0={5.7} mat={AMAT.plaster('#c4ad84')} />);
    };
    gate('s', [0, -62], false, 2 * A);
    gate('w', [-32, 0], true, 2 * A);
    gate('e', [32, 0], true, 2 * A);
    gate('qw', [-32, (S.quay.y0 + S.quay.y1) / 2], true, S.quay.y1 - S.quay.y0, false);
    gate('qe', [32, (S.quay.y0 + S.quay.y1) / 2], true, S.quay.y1 - S.quay.y0, false);
    return out;
  }, []);

  return (
    <Area id={ID}>
      <WaterDrift />
      {/* the ground: sand-coloured paving in the quarter, the creek to the north and the far bank */}
      <Ground poly={rectPoly(-900, -900, 900, S.quay.y1)} y={-0.03} mat={AMAT.sand()} />
      <Ground poly={rectPoly(-900, 250, 900, 1100)} y={-0.03} mat={AMAT.sand()} />
      <Ground poly={rectPoly(-900, S.quay.y1, 900, 250)} y={WATER} mat={AMAT.water('#2f6f72')} />
      <Box at={[0, S.quay.y1 + 0.25]} size={[1200, 0.5, 0.7]} z0={WATER - 0.1} mat={AMAT.stone('#b9a888')} shadow={false} />
      <Ground poly={rectPoly(-A, -62, A, S.quay.y0)} y={0.012} mat={AMAT.paving('#d9c8a6')} />
      <Ground poly={rectPoly(-32, -A, 32, A)} y={0.013} mat={AMAT.paving('#d9c8a6')} />
      <Ground poly={rectPoly(-120, S.quay.y0, 120, S.quay.y1)} y={0.012} mat={AMAT.paving('#cdb994')} />
      <Ground poly={rectPoly(-70, -96, 70, -62)} y={0.012} mat={AMAT.paving('#decfb0')} />
      <Ground poly={rectPoly(-260, -112, 260, -100)} y={-0.01} mat={AMAT.asphalt()} />

      {/* the four blocks of shops, their parapets and wind towers */}
      {S.blocks.map((b, i) => (
        <group key={b.id}>
          <Box at={[(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]} size={[b.x1 - b.x0, b.y1 - b.y0, b.h]} mat={AMAT.arched(`souk${i}`, WALLS[i])} />
          <Box at={[(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]} size={[b.x1 - b.x0 + 0.3, b.y1 - b.y0 + 0.3, 0.5]} z0={b.h} mat={AMAT.plaster(WALLS[(i + 1) % 4])} />
          <WindTower at={[b.x0 + (b.x1 - b.x0) * (i % 2 ? 0.3 : 0.68), b.y0 + (b.y1 - b.y0) * (i < 2 ? 0.72 : 0.4)]} z0={b.h} />
          <WindTower at={[b.x0 + (b.x1 - b.x0) * (i % 2 ? 0.7 : 0.3), b.y0 + (b.y1 - b.y0) * (i < 2 ? 0.25 : 0.75)]} z0={b.h} s={0.8} />
          <P id={ID} name="ph_aircon" at={[(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]} h={b.h + 0.5} rotY={i} />
        </group>
      ))}
      {shops}
      {gates}
      <HideInVision>
        <primitive object={roof.slatsNS} />
        <primitive object={roof.slatsEW} />
        {beams}
      </HideInVision>
      <primitive object={roof.lanterns} />

      {/* the networks: three old shop routers on the walls, the public Wi-Fi at the crossing, the look-alike in a bag */}
      <P id={ID} name="ap_cafe" at={[S.spice[0], S.spice[1]]} h={S.spice[2]} face={90} />
      <P id={ID} name="ap_cafe" at={[S.textile[0], S.textile[1]]} h={S.textile[2]} face={270} />
      <P id={ID} name="ap_cafe" at={[S.guest[0], S.guest[1]]} h={S.guest[2]} face={90} />
      <P id={ID} name="ap_ceiling" at={[S.free[0], S.free[1]]} h={S.free[2]} />
      <Box at={[S.free[0], S.free[1] + 0.12]} size={[0.5, 0.2, 0.06]} z0={S.free[2] + 0.04} mat={AMAT.frame()} shadow={false} />
      <P id={ID} name="ph_crate" at={[S.rogue[0], S.rogue[1]]} rotY={0.4} />
      <P id={ID} name="ph_tote" at={[S.rogue[0], S.rogue[1]]} h={0.45} rotY={0.9} />
      <mesh position={L3(S.rogue[0], S.rogue[1], S.rogue[2])} material={AMAT.glow('#ff5a4a', 1.3)}><sphereGeometry args={[0.035, 8, 6]} /></mesh>

      {/* the quay: a railing on the creek, benches, boats on the water */}
      <Railing pts={[[-120, S.quay.y1], [120, S.quay.y1]]} fill="bars" />
      {[-22, -8, 8, 22].map((x, i) => <P key={`qb${i}`} id={ID} name="bench" at={[x, S.quay.y1 - 1.1]} face={0} />)}
      {[-15, 15].map((x, i) => <P key={`qd${i}`} id={ID} name="ph_drum" at={[x, S.quay.y1 - 0.9]} rotY={i} />)}
      <Boat at={[-14, S.quay.y1 + 3.4]} />
      <Boat at={[16, S.quay.y1 + 3.8]} rot={0.06} />
      <Boat at={[60, 120]} rot={0.5} />
      <Boat at={[-80, 150]} rot={-0.3} />

      {/* the square at the south gate, the mast, and the old quarter on every side and across the creek */}
      {[[-14, -70], [14, -70], [-30, -86], [30, -86], [-52, -72], [52, -72]].map(([x, y], i) => <Palm key={`sp${i}`} id={ID} at={[x, y]} i={i} />)}
      {[[-8, -66], [8, -66]].map(([x, y], i) => <P key={`sb${i}`} id={ID} name="bench" at={[x, y]} face={180} />)}
      {([[-40, -106, '#e9e7e1', 0], [-10, -106, '#2d3540', 1], [26, -106, '#b9bdc2', 2]] as Array<[number, number, string, number]>).map(([x, y, c, k], i) => (
        <P key={`car${i}`} id={ID} name={(['car_sedan', 'car_suv', 'pickup'] as const)[k]} at={[x, y]} h={0} face={90} tint={{ CarPaint: c }} />
      ))}
      <Mast id={ID} at={[S.mast[0], S.mast[1]]} h={S.mast[2]} az={mast.sectors?.[0].azDeg ?? 0} />
      {([[-56, -30, 40, 56, 6.5], [-58, 24, 44, 36, 7.5], [58, -32, 44, 54, 7], [56, 22, 40, 38, 6], [-104, -20, 40, 70, 8], [104, -10, 40, 80, 7.5],
        [-100, -140, 60, 40, 8], [-20, -146, 70, 44, 9], [70, -142, 60, 40, 7]] as number[][]).map(([x, y, sx, sy, h], i) => (
        <group key={`nb${i}`}>
          <Box at={[x, y]} size={[sx, sy, h]} mat={AMAT.arched(`souk${i % 4}`, WALLS[i % 4])} />
          <WindTower at={[x + sx * 0.2, y - sy * 0.15]} z0={h} s={0.9} />
        </group>
      ))}
      {([[-220, 300, 60, 40, 8], [-140, 296, 60, 36, 10], [-60, 300, 70, 40, 7], [20, 296, 56, 36, 9], [100, 300, 64, 40, 8], [190, 298, 70, 40, 11]] as number[][]).map(([x, y, sx, sy, h], i) => (
        <group key={`fb${i}`}>
          <Box at={[x, y]} size={[sx, sy, h]} mat={AMAT.arched(`souk${i % 4}`, WALLS[(i + 2) % 4])} />
          <WindTower at={[x - sx * 0.2, y]} z0={h} s={1.1} />
        </group>
      ))}
      {([[-240, 380, 50, 40, 26], [-120, 390, 50, 40, 34], [10, 384, 60, 40, 22], [140, 392, 50, 40, 30], [260, 380, 50, 40, 24]] as number[][]).map(([x, y, sx, sy, h], i) => <Block key={`blk${i}`} at={[x, y]} size={[sx, sy, h]} kind={i} />)}
      {Array.from({ length: 12 }, (_, i) => <Palm key={`cp${i}`} id={ID} at={[-230 + i * 42, 262]} i={i + 30} s={1.1} />)}
    </Area>
  );
}
