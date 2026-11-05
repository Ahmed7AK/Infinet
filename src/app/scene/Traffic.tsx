/**
 * Street traffic (scene only, ambience): parked cars along both kerbs and moving cars in one lane each way
 * (right-hand traffic). Moving cars follow the car ahead with the Intelligent Driver Model (Treiber, Hennecke &
 * Helbing 2000: a 1.2 s time gap, 2.5 m standstill gap), stop for anyone on the carriageway and give way at the
 * zebra crossing. Brake lights come on as they slow; wheels turn with the distance driven.
 *
 * The cars are Blender-scripted (tools/blender/build_all.py): one lofted body each, no maker's badge or text.
 * At load, every part except the four wheels is merged per material, so a car costs about a dozen draw calls.
 */
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYOUT } from '../../engine/index';
import { driver } from '../driver';
import { modelUrl } from './assets';
import { CROSSING, crowd } from './crowd';

type CarModel = 'car_sedan' | 'car_suv' | 'pickup';
const WHEEL_R: Record<CarModel, number> = { car_sedan: 0.33, car_suv: 0.37, pickup: 0.38 };
const LENGTH: Record<CarModel, number> = { car_sedan: 4.75, car_suv: 4.88, pickup: 5.3 };
/** Gulf traffic: mostly white, silver and black (paint colours, sRGB) */
export const PAINTS = ['#f3f3f0', '#d7d9dc', '#1d2024', '#f6f5f1', '#8b9199', '#efeee9', '#c9c1b0', '#2c3a4c', '#5d646d', '#ffffff', '#7b1e24', '#e9e7e1'];

// ───────────── one merged template per model ─────────────
interface Template { body: THREE.Mesh[]; wheels: Array<{ name: string; obj: THREE.Object3D }> }
const templates = new Map<string, Template>();
function useTemplate(name: CarModel): Template {
  const { scene } = useGLTF(modelUrl(name));
  let t = templates.get(name);
  if (t) return t;
  scene.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const wheels: Template['wheels'] = [];
  const underWheel = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name.startsWith('Wheel_')) return true; return false; };
  scene.traverse((o) => {
    if (o.name.startsWith('Wheel_') && !underWheel(o.parent!)) {
      const w = o.clone(true);
      w.traverse((m) => { const mm = m as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true; } });
      wheels.push({ name: o.name, obj: w });
    }
    const m = o as THREE.Mesh;
    if (!m.isMesh || underWheel(m)) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const mat = m.material as THREE.Material;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat)!.push(g.index ? g.toNonIndexed() : g);
  });
  const body: THREE.Mesh[] = [];
  for (const [mat, gs] of byMat) {
    const mesh = new THREE.Mesh(mergeGeometries(gs)!, mat);
    mesh.castShadow = !(mat as THREE.MeshStandardMaterial).transparent;
    mesh.receiveShadow = true;
    body.push(mesh);
  }
  t = { body, wheels };
  templates.set(name, t);
  return t;
}

/** a car from its template: its own clear-coated paint and its own tail-light material (for the brake lights) */
function useCar(name: CarModel, paint: string) {
  const t = useTemplate(name);
  return useMemo(() => {
    const root = new THREE.Group();
    let tail: THREE.MeshStandardMaterial | null = null;
    for (const m of t.body) {
      const src = m.material as THREE.MeshStandardMaterial;
      let mat: THREE.Material = src;
      if (src.name === 'CarPaint') {
        const dark = new THREE.Color(paint).getHSL({ h: 0, s: 0, l: 0 }).l < 0.3;
        mat = new THREE.MeshPhysicalMaterial({ color: paint, metalness: dark ? 0.5 : 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.1 });
      } else if (src.name === 'TailLight') {
        tail = src.clone(); mat = tail;
      } else if (src.name === 'CarGlass') {
        mat = new THREE.MeshPhysicalMaterial({ color: '#0b0e10', metalness: 0.2, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4 });
      }
      const c = new THREE.Mesh(m.geometry, mat);
      c.castShadow = m.castShadow; c.receiveShadow = true;
      root.add(c);
    }
    const wheels = t.wheels.map((w) => { const c = w.obj.clone(true); root.add(c); return c; });
    return { root, wheels, tail: tail as THREE.MeshStandardMaterial | null };
  }, [t, paint]);
}

/** rotation.y that turns a model whose forward is three +Z toward compass heading `deg` */
const faceCompass = (deg: number) => ((180 - deg) * Math.PI) / 180;

// ───────────── parked cars ─────────────
function Parked({ model, at, heading, paint }: { model: CarModel; at: [number, number]; heading: number; paint: string }) {
  const car = useCar(model, paint);
  return <primitive object={car.root} position={[at[0], 0, -at[1]]} rotation-y={faceCompass(heading)} />;
}

/** kerbside parking (engine coords), clear of the crossing, the hydrants and the bus stop */
const WEST_KERB = 9.8, EAST_KERB = 22.2; // clear of the lamp posts standing at the road edge
const PARKED: Array<{ model: CarModel; y: number; side: 'w' | 'e' }> = [
  ...[30, 21.5, -21, -29.5, -62, -70.5, -100, -108.5, -150, -158.5, -186, -212].map((y, i) => ({ model: (i % 3 === 1 ? 'car_suv' : 'car_sedan') as CarModel, y, side: 'w' as const })),
  ...[25, 16.5, -18, -26.5, -110, -118.5, -142, -166, -174.5, -205].map((y, i) => ({ model: (i % 3 === 0 ? 'car_suv' : i === 4 ? 'pickup' : 'car_sedan') as CarModel, y, side: 'e' as const })),
];
export function ParkedCars() {
  return (
    <>
      {PARKED.map((p, i) => (
        <Parked key={i} model={p.model} at={[p.side === 'w' ? WEST_KERB : EAST_KERB, p.y]} heading={p.side === 'w' ? 180 : 0} paint={PAINTS[(i * 5 + 3) % PAINTS.length]} />
      ))}
    </>
  );
}

// ───────────── moving traffic ─────────────
const [[, RY0], [, RY1]] = LAYOUT.street.road;
/** the cars run past both ends of the modelled street (the road is drawn on to these ends) and wrap round */
export const ROAD_VIS = { y0: RY0 - 180, y1: RY1 + 260 };
const LANES = [
  { x: 13.3, dir: -1 as const },  // southbound, the lane nearer the café
  { x: 18.7, dir: 1 as const },   // northbound
];
const SPAN = ROAD_VIS.y1 - ROAD_VIS.y0;
const IDM = { a: 1.4, b: 2.2, s0: 2.5, T: 1.2 };

interface Car { model: CarModel; paint: string; lane: number; s: number; v: number; v0: number; len: number; brake: number }
function seededCars(): Car[] {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out: Car[] = [];
  const models: CarModel[] = ['car_sedan', 'car_suv', 'car_sedan', 'car_sedan', 'car_suv', 'pickup', 'car_sedan'];
  LANES.forEach((_, lane) => {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const model = models[(i + lane * 3) % models.length];
      out.push({ model, paint: PAINTS[Math.floor(rnd() * PAINTS.length)], lane, s: (i + rnd() * 0.5) * (SPAN / n), v: 9, v0: 9 + rnd() * 3.5, len: LENGTH[model], brake: 0 });
    }
  });
  return out;
}

/** engine y of a car's centre from its distance along the lane */
const laneY = (dir: 1 | -1, s: number) => (dir > 0 ? ROAD_VIS.y0 + s : ROAD_VIS.y1 - s);
/** distance along the lane of an engine y */
const laneS = (dir: 1 | -1, y: number) => (dir > 0 ? y - ROAD_VIS.y0 : ROAD_VIS.y1 - y);

function MovingCar({ c, refOut }: { c: Car; refOut: (g: { root: THREE.Object3D; wheels: THREE.Object3D[]; tail: THREE.MeshStandardMaterial | null } | null) => void }) {
  const car = useCar(c.model, c.paint);
  refOut(car);
  return <primitive object={car.root} />;
}

export function Traffic() {
  const cars = useMemo(seededCars, []);
  const objs = useRef<Array<{ root: THREE.Object3D; wheels: THREE.Object3D[]; tail: THREE.MeshStandardMaterial | null } | null>>([]);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const player = driver.snap.player.pos;
    // obstacles in each lane, as distances along it: anyone standing in the lane (always braked for), and the
    // stop line 2 m before the zebra while someone is on it or waiting at the kerb (only if the car can stop)
    const people: Array<readonly [number, number]> = [...crowd.onRoad.values()];
    if (player[0] > LAYOUT.street.road[0][0] - 0.3 && player[0] < LAYOUT.street.road[1][0] + 0.3) people.push([player[0], player[1]]);
    const obstacles = LANES.map((ln) => {
      const o: Array<{ s: number; line: boolean }> = [];
      for (const p of people) if (Math.abs(p[0] - ln.x) < 2.8) o.push({ s: laneS(ln.dir, p[1]), line: false });
      if (crowd.request || crowd.onRoad.size > 0) {
        const yStop = ln.dir > 0 ? CROSSING.y - CROSSING.half - 2 : CROSSING.y + CROSSING.half + 2;
        o.push({ s: laneS(ln.dir, yStop), line: true });
      }
      return o;
    });
    // per lane: sort by distance along the lane, then IDM against the car ahead (wrapping) or the nearest obstacle
    let clear = true;
    LANES.forEach((ln, li) => {
      const mine = cars.map((c, i) => ({ c, i })).filter((e) => e.c.lane === li).sort((a, b) => a.c.s - b.c.s);
      mine.forEach((e, k) => {
        const c = e.c;
        const ahead = mine[(k + 1) % mine.length].c;
        let gap = ((ahead.s - c.s + SPAN) % SPAN) - (ahead.len + c.len) / 2;
        let dvLead = c.v - ahead.v;
        const front = c.s + c.len / 2;
        for (const o of obstacles[li]) {
          // a person: keep 1.5 m short of them; the stop line: stop at it, unless it is already closer than a
          // firm stop (4 m/s²) allows, in which case the car carries on through before anyone steps out
          const g = o.s - front - (o.line ? 0 : 1.5);
          if (g < -0.5 || g >= gap) continue;
          if (o.line && g < (c.v * c.v) / (2 * 4) && c.v > 1) continue;
          gap = Math.max(0.01, g); dvLead = c.v;
        }
        const sStar = IDM.s0 + Math.max(0, c.v * IDM.T + (c.v * dvLead) / (2 * Math.sqrt(IDM.a * IDM.b)));
        let acc = IDM.a * (1 - Math.pow(c.v / c.v0, 4) - Math.pow(sStar / Math.max(gap, 0.1), 2));
        acc = Math.max(-7.5, acc);
        c.v = Math.max(0, c.v + acc * dt);
        c.s = (c.s + c.v * dt) % SPAN;
        c.brake += ((acc < -0.6 || c.v < 0.5 ? 1 : 0) - c.brake) * (1 - Math.exp(-dt * 10));
        // a car within 30 m of the crossing that is still moving makes the crossing unsafe to start
        const yFront = laneY(ln.dir, front);
        const toLine = ln.dir > 0 ? (CROSSING.y - CROSSING.half) - yFront : yFront - (CROSSING.y + CROSSING.half);
        const onZebra = Math.abs(laneY(ln.dir, c.s) - CROSSING.y) < CROSSING.half + c.len / 2;
        if (onZebra || (toLine > -0.5 && toLine < 30 && c.v > 0.8)) clear = false;
        const o = objs.current[e.i];
        if (!o) return;
        o.root.position.set(ln.x, 0, -laneY(ln.dir, c.s));
        o.root.rotation.y = faceCompass(ln.dir > 0 ? 0 : 180);
        const spin = (c.v * dt) / WHEEL_R[c.model];
        for (const w of o.wheels) w.rotation.x += spin;
        if (o.tail) o.tail.emissiveIntensity = 0.5 + 2.6 * c.brake;
      });
    });
    crowd.crossingClear = clear;
  });
  return (
    <>
      {cars.map((c, i) => <MovingCar key={i} c={c} refOut={(g) => { objs.current[i] = g; }} />)}
    </>
  );
}
