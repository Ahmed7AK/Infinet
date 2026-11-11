/**
 * The metro station (11 Nov): a forecourt with palms and a bus stop, and a station under one long metal vault:
 * a glass front, the concourse, the fare gates, a platform behind screen doors and two tracks with trains. Its
 * networks are four sign-in Wi-Fi access points, two indoor 5G antennas (DAS) under the vault and a 5G mast across
 * the road that the metal shell blocks. Geometry from src/engine/world/areas.ts (METRO).
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type JSX } from 'react';
import * as THREE from 'three';
import { LAYOUT, METRO, type Vec2 } from '../../../engine/index';
import { AMAT, Area, Block, Box, boxGeo, Cyl, GlassTower, Ground, Hedge, HideInVision, L3, Lamp, Mast, P, Palm, rectPoly } from './kit';

const ID = 'metro' as const;
const M = METRO, ST = METRO.station;
const WALL_H = 6;
const CY = (ST.y0 + ST.y1) / 2, SPAN = (ST.y1 - ST.y0) / 2;

/** a strip of the vault between x0 and x1: half an ellipse from the top of one side wall to the other */
function vaultGeo(x0: number, x1: number, r: number, rise: number, n = 32): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.PI, y = CY + Math.cos(th) * r, z = WALL_H + Math.sin(th) * rise;
    pos.push(x0, z, -y, x1, z, -y);
    uv.push(0, (i / n) * 60, x1 - x0, (i / n) * 60);
    if (i < n) { const k = 2 * i; idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** a five-car train: pale body, a dark window band, a teal stripe, lit doors */
function TrainSet() {
  const els = useMemo(() => {
    const out: JSX.Element[] = [];
    const body = AMAT.flat('#e9ebed', 0.35, 0.45), band = AMAT.flat('#18222b', 0.1, 0.7), stripe = AMAT.flat('#1f8a8a', 0.5, 0.2);
    for (let c = 0; c < 5; c++) {
      const x = (c - 2) * 18.4;
      out.push(<mesh key={`b${c}`} position={[x, 2.2, 0]} geometry={boxGeo(17.8, 3.3, 2.8)} material={body} castShadow />);
      out.push(<mesh key={`w${c}`} position={[x, 2.75, 0]} geometry={boxGeo(16.6, 0.95, 2.84)} material={band} />);
      out.push(<mesh key={`s${c}`} position={[x, 1.75, 0]} geometry={boxGeo(17.82, 0.16, 2.83)} material={stripe} />);
      out.push(<mesh key={`u${c}`} position={[x, 0.36, 0]} geometry={boxGeo(15, 0.5, 2.2)} material={AMAT.frame()} />);
      for (const dx of [-5.4, 0, 5.4]) out.push(<mesh key={`d${c}${dx}`} position={[x + dx, 2.05, 0]} geometry={boxGeo(1.5, 2.1, 2.86)} material={AMAT.glow('#dff3f5', 0.35)} />);
    }
    return out;
  }, []);
  return <>{els}</>;
}

/** the far track's train: runs in, waits at the platform, runs out */
function MovingTrain({ y }: { y: number }) {
  const ref = useRef<THREE.Group>(null);
  const t = useRef(6);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    t.current = (t.current + Math.min(dt, 0.1)) % 46;
    const u = t.current;
    const ease = (k: number) => k * k * (3 - 2 * k);
    // 0–10 s arriving from the west, 10–26 s at the platform, 26–36 s leaving east, then away
    const x = u < 10 ? -330 + 330 * ease(u / 10) : u < 26 ? 0 : u < 36 ? 330 * ((u - 26) / 10) ** 2 : 400;
    g.position.x = x;
    g.visible = u < 36;
  });
  return <group ref={ref} position={[0, 0, -y]}><TrainSet /></group>;
}

function Shell() {
  const g = useMemo(() => ({
    skin: vaultGeo(ST.x0 - 1.5, ST.x1 + 1.5, SPAN + 0.5, ST.h - WALL_H),
    ribs: Array.from({ length: 12 }, (_, i) => { const x = ST.x0 + 5 + i * ((ST.x1 - ST.x0 - 10) / 11); return vaultGeo(x - 0.22, x + 0.22, SPAN + 0.3, ST.h - WALL_H - 0.25); }),
    gable: (() => {
      const s = new THREE.Shape();
      for (let i = 0; i <= 32; i++) { const th = (i / 32) * Math.PI; const x = Math.cos(th) * SPAN, y = Math.sin(th) * (ST.h - WALL_H); if (i === 0) s.moveTo(x, y); else s.lineTo(x, y); }
      return new THREE.ShapeGeometry(s);
    })(),
  }), []);
  const mats = useMemo(() => ({
    skin: new THREE.MeshStandardMaterial({ color: '#c9ae70', roughness: 0.36, metalness: 0.78, side: THREE.DoubleSide, envMapIntensity: 1.1 }),
    rib: new THREE.MeshStandardMaterial({ color: '#f1ece0', roughness: 0.6, side: THREE.DoubleSide }),
    gable: new THREE.MeshPhysicalMaterial({ color: '#7f9aa6', roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.72, side: THREE.DoubleSide, envMapIntensity: 1.3 }),
  }), []);
  return (
    <HideInVision>
      <mesh geometry={g.skin} material={mats.skin} castShadow receiveShadow />
      {g.ribs.map((r, i) => <mesh key={i} geometry={r} material={mats.rib} />)}
      {[ST.x0, ST.x1].map((x) => <mesh key={x} position={[x, WALL_H, -CY]} rotation-y={Math.PI / 2} geometry={g.gable} material={mats.gable} />)}
      {/* light lines along the vault */}
      {[0.5, 0.3, 0.7].map((f) => {
        const th = f * Math.PI;
        return <mesh key={f} position={[0, WALL_H + Math.sin(th) * (ST.h - WALL_H) - 0.35, -(CY + Math.cos(th) * SPAN)]} geometry={boxGeo(ST.x1 - ST.x0 - 6, 0.08, 0.35)} material={AMAT.glow('#fff4e0', 1.6)} />;
      })}
    </HideInVision>
  );
}

export function Metro() {
  const mast = LAYOUT.transmitters.find((t) => t.id === 'cellA-metro')!;
  const W = ST.x1 - ST.x0;

  const walls = useMemo(() => {
    const out: JSX.Element[] = [];
    const metal = AMAT.flat('#b7bcc2', 0.42, 0.7), frame = AMAT.frame(), glass = AMAT.glass();
    // the glass front, either side of the doors, with mullions and a head beam; a canopy over the doors
    for (const [a, b] of [[ST.x0, M.door.x0], [M.door.x1, ST.x1]]) {
      out.push(<mesh key={`fg${a}`} position={L3((a + b) / 2, ST.y0, WALL_H / 2)} geometry={boxGeo(b - a, WALL_H, 0.05)} material={glass} />);
      const n = Math.round((b - a) / 3.05);
      for (let i = 0; i <= n; i++) out.push(<Box key={`fm${a}-${i}`} at={[a + ((b - a) * i) / n, ST.y0]} size={[0.14, 0.2, WALL_H]} mat={frame} />);
      out.push(<Box key={`fr${a}`} at={[(a + b) / 2, ST.y0]} size={[b - a, 0.2, 0.16]} z0={3.0} mat={frame} shadow={false} />);
    }
    out.push(<Box key="head" at={[0, ST.y0]} size={[W, 0.5, 0.5]} z0={WALL_H - 0.5} mat={metal} />);
    out.push(<Box key="plinth" at={[-34.5, ST.y0]} size={[61, 0.3, 0.3]} mat={metal} shadow={false} />);
    out.push(<Box key="plinth2" at={[34.5, ST.y0]} size={[61, 0.3, 0.3]} mat={metal} shadow={false} />);
    out.push(<Box key="lintel" at={[0, ST.y0]} size={[8, 0.3, 0.35]} z0={3.0} mat={AMAT.flat('#1f8a8a', 0.5, 0.3)} />);
    out.push(<Box key="canopy" at={[0, ST.y0 - 2.4]} size={[16, 5, 0.22]} z0={3.6} mat={AMAT.flat('#e7e3d8', 0.5, 0.3)} />);
    out.push(<Box key="canopyL" at={[0, ST.y0 - 2.4]} size={[12, 0.3, 0.05]} z0={3.54} mat={AMAT.glow('#fff1d6', 1.1)} shadow={false} />);
    // the back wall and the two ends (each end open where the tracks pass)
    out.push(<Box key="back" at={[0, ST.y1]} size={[W, 0.35, WALL_H]} mat={metal} />);
    for (const x of [ST.x0, ST.x1]) {
      out.push(<Box key={`e1${x}`} at={[x, (ST.y0 + 26.4) / 2]} size={[0.35, 26.4 - ST.y0, WALL_H]} mat={metal} />);
      out.push(<Box key={`e2${x}`} at={[x, (34.6 + ST.y1) / 2]} size={[0.35, ST.y1 - 34.6, WALL_H]} mat={metal} />);
      out.push(<Box key={`e3${x}`} at={[x, 30.5]} size={[0.35, 8.2, WALL_H - 4.6]} z0={4.6} mat={metal} />);
    }
    // the fare line: glass either side, cabinets between the three lanes, a lit strip over them
    for (const [a, b] of [[ST.x0, -7], [7, ST.x1]]) {
      out.push(<mesh key={`gl${a}`} position={L3((a + b) / 2, M.gateY, 1.15)} geometry={boxGeo(b - a, 2.1, 0.03)} material={glass} />);
      out.push(<Box key={`gt${a}`} at={[(a + b) / 2, M.gateY]} size={[b - a, 0.07, 0.06]} z0={2.2} mat={frame} shadow={false} />);
      for (let x = a; x <= b + 0.01; x += (b - a) / 20) out.push(<Box key={`gp${a}-${x.toFixed(1)}`} at={[x, M.gateY]} size={[0.07, 0.07, 2.2]} mat={frame} shadow={false} />);
    }
    const edges = [-7, ...M.lanes.flat(), 7];
    for (let i = 0; i < edges.length; i += 2) {
      const a = edges[i], b = edges[i + 1];
      out.push(<Box key={`cab${i}`} at={[(a + b) / 2, M.gateY]} size={[b - a, 1.5, 1.05]} mat={AMAT.flat('#d9dcdf', 0.35, 0.6)} />);
      out.push(<Box key={`cabt${i}`} at={[(a + b) / 2, M.gateY - 0.5]} size={[b - a - 0.2, 0.3, 0.03]} z0={1.05} mat={AMAT.glow('#3ad6a3', 1.0)} shadow={false} />);
    }
    out.push(<Box key="gsign" at={[0, M.gateY]} size={[14, 0.12, 0.5]} z0={3.0} mat={AMAT.flat('#14323a', 0.5)} shadow={false} />);
    out.push(<Box key="gsignL" at={[0, M.gateY - 0.07]} size={[13.4, 0.02, 0.26]} z0={3.12} mat={AMAT.glow('#67E8F9', 0.9)} shadow={false} />);
    // platform screen doors on both platforms: glass, posts, a door every 6 m with a lit header
    for (const y of [M.psdY, M.farPlatform.y0]) {
      out.push(<mesh key={`psd${y}`} position={L3(0, y, 1.2)} geometry={boxGeo(W, 2.4, 0.04)} material={glass} />);
      out.push(<Box key={`psdh${y}`} at={[0, y]} size={[W, 0.2, 0.3]} z0={2.4} mat={AMAT.flat('#e7e9ea', 0.4, 0.5)} shadow={false} />);
      for (let x = ST.x0 + 2, i = 0; x < ST.x1; x += 6, i++) {
        out.push(<Box key={`psp${y}-${i}`} at={[x, y]} size={[0.16, 0.14, 2.4]} mat={frame} shadow={false} />);
        out.push(<Box key={`psq${y}-${i}`} at={[x + 2, y]} size={[0.16, 0.14, 2.4]} mat={frame} shadow={false} />);
        out.push(<Box key={`psl${y}-${i}`} at={[x + 1, y - 0.11]} size={[1.8, 0.02, 0.12]} z0={2.46} mat={AMAT.glow('#3ad6a3', 1.2)} shadow={false} />);
      }
    }
    return out;
  }, [W]);

  const inside = useMemo(() => {
    const out: JSX.Element[] = [];
    // ticket machines along the front, benches and bins on the platform, a help desk
    [-22, -20.4, -18.8, 18.8, 20.4, 22].forEach((x, i) => {
      out.push(<Box key={`tm${i}`} at={[x, ST.y0 + 0.75]} size={[1.1, 0.7, 1.9]} mat={AMAT.flat('#1f8a8a', 0.5, 0.2)} />);
      out.push(<Box key={`ts${i}`} at={[x, ST.y0 + 1.11]} size={[0.6, 0.02, 0.5]} z0={1.05} mat={AMAT.glow('#cfe9f5', 0.9)} shadow={false} />);
    });
    [-52, -40, -18, 18, 40, 52].forEach((x, i) => out.push(<P key={`pb${i}`} id={ID} name="bench" at={[x, 20.2]} face={0} />));
    [-46, -12, 12, 46].forEach((x, i) => out.push(<P key={`bin${i}`} id={ID} name="street_bin" at={[x, 18.6]} rotY={i} />));
    [-48, -24, 24, 48].forEach((x, i) => out.push(<P key={`fb${i}`} id={ID} name="bench" at={[x, 40]} face={180} />));
    [-40, 40].forEach((x, i) => out.push(<P key={`pl${i}`} id={ID} name="ph_plant_tall" at={[x, 11.4]} rotY={i} />));
    out.push(<Box key="desk" at={[-34, 13]} size={[4.2, 1.2, 1.05]} mat={AMAT.flat('#e7e3d8', 0.5)} />);
    out.push(<Box key="deskt" at={[-34, 13]} size={[4.4, 1.4, 0.06]} z0={1.05} mat={AMAT.timber()} />);
    return out;
  }, []);

  const outside = useMemo(() => {
    const out: JSX.Element[] = [];
    for (let i = 0; i < 9; i++) {
      const x = -64 + i * 16;
      if (Math.abs(x) > 9) out.push(<Palm key={`p1${i}`} id={ID} at={[x, 4]} i={i} />);
      out.push(<Palm key={`p2${i}`} id={ID} at={[x + 8, -40.5]} i={i + 9} s={0.9} />);
    }
    [-54, -30, 30, 54].forEach((x, i) => {
      out.push(<P key={`b${i}`} id={ID} name="bench" at={[x, -8]} face={i < 2 ? 90 : 270} />);
      out.push(<Lamp key={`l${i}`} id={ID} at={[x + (i < 2 ? -3 : 3), -22]} face={i < 2 ? 90 : 270} />);
      out.push(<P key={`pt${i}`} id={ID} name="ph_planter" at={[x, -30]} face={0} />);
    });
    [[-9, -6], [9, -6], [-9, -30], [9, -30]].forEach(([x, y], i) => out.push(<Lamp key={`cl${i}`} id={ID} at={[x, y]} face={x < 0 ? 90 : 270} />));
    [-6, -3, 3, 6].forEach((x, i) => out.push(<P key={`bo${i}`} id={ID} name="bollard" at={[x, -41.5]} />));
    [[-12, 2], [12, 2], [24, -34]].forEach(([x, y], i) => out.push(<P key={`bn${i}`} id={ID} name="street_bin" at={[x, y]} rotY={i} />));
    return out;
  }, []);

  const cars = useMemo(() => [[-90, 1, '#e9e2c8'], [-58, 0, '#e9e2c8'], [-20, 0, '#2d3540'], [22, 2, '#b9bdc2'], [64, 0, '#e9e2c8'], [104, 1, '#7d2b2b']] as Array<[number, number, string]>, []);

  return (
    <Area id={ID}>
      <mesh position={[0, -0.03, 0]} rotation-x={-Math.PI / 2} material={AMAT.sand()} receiveShadow><planeGeometry args={[1600, 1600]} /></mesh>
      {/* the forecourt, the pavement and the road past it */}
      <Ground poly={rectPoly(M.plaza.x0, M.plaza.y0, M.plaza.x1, M.plaza.y1)} y={0.012} mat={AMAT.paving('#e6dccb')} />
      <Ground poly={rectPoly(-3, M.plaza.y0, 3, M.plaza.y1)} y={0.016} mat={AMAT.paving('#cdbfa6')} />
      <Ground poly={rectPoly(-260, -50, 260, M.plaza.y0 - 0.6)} y={0.0} mat={AMAT.paving()} />
      <Ground poly={rectPoly(-260, -64, 260, -50)} y={-0.01} mat={AMAT.asphalt()} />
      <Ground poly={rectPoly(-260, -57.1, 260, -56.9)} y={0.0} mat={AMAT.flat('#e9e6dc', 0.7)} />
      {cars.map(([x, k, c], i) => <P key={`car${i}`} id={ID} name={(['car_sedan', 'car_suv', 'pickup'] as const)[k]} at={[x, i % 2 ? -60 : -53.6]} h={0} face={i % 2 ? 270 : 90} tint={{ CarPaint: c }} />)}
      <P id={ID} name="bus_shelter" at={[40, -47]} h={0} face={180} />
      <Hedge pts={[[M.plaza.x0, M.plaza.y1], [M.plaza.x0, M.plaza.y0], [M.plaza.x1, M.plaza.y0], [M.plaza.x1, M.plaza.y1]]} h={0.9} w={1.0} />
      {outside}

      {/* the station: floors, the track bed and rails (they run on east and west), the walls and the vault */}
      <Ground poly={rectPoly(ST.x0, ST.y0, ST.x1, 26.4)} y={0.014} mat={AMAT.terrazzo()} />
      <Ground poly={rectPoly(ST.x0, 34.6, ST.x1, ST.y1)} y={0.014} mat={AMAT.terrazzo()} />
      <Ground poly={rectPoly(ST.x0, 25.2, ST.x1, 25.5)} y={0.018} mat={AMAT.flat('#e2b93b', 0.7)} />
      <Ground poly={rectPoly(ST.x0, 35.5, ST.x1, 35.8)} y={0.018} mat={AMAT.flat('#e2b93b', 0.7)} />
      <Ground poly={rectPoly(-420, 26.4, 420, 34.6)} y={0.004} mat={AMAT.flat('#4a4743', 1)} />
      {M.tracks.flatMap((y) => [-0.72, 0.72].map((d) => <Box key={`r${y}${d}`} at={[0, y + d]} size={[840, 0.08, 0.16]} mat={AMAT.steel()} shadow={false} />))}
      {[-1, 1].map((s) => <Hedge key={`th${s}`} pts={[[s * 68, 24.6], [s * 420, 24.6]]} h={1.2} w={0.8} />)}
      {walls}
      <Shell />
      {inside}
      <group position={[0, 0, -M.tracks[0]]}><TrainSet /></group>
      <MovingTrain y={M.tracks[1]} />
      <pointLight position={L3(-36, 22, 9)} intensity={70} distance={60} decay={2} color="#fff0dc" />
      <pointLight position={L3(36, 22, 9)} intensity={70} distance={60} decay={2} color="#fff0dc" />
      <pointLight position={L3(0, 16, 8)} intensity={70} distance={60} decay={2} color="#fff0dc" />

      {/* the networks: Wi-Fi access points and the indoor 5G antennas hang from the vault; the mast is across the road */}
      {M.aps.map((p, i) => (
        <group key={`ap${i}`}>
          <P id={ID} name="ap_ceiling" at={[p[0], p[1]]} h={p[2]} />
          <Cyl at={[p[0], p[1]]} r={0.02} h={2.2} z0={p[2] + 0.05} mat={AMAT.frame()} seg={6} shadow={false} />
        </group>
      ))}
      {M.das.map((p, i) => (
        <group key={`das${i}`}>
          <Cyl at={[p[0], p[1]]} r={0.26} r2={0.2} h={0.1} z0={p[2] - 0.1} mat={AMAT.flat('#f4f5f3', 0.5)} seg={20} shadow={false} />
          <Cyl at={[p[0], p[1]]} r={0.025} h={3} z0={p[2]} mat={AMAT.frame()} seg={6} shadow={false} />
          <Cyl at={[p[0], p[1]]} r={0.27} h={0.02} z0={p[2] - 0.13} mat={AMAT.glow('#67E8F9', 1.2)} seg={20} shadow={false} />
        </group>
      ))}
      <Mast id={ID} at={[M.mast[0], M.mast[1]]} h={M.mast[2]} az={mast.sectors?.[0].azDeg ?? 0} />

      {/* the town round the station */}
      {([[-130, -100, 50, 36, 22], [-60, -104, 44, 30, 16], [10, -108, 50, 34, 28], [84, -102, 46, 30, 19], [150, -96, 40, 40, 24],
        [-150, 90, 60, 40, 20], [-70, 96, 50, 36, 26], [10, 100, 56, 34, 18], [90, 94, 50, 38, 30], [170, 90, 50, 40, 21],
        [-190, -10, 40, 60, 18], [196, -20, 44, 60, 25]] as number[][]).map(([x, y, sx, sy, h], i) => <Block key={`blk${i}`} at={[x, y]} size={[sx, sy, h]} kind={i + 2} />)}
      {([[-240, 170, 34, 34, 120], [-120, 200, 30, 30, 160], [40, 210, 36, 30, 110], [180, 190, 32, 32, 180], [300, 120, 34, 34, 140], [-320, 60, 34, 30, 130]] as number[][]).map(([x, y, sx, sy, h], i) => (
        <GlassTower key={`gt${i}`} at={[x, y] as Vec2} size={[sx, sy, h]} tone={i} rot={i * 0.3} />
      ))}
    </Area>
  );
}
