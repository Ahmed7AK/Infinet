/**
 * Downtown (11 Nov): a lakeside promenade under a shopping arcade, a timber pier, fountains on the lake and a very
 * tall stepped tower across the water, with a skyline round the shore. Its networks are the six Passpoint access
 * points under the arcade's canopy and four 5G small cells on smart poles along the railing. Geometry from
 * src/engine/world/areas.ts (DOWNTOWN). The tower and skyline are built in code (a three-winged, stepped spire);
 * no downloaded model, no names or logos.
 */
import { useMemo, type JSX } from 'react';
import { DOWNTOWN, type Vec2 } from '../../../engine/index';
import { AMAT, Area, Awning, Block, Box, boxGeo, Cyl, cylGeo, GlassTower, Ground, Hedge, Jets, L3, P, Palm, Railing, rectPoly, rng, WaterDrift } from './kit';

const ID = 'downtown' as const;
const D = DOWNTOWN;
const WATER = -0.55;

/** the tower: three wings round a core, each wing stepping back in turn so the setbacks spiral up to a spire */
function Tower({ at, h }: { at: Vec2; h: number }) {
  const els = useMemo(() => {
    const glass = AMAT.curtain('spire', [146, 166, 182], true);
    const out: JSX.Element[] = [];
    const N = 9, wingTop = h * 0.7;
    for (let w = 0; w < 3; w++) {
      const kids: JSX.Element[] = [];
      let z0 = 0;
      for (let i = 0; i < N; i++) {
        const z1 = wingTop * ((i + (w + 1) / 3) / N);
        const len = 14 + 62 * Math.pow(1 - i / N, 1.15), wid = 26 - 13 * (i / N), dz = z1 - z0;
        kids.push(<mesh key={`b${i}`} position={[len / 2, z0 + dz / 2, 0]} geometry={boxGeo(len, dz, wid)} material={glass} />);
        kids.push(<mesh key={`c${i}`} position={[len, z0 + dz / 2, 0]} geometry={cylGeo(wid / 2, dz, 20)} material={glass} />);
        z0 = z1;
      }
      // one wing points at the promenade (south)
      out.push(<group key={`w${w}`} rotation-y={-Math.PI / 2 + (w / 3) * Math.PI * 2}>{kids}</group>);
    }
    // the core: a tapering stack, then the spire's steps and a steel pinnacle
    const steps: Array<[number, number, number]> = [];
    for (let i = 0; i < 8; i++) steps.push([(h * 0.72 * i) / 8, (h * 0.72 * (i + 1)) / 8, 23 - 1.6 * i]);
    for (let i = 0; i < 4; i++) steps.push([h * (0.72 + 0.04 * i), h * (0.72 + 0.04 * (i + 1)), 8.5 - 1.5 * i]);
    steps.forEach(([a, b, r], i) => out.push(<mesh key={`k${i}`} position-y={(a + b) / 2} geometry={cylGeo(r, b - a, 24, r * 0.96)} material={glass} />));
    out.push(<mesh key="pin" position-y={h * 0.94} material={AMAT.steel()}><cylinderGeometry args={[0.4, 2.6, h * 0.12, 12]} /></mesh>);
    return out;
  }, [h]);
  return (
    <group position={L3(at[0], at[1])}>
      {els}
      <mesh position-y={9} geometry={boxGeo(210, 18, 150)} material={AMAT.stone('#cdbfa6')} />
      <mesh position-y={19} geometry={boxGeo(150, 3, 110)} material={AMAT.flat('#3d5a4a', 1)} />
    </group>
  );
}

/** a smart pole: a lamp over the promenade and a 5G small cell under its cap */
function SmartPole({ at, h }: { at: Vec2; h: number }) {
  return (
    <group position={L3(at[0], at[1])}>
      <mesh position-y={h / 2 + 0.4} material={AMAT.steel()} castShadow><cylinderGeometry args={[0.085, 0.13, h + 0.8, 14]} /></mesh>
      <mesh position-y={0.2} material={AMAT.frame()} castShadow><cylinderGeometry args={[0.22, 0.26, 0.4, 14]} /></mesh>
      {/* the radio: a slim white shroud with a status ring */}
      <mesh position-y={h - 0.35} material={AMAT.flat('#f2f3f1', 0.5)} castShadow><cylinderGeometry args={[0.2, 0.2, 0.9, 16]} /></mesh>
      <mesh position-y={h - 0.86} material={AMAT.glow('#67E8F9', 1.4)}><cylinderGeometry args={[0.21, 0.21, 0.05, 16]} /></mesh>
      {/* the lamp arm reaches south over the walk */}
      <mesh position={[0, h + 0.7, 0.9]} geometry={boxGeo(0.07, 0.07, 1.9)} material={AMAT.steel()} castShadow />
      <mesh position={[0, h + 0.62, 1.7]} geometry={boxGeo(0.34, 0.06, 0.7)} material={AMAT.glow('#fff1d6', 0.9)} />
    </group>
  );
}

export function Downtown() {
  const pr = D.promenade;

  const skyline = useMemo(() => {
    const r = rng(7);
    const out: Array<{ at: Vec2; size: [number, number, number]; tone: number; rot: number }> = [];
    const add = (x: number, y: number, lo = 90, hi = 320) => out.push({ at: [x, y], size: [26 + r() * 18, 26 + r() * 18, lo + r() * (hi - lo)], tone: Math.floor(r() * 6), rot: (r() - 0.5) * 0.7 });
    for (let y = 30; y <= 330; y += 62) { add(318 + r() * 30, y); add(-318 - r() * 30, y); add(420 + r() * 50, y + 30, 140, 380); add(-420 - r() * 50, y + 30, 140, 380); }
    for (let x = -480; x <= 480; x += 68) if (Math.abs(x) > 150) { add(x, 392 + r() * 40, 80, 240); add(x + 22, 500 + r() * 80, 160, 420); }
    return out;
  }, []);

  const arcade = useMemo(() => {
    const out: JSX.Element[] = [];
    const awn = ['#8a3b2e', '#2f5d62', '#c9a45c', '#3d4f6b', '#7a5a3c'];
    D.podium.forEach((b, k) => {
      const w = b.x1 - b.x0, cx = (b.x0 + b.x1) / 2;
      // the block: two storeys of arched windows over a glazed shopfront, a cornice and a set-back attic
      out.push(<Box key={`p${k}`} at={[cx, (b.y0 + b.y1) / 2]} size={[w, b.y1 - b.y0, b.h]} mat={AMAT.arched(`dt${k}`, ['#e4d6bb', '#dccdb0', '#e8dcc6'][k])} />);
      out.push(<Box key={`pc${k}`} at={[cx, (b.y0 + b.y1) / 2]} size={[w + 0.8, b.y1 - b.y0 + 0.8, 0.6]} z0={b.h} mat={AMAT.stone('#cbbd9f')} />);
      out.push(<Box key={`pg${k}`} at={[cx, b.y1 + 0.03]} size={[w - 1.2, 0.1, 3.7]} z0={0.25} mat={AMAT.flat('#26323a', 0.08, 0.7)} shadow={false} />);
      out.push(<Box key={`pk${k}`} at={[cx, b.y1 + 0.06]} size={[w, 0.2, 0.25]} mat={AMAT.stone('#b7aa90')} shadow={false} />);
      for (let x = b.x0 + 0.6, i = 0; x <= b.x1 - 0.5; x += (w - 1.2) / Math.round((w - 1.2) / 4.6), i++) {
        out.push(<Box key={`pm${k}-${i}`} at={[x, b.y1 + 0.1]} size={[0.5, 0.24, 4.3]} mat={AMAT.stone('#d8cab0')} shadow={false} />);
      }
      // the canopy the access points hang under, with a warm light strip and a few shop awnings below it
      out.push(<Box key={`cn${k}`} at={[cx, b.y1 + 2.1]} size={[w, 4.2, 0.22]} z0={4.36} mat={AMAT.timber()} />);
      out.push(<Box key={`cf${k}`} at={[cx, b.y1 + 4.2]} size={[w, 0.14, 0.5]} z0={4.2} mat={AMAT.frame()} />);
      out.push(<Box key={`cl${k}`} at={[cx, b.y1 + 2.4]} size={[w - 4, 0.12, 0.04]} z0={4.31} mat={AMAT.glow('#ffe2b0', 1.1)} shadow={false} />);
      for (let x = b.x0 + 9, i = 0; x < b.x1 - 6; x += 18.4, i++) {
        out.push(<Awning key={`aw${k}-${i}`} at={[x, b.y1 + 0.15]} w={3.8} depth={1.3} h={3.5} face={0} color={awn[(i + k * 2) % awn.length]} />);
        out.push(<P key={`pl${k}-${i}`} id={ID} name={i % 2 ? 'ph_plant_tall' : 'ph_planter'} at={[x + 3.4, b.y1 + 0.9]} face={0} />);
      }
    });
    return out;
  }, []);

  const street = useMemo(() => {
    const out: JSX.Element[] = [];
    const nearCell = (x: number) => D.cells.some((c) => Math.abs(c[0] - x) < 4);
    for (let x = -252, i = 0; x <= 252; x += 14, i++) {
      if (x > D.pier.x0 - 5 && x < D.pier.x1 + 5) continue;
      if (!nearCell(x)) out.push(<Palm key={`pm${i}`} id={ID} at={[x, 6.4]} i={i} />);
      if (i % 2 === 0 && Math.abs(x) < 136) out.push(<P key={`bn${i}`} id={ID} name="bench" at={[x + 7, 5.2]} face={0} />);
      if (i % 4 === 1) out.push(<P key={`bi${i}`} id={ID} name="street_bin" at={[x + 4.2, 6.6]} rotY={i} />);
    }
    [-118, -62, 0, 62, 118].forEach((x, i) => out.push(<P key={`bs${i}`} id={ID} name="ph_bistro_set" at={[x + 9, -6.2]} rotY={i * 0.9} />));
    return out;
  }, []);

  const fountain = useMemo(() => ({
    ring: Array.from({ length: 40 }, (_, i) => [Math.cos((i / 40) * 2 * Math.PI) * 84, 150 + Math.sin((i / 40) * 2 * Math.PI) * 36] as Vec2),
    line: Array.from({ length: 15 }, (_, i) => [-56 + i * 8, 150 + Math.sin(i * 0.45) * 6] as Vec2),
  }), []);

  const railPts = useMemo(() => ({
    west: [[-260, 9], [D.pier.x0, 9], [D.pier.x0, D.pier.y1], [D.deck.x0, D.deck.y0], [D.deck.x0, D.deck.y1], [D.deck.x1, D.deck.y1], [D.deck.x1, D.deck.y0], [D.pier.x1, D.pier.y1], [D.pier.x1, 9], [260, 9]] as Vec2[],
    ends: [[[pr.x0, -9], [pr.x0, 9]], [[pr.x1, -9], [pr.x1, 9]]] as Vec2[][],
  }), [pr.x0, pr.x1]);

  return (
    <Area id={ID}>
      <WaterDrift />
      {/* the land: the city south of the lake, both shores and the far bank; the lake between them */}
      <Ground poly={rectPoly(-900, -900, 900, 9)} y={-0.03} mat={AMAT.stone('#cfc6b4')} />
      <Ground poly={rectPoly(D.lake.x1, 9, 900, D.lake.y1)} y={-0.03} mat={AMAT.stone('#cfc6b4')} />
      <Ground poly={rectPoly(-900, 9, D.lake.x0, D.lake.y1)} y={-0.03} mat={AMAT.stone('#cfc6b4')} />
      <Ground poly={rectPoly(-900, D.lake.y1, 900, 1300)} y={-0.03} mat={AMAT.stone('#cfc6b4')} />
      <Ground poly={rectPoly(D.lake.x0, 9, D.lake.x1, D.lake.y1)} y={WATER} mat={AMAT.water('#1c5f6c')} />
      {/* the quay walls round the water */}
      <Box at={[0, 9.2]} size={[520, 0.4, 0.75]} z0={WATER - 0.1} mat={AMAT.stone('#b9ad98')} shadow={false} />
      <Box at={[0, D.lake.y1 - 0.2]} size={[520, 0.4, 0.75]} z0={WATER - 0.1} mat={AMAT.stone('#b9ad98')} shadow={false} />
      {[D.lake.x0 + 0.2, D.lake.x1 - 0.2].map((x) => <Box key={x} at={[x, (9 + D.lake.y1) / 2]} size={[0.4, D.lake.y1 - 9, 0.75]} z0={WATER - 0.1} mat={AMAT.stone('#b9ad98')} shadow={false} />)}

      {/* the promenade (it runs on past the railings at both ends) and the lanes between the blocks */}
      <Ground poly={rectPoly(-260, -9, 260, 9)} y={0.012} mat={AMAT.paving('#e6dccb')} />
      <Ground poly={rectPoly(-260, 2.6, 260, 3.4)} y={0.016} mat={AMAT.stone('#b9ad98')} />
      {[[-48, -40], [40, 48]].map(([a, b]) => <Ground key={a} poly={rectPoly(a, -60, b, -9)} y={0.012} mat={AMAT.paving('#dccfb8')} />)}
      {[[-48, -40], [40, 48]].map(([a, b]) => <Hedge key={`h${a}`} pts={[[a + 0.6, -12], [b - 0.6, -12]]} h={1.0} w={0.9} />)}
      {arcade}
      {D.podium.map((b, k) => <GlassTower key={`pt${k}`} at={[(b.x0 + b.x1) / 2 + (k - 1) * 8, -30]} size={[38, 24, [150, 210, 130][k]]} tone={k + 1} />)}

      {/* the railing along the lake, round the pier and its deck, and across both ends of the walk */}
      <Railing pts={railPts.west} />
      {railPts.ends.map((p, i) => <Railing key={i} pts={p} fill="bars" />)}
      <Box at={[(D.pier.x0 + D.pier.x1) / 2, (D.pier.y0 + D.pier.y1) / 2]} size={[D.pier.x1 - D.pier.x0, D.pier.y1 - D.pier.y0, 0.24]} z0={-0.22} mat={AMAT.deck()} />
      <Box at={[(D.deck.x0 + D.deck.x1) / 2, (D.deck.y0 + D.deck.y1) / 2]} size={[D.deck.x1 - D.deck.x0, D.deck.y1 - D.deck.y0, 0.24]} z0={-0.22} mat={AMAT.deck()} />
      {[14, 24, 34, 44, 54, 66].flatMap((y) => [D.pier.x0 + 0.4, D.pier.x1 - 0.4].map((x) => <Cyl key={`pile${x}-${y}`} at={[x + (y > 52 ? (x < 60 ? -6 : 6) : 0), y]} r={0.2} h={1.4} z0={WATER - 0.8} mat={AMAT.timber()} seg={10} shadow={false} />))}
      <P id={ID} name="bench" at={[60, 66.2]} face={180} />
      {[[52.5, 54.5], [67.5, 54.5]].map(([x, y], i) => <P key={`dp${i}`} id={ID} name="ph_planter" at={[x, y]} face={90} />)}

      {/* the networks: Passpoint access points under the canopy, small cells on the smart poles */}
      {D.aps.map((p, i) => <P key={`ap${i}`} id={ID} name="ap_ceiling" at={[p[0], p[1]]} h={p[2] + 0.02} />)}
      {D.cells.map((p, i) => <SmartPole key={`sc${i}`} at={[p[0], p[1]]} h={p[2]} />)}

      {street}

      {/* the lake's fountains, the tower across the water and the skyline round the shore */}
      <group position={[0, WATER, 0]}>
        <Jets pts={fountain.ring} height={36} r={0.9} speed={0.7} phase={0.32} />
        <Jets pts={fountain.line} height={78} r={1.1} speed={0.45} phase={0.6} />
      </group>
      <Tower at={D.tower.at} h={D.tower.h} />
      {skyline.map((t, i) => <GlassTower key={`sk${i}`} at={t.at} size={t.size} tone={t.tone} rot={t.rot} />)}
      {([[-230, -40, 60, 40, 22], [-200, -110, 70, 44, 30], [232, -44, 64, 44, 24], [200, -112, 60, 40, 34], [-90, -110, 60, 40, 28], [0, -118, 70, 44, 36], [96, -112, 56, 40, 26]] as number[][]).map(([x, y, sx, sy, h], i) => (
        <Block key={`blk${i}`} at={[x, y]} size={[sx, sy, h]} kind={i} />
      ))}
      {Array.from({ length: 18 }, (_, i) => <Palm key={`fp${i}`} id={ID} at={[-250 + i * 29.4, D.lake.y1 + 8]} i={i + 50} s={1.2} />)}
    </Area>
  );
}
