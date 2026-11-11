/**
 * The park (11 Nov): lawns, a palm-lined promenade from the south gate to a pond, a rubber jogging loop, a kiosk,
 * shade sails and a gazebo. Its networks are the three solar "Wi-Fi palms" (one public mesh network) and a 4G mast
 * beyond the houses. Geometry from src/engine/world/areas.ts (PARK); scene-only ambience, the engine never sees it.
 */
import { useMemo, type JSX } from 'react';
import * as THREE from 'three';
import { LAYOUT, PARK, type Vec2 } from '../../../engine/index';
import { AMAT, Area, Awning, bandGeo, Block, Box, boxGeo, ellipsePoly, Ground, Hedge, Jets, L3, Lamp, Mast, P, Palm, rectPoly, ribbonGeo, rng, Shrub, smooth, Tree, WaterDrift } from './kit';

const ID = 'park' as const;
const K = PARK;

/** a solar Wi-Fi palm: a steel trunk, a crown of solar "fronds", the access point under it and a round bench */
function WifiPalm({ at }: { at: Vec2 }) {
  const solar = AMAT.flat('#18294a', 0.28, 0.7);
  const fronds = useMemo(() => Array.from({ length: 7 }, (_, i) => (i / 7) * Math.PI * 2), []);
  return (
    <group position={L3(at[0], at[1])}>
      <mesh position-y={2.6} material={AMAT.steel()} castShadow><cylinderGeometry args={[0.1, 0.17, 5.2, 14]} /></mesh>
      <mesh position-y={5.25} material={AMAT.steel()} castShadow><sphereGeometry args={[0.26, 14, 10]} /></mesh>
      {fronds.map((a, i) => (
        <group key={i} rotation-y={a}>
          <group position={[0.2, 5.25, 0]} rotation-z={-0.3}>
            <mesh position={[1.25, 0, 0]} geometry={boxGeo(2.5, 0.035, 0.62)} material={solar} castShadow />
            <mesh position={[1.25, -0.03, 0]} geometry={boxGeo(2.5, 0.03, 0.08)} material={AMAT.steel()} />
          </group>
        </group>
      ))}
      {/* the bench round the trunk, and a small charging panel that glows */}
      <mesh position-y={0.24} material={AMAT.stone('#cfc7b8')} castShadow receiveShadow><cylinderGeometry args={[1.25, 1.25, 0.44, 28]} /></mesh>
      <mesh position-y={0.48} material={AMAT.timber()} castShadow receiveShadow><cylinderGeometry args={[1.32, 1.32, 0.05, 28]} /></mesh>
      <mesh position={[0, 1.35, 0.19]} geometry={boxGeo(0.24, 0.34, 0.04)} material={AMAT.glow('#67E8F9', 0.9)} />
    </group>
  );
}

/** three shade sails on four masts over rubber flooring, with seats under them */
function Sails({ at }: { at: Vec2 }) {
  const geo = useMemo(() => {
    const tri = (a: number[], b: number[], c: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
      g.computeVertexNormals();
      return g;
    };
    // mast tops (local to the sails, three.js axes): two high, two low, so the cloth twists
    const A = [-6, 4.6, -5], B = [6, 3.4, -5.5], C = [6.5, 4.8, 5], D2 = [-6, 3.2, 5.5], M = [0, 3.6, 0];
    return [tri(A, B, M), tri(B, C, M), tri(C, D2, A)];
  }, []);
  const cols = ['#d8b26a', '#c96f4a', '#e8dcc0'];
  return (
    <group position={L3(at[0], at[1])}>
      <mesh position-y={0.012} rotation-x={-Math.PI / 2} material={AMAT.rubber('#3f8794')} receiveShadow><circleGeometry args={[8.5, 40]} /></mesh>
      {geo.map((g, i) => <mesh key={i} geometry={g} material={AMAT.cloth(cols[i])} castShadow receiveShadow />)}
      {[[-6, 4.6, -5], [6, 3.4, -5.5], [6.5, 4.8, 5], [-6, 3.2, 5.5]].map(([x, h, z], i) => (
        <mesh key={i} position={[x, h / 2, z]} material={AMAT.steel()} castShadow><cylinderGeometry args={[0.07, 0.09, h, 10]} /></mesh>
      ))}
    </group>
  );
}

function Gazebo({ at, r }: { at: Vec2; r: number }) {
  const posts = useMemo(() => Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2 + Math.PI / 8), []);
  return (
    <group position={L3(at[0], at[1])}>
      <mesh position-y={0.1} material={AMAT.stone('#d6cdbd')} receiveShadow castShadow><cylinderGeometry args={[r + 0.5, r + 0.6, 0.2, 8]} /></mesh>
      {posts.map((a, i) => <mesh key={i} position={[Math.cos(a) * r, 1.5, Math.sin(a) * r]} geometry={boxGeo(0.16, 2.8, 0.16)} material={AMAT.timber()} castShadow />)}
      <mesh position-y={2.95} material={AMAT.timber()} castShadow><cylinderGeometry args={[r + 0.35, r + 0.35, 0.14, 8]} /></mesh>
      <mesh position-y={3.9} rotation-y={Math.PI / 8} material={AMAT.flat('#a8573b', 0.85)} castShadow><coneGeometry args={[r + 0.8, 1.8, 8]} /></mesh>
    </group>
  );
}

export function Park() {
  const mast = LAYOUT.transmitters.find((t) => t.id === 'cellA-park')!;
  const g = useMemo(() => {
    const pondIn = ellipsePoly(K.pond.at[0], K.pond.at[1], K.pond.rx, K.pond.ry, 56);
    const pondOut = ellipsePoly(K.pond.at[0], K.pond.at[1], K.pond.rx + 0.7, K.pond.ry + 0.7, 56);
    const walkIn = ellipsePoly(K.pond.at[0], K.pond.at[1], K.pond.rx + 2.2, K.pond.ry + 2.2, 56);
    const walkOut = ellipsePoly(K.pond.at[0], K.pond.at[1], K.pond.rx + 5.0, K.pond.ry + 5.0, 56);
    const tr = K.track;
    return {
      water: pondIn,
      rim: bandGeo(pondIn, pondOut, 0.3),
      rimSide: (() => {
        // the rim's outer face, so it is a kerb and not a floating ring
        const pos: number[] = [], idx: number[] = [];
        pondOut.forEach((p, i) => { pos.push(p[0], 0, -p[1], p[0], 0.3, -p[1]); const a = 2 * i, b = 2 * ((i + 1) % pondOut.length); idx.push(a, b, a + 1, a + 1, b, b + 1); });
        const gg = new THREE.BufferGeometry();
        gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setIndex(idx); gg.computeVertexNormals();
        return gg;
      })(),
      pondWalk: bandGeo(walkIn, walkOut, 0.016),
      track: bandGeo(ellipsePoly(tr.at[0], tr.at[1], tr.rx - tr.w / 2, tr.ry - tr.w / 2, 96), ellipsePoly(tr.at[0], tr.at[1], tr.rx + tr.w / 2, tr.ry + tr.w / 2, 96), 0.014),
      trackLine: bandGeo(ellipsePoly(tr.at[0], tr.at[1], tr.rx - 0.05, tr.ry - 0.05, 96), ellipsePoly(tr.at[0], tr.at[1], tr.rx + 0.05, tr.ry + 0.05, 96), 0.018),
      paths: [
        ribbonGeo(smooth([[-3, -22], [-18, -18], [-40, -12], [-58, -8]]), 2.4, 0.016),          // to the picnic lawn and palm C
        ribbonGeo(smooth([[3, -30], [18, -28], [34, -24], [42, -22]]), 2.4, 0.016),             // to the gazebo
        ribbonGeo(smooth([[3, -47.5], [8, -47.5], [10, -47.5]]), 2.4, 0.016),                   // to the kiosk
        ribbonGeo(smooth([[-3, -40], [-16, -40], [-32, -40]]), 2.4, 0.016),                     // to the shade sails
        ribbonGeo(smooth([[26, 56], [36, 62], [46, 66]]), 2.4, 0.016),                          // pond walk to palm B
      ],
    };
  }, []);

  const scatter = useMemo(() => {
    const r = rng(5);
    const free = (x: number, y: number, pad = 0) => {
      if (Math.abs(x) < 10 + pad && y < 26) return false;                                        // the promenade and its palms
      const px = (x - K.pond.at[0]) / (K.pond.rx + 7 + pad), py = (y - K.pond.at[1]) / (K.pond.ry + 7 + pad);
      if (px * px + py * py < 1) return false;                                                   // the pond and its walk
      const t = Math.hypot((x - K.track.at[0]) / K.track.rx, (y - K.track.at[1]) / K.track.ry);
      if (Math.abs(t - 1) < 0.07 + pad / 60) return false;                                       // the jogging loop
      if (Math.hypot(x - K.sails.at[0], y - K.sails.at[1]) < 11 + pad) return false;
      if (Math.hypot(x - K.gazebo.at[0], y - K.gazebo.at[1]) < 8 + pad) return false;
      if (x > 4 && x < 22 && y > -56 && y < -38) return false;                                   // the kiosk and its tables
      if (x < -46 && x > -74 && y > -24 && y < 8) return false;                                  // the picnic lawn
      for (const p of K.palms) if (Math.hypot(x - p[0], y - p[1]) < 5 + pad) return false;
      if ((Math.abs(y + 14) < 3 && x < -3 && x > -60) || (Math.abs(y + 26) < 4 && x > 3 && x < 44)) return false; // side paths
      return Math.abs(x) < 76 && y > -66 && y < 76;
    };
    const pick = (n: number, pad: number, minGap: number) => {
      const out: Vec2[] = [];
      let guard = 0;
      while (out.length < n && guard++ < 4000) {
        const p: Vec2 = [-76 + r() * 152, -66 + r() * 142];
        if (free(p[0], p[1], pad) && out.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > minGap)) out.push(p);
      }
      return out;
    };
    return { trees: pick(22, 2, 9), palms: pick(14, 1, 10), shrubs: pick(34, 0, 4) };
  }, []);

  const els = useMemo(() => {
    const out: JSX.Element[] = [];
    const pr = K.promenade;
    // palms line the promenade (leaving room for Wi-Fi palm A), lamps and benches between them
    for (let y = -66, i = 0; y <= 18; y += 12, i++) {
      if (!(Math.abs(y + 42) < 1)) out.push(<Palm key={`pw${i}`} id={ID} at={[-6.6, y]} i={i} />);
      out.push(<Palm key={`pe${i}`} id={ID} at={[6.6, y]} i={i + 9} />);
    }
    [-60, -36, -12, 12].forEach((y, i) => { out.push(<Lamp key={`lw${i}`} id={ID} at={[-3.9, y + 6]} face={90} />); out.push(<Lamp key={`le${i}`} id={ID} at={[3.9, y - 6]} face={270} />); });
    [-58, -26, -8, 8].forEach((y, i) => out.push(<P key={`bw${i}`} id={ID} name="bench" at={[-4.3, y]} rotY={Math.PI / 2} />));
    [-50, -34, -16, 2].forEach((y, i) => out.push(<P key={`be${i}`} id={ID} name="bench" at={[4.3, y]} rotY={-Math.PI / 2} />));
    [[-3.6, -52], [3.6, -22], [-3.6, 6], [6, 30], [-8, 22]].forEach(([x, y], i) => out.push(<P key={`bin${i}`} id={ID} name="street_bin" at={[x, y]} rotY={i} />));
    // round the pond: benches that look at the water, palms behind them
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const bx = K.pond.at[0] + Math.cos(a) * (K.pond.rx + 3.6), by = K.pond.at[1] + Math.sin(a) * (K.pond.ry + 3.6);
      if (by < K.pond.at[1] - K.pond.ry) continue; // keep the plaza side open
      out.push(<P key={`pb${i}`} id={ID} name="bench" at={[bx, by]} rotY={Math.atan2(K.pond.at[1] - by, K.pond.at[0] - bx) - Math.PI / 2} />);
      out.push(<Palm key={`pp${i}`} id={ID} at={[K.pond.at[0] + Math.cos(a + 0.3) * (K.pond.rx + 8.5), K.pond.at[1] + Math.sin(a + 0.3) * (K.pond.ry + 8.5)]} i={i + 20} s={0.9} />);
    }
    void pr;
    return out;
  }, []);

  const cars = useMemo(() => [[-52, 0, '#e9e7e1'], [-38, 1, '#2d3540'], [-22, 2, '#b9bdc2'], [16, 0, '#7d2b2b'], [34, 1, '#dcd8cf'], [52, 2, '#1d1f22']] as Array<[number, number, string]>, []);

  return (
    <Area id={ID}>
      <WaterDrift />
      {/* the ground: sand and paving round the park, the lawn inside the hedge, the street past the south gate */}
      <mesh position={[0, -0.03, 0]} rotation-x={-Math.PI / 2} material={AMAT.sand()} receiveShadow><planeGeometry args={[1400, 1400]} /></mesh>
      <Ground poly={rectPoly(-80, -70, 80, 80)} y={0} mat={AMAT.grass()} />
      <Ground poly={rectPoly(-130, -86, 130, -76)} y={-0.01} mat={AMAT.asphalt()} />
      <Ground poly={rectPoly(-130, -76, 130, -70.6)} y={0.0} mat={AMAT.paving()} />
      {cars.map(([x, k, c], i) => <P key={`car${i}`} id={ID} name={(['car_sedan', 'car_suv', 'pickup'] as const)[k]} at={[x, -78.3]} h={0} face={90} tint={{ CarPaint: c }} />)}

      {/* paths: the promenade, the plaza at the pond, the walk round the water, the side paths and the jogging loop */}
      <Ground poly={rectPoly(K.promenade.x - K.promenade.w / 2, K.promenade.y0, K.promenade.x + K.promenade.w / 2, K.promenade.y1)} y={0.018} mat={AMAT.paving('#e6dccb')} />
      <Ground poly={ellipsePoly(K.plaza.at[0], K.plaza.at[1], K.plaza.r, K.plaza.r, 40)} y={0.019} mat={AMAT.paving('#eadfcd')} />
      <mesh geometry={g.pondWalk} material={AMAT.paving('#e6dccb')} receiveShadow />
      {g.paths.map((pg, i) => <mesh key={i} geometry={pg} material={AMAT.paving('#e2d6c2')} receiveShadow />)}
      <mesh geometry={g.track} material={AMAT.track()} receiveShadow />
      <mesh geometry={g.trackLine} material={AMAT.flat('#efe9dc', 0.8)} />

      {/* the pond: water inside a stone rim, a low fountain */}
      <Ground poly={g.water} y={0.16} mat={AMAT.water('#2b6a6f')} />
      <mesh geometry={g.rim} material={AMAT.stone('#d2c9b8')} receiveShadow castShadow />
      <mesh geometry={g.rimSide} material={AMAT.stone('#c6bdac')} receiveShadow />
      <group position={[0, 0.16, 0]}>
        <Jets pts={[[K.pond.at[0], K.pond.at[1]], ...Array.from({ length: 6 }, (_, i) => [K.pond.at[0] + Math.cos(i * 1.047) * 3.2, K.pond.at[1] + Math.sin(i * 1.047) * 2.2] as Vec2)]} height={3.2} r={0.14} speed={1.3} phase={0.9} />
      </group>

      {/* the boundary: a clipped hedge with the gate's two stone piers */}
      <Hedge pts={[[-K.gate.w / 2 - 0.6, -70], [-80, -70], [-80, 80], [80, 80], [80, -70], [K.gate.w / 2 + 0.6, -70]]} />
      {[-1, 1].map((s) => <Box key={s} at={[s * (K.gate.w / 2 + 0.2), -70]} size={[0.9, 0.9, 2.6]} mat={AMAT.stone('#d4c9b4')} />)}
      {[-1, 1].map((s) => <mesh key={`cap${s}`} position={L3(s * (K.gate.w / 2 + 0.2), -70, 2.72)} geometry={boxGeo(1.1, 0.24, 1.1)} material={AMAT.stone('#c2b6a0')} castShadow />)}

      {/* the Wi-Fi palms and their access points */}
      {K.palms.map((p, i) => <WifiPalm key={i} at={p} />)}
      {K.palms.map((p, i) => <P key={`ap${i}`} id={ID} name="ap_ceiling" at={p} h={4.62} />)}
      <Ground poly={ellipsePoly(K.palms[1][0], K.palms[1][1], 3.4, 3.4, 28)} y={0.017} mat={AMAT.paving('#e6dccb')} />
      <Ground poly={ellipsePoly(K.palms[2][0], K.palms[2][1], 3.4, 3.4, 28)} y={0.017} mat={AMAT.paving('#e6dccb')} />

      {els}
      {scatter.trees.map((p, i) => <Tree key={`t${i}`} id={ID} at={p} i={i} s={0.9 + (i % 4) * 0.12} />)}
      {scatter.palms.map((p, i) => <Palm key={`sp${i}`} id={ID} at={p} i={i + 40} s={0.85 + (i % 3) * 0.1} />)}
      {scatter.shrubs.map((p, i) => <Shrub key={`s${i}`} at={p} i={i} s={1 + (i % 4) * 0.22} />)}

      {/* the kiosk and its tables */}
      <Box at={[(K.kiosk.x0 + K.kiosk.x1) / 2, (K.kiosk.y0 + K.kiosk.y1) / 2]} size={[K.kiosk.x1 - K.kiosk.x0, K.kiosk.y1 - K.kiosk.y0, K.kiosk.h]} mat={AMAT.plaster('#efe6d6')} />
      <Box at={[12.5, -47.5]} size={[5.6, 5.6, 0.18]} z0={K.kiosk.h} mat={AMAT.timber()} />
      <Box at={[9.86, -47.5]} size={[0.12, 3.2, 1.0]} z0={1.05} mat={AMAT.flat('#20262c', 0.3, 0.4)} shadow={false} />
      <Box at={[9.75, -47.5]} size={[0.5, 3.4, 0.06]} z0={1.0} mat={AMAT.timber()} />
      <Awning at={[10, -47.5]} w={4.4} depth={1.8} h={2.75} face={270} color="#3f6f66" />
      <P id={ID} name="ph_chalkboard" at={[8.6, -44.4]} rotY={0.5} />
      {[[7.0, -52.2], [18.2, -51.5], [18.6, -44.2], [12.5, -41.6]].map(([x, y], i) => <P key={`bs${i}`} id={ID} name="ph_bistro_set" at={[x, y]} rotY={i * 0.8} />)}
      {[[16.2, -50.2], [16.2, -44.8]].map(([x, y], i) => <P key={`kp${i}`} id={ID} name="ph_planter" at={[x, y]} face={90} />)}

      <Sails at={K.sails.at} />
      {[[-42, -38], [-37, -43]].map(([x, y], i) => <P key={`pt${i}`} id={ID} name="ph_picnic_table" at={[x, y]} rotY={i * 0.9} />)}
      <Gazebo at={K.gazebo.at} r={K.gazebo.r} />
      <P id={ID} name="bench" at={[K.gazebo.at[0], K.gazebo.at[1] + 2.4]} h={0.2} rotY={0} />
      {K.picnic.map((p, i) => <P key={`pc${i}`} id={ID} name="ph_picnic_table" at={p} rotY={i * 0.7} />)}
      <P id={ID} name="ph_trash_can" at={[-60, -12]} />
      <P id={ID} name="ph_hose" at={[10.0, -49.6]} h={0.9} face={270} />

      {/* beyond the hedge: the 4G mast and a town's worth of blocks, so the park sits in a neighbourhood */}
      <Mast id={ID} at={[K.mast[0], K.mast[1]]} h={K.mast[2]} az={mast.sectors?.[0].azDeg ?? 0} />
      {([[-130, 30, 30, 44, 16], [-128, -30, 26, 40, 22], [-120, 100, 40, 30, 13], [126, 60, 28, 50, 19], [130, -10, 30, 40, 26], [124, -62, 24, 30, 14],
        [-60, 124, 44, 26, 17], [0, 130, 40, 28, 23], [62, 126, 46, 26, 15], [-70, -112, 46, 24, 18], [-8, -116, 40, 26, 24], [58, -112, 44, 24, 15],
        [190, 120, 40, 40, 34], [-196, 90, 40, 46, 30], [-190, -90, 44, 40, 27], [176, -120, 40, 36, 21]] as number[][]).map(([x, y, sx, sy, h], i) => (
        <Block key={`blk${i}`} at={[x, y]} size={[sx, sy, h]} kind={i} />
      ))}
      {Array.from({ length: 14 }, (_, i) => <Palm key={`rp${i}`} id={ID} at={[-104 + i * 16, -72.6]} i={i + 60} s={0.85} />)}
    </Area>
  );
}
