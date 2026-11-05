/**
 * The realistic world (plan §6, D3, D9). Every wall that affects radio comes from src/world/layout.json, at its
 * real height and material, so what you see is what the propagation model uses. Furniture and street clutter are
 * Poly Haven models (CC0); network hardware, cars, palms and lamps are the Blender-scripted GLBs. Grounded realism, restrained palette (P9): the network layer is the only loud thing.
 * Ambience that moves (traffic, people, fans, palms in the wind, the windsock) is scene-only: the engine never sees it.
 */
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type JSX } from 'react';
import * as THREE from 'three';
import { geoLookAngle, LAYOUT, PARAMS, type Vec2 } from '../../engine/index';
import { useUi } from '../driver';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boxGeo, floorGeo, MAT, modelUrl, useModel, type ModelName } from './assets';
import { MEETING, People, SHELTER } from './Character';
import { CROSSING } from './crowd';
import { screenMaterials, screenUVs } from './screens';
import { ParkedCars, ROAD_VIS, Traffic } from './Traffic';
import { camOccluders } from './vision';

const P = LAYOUT.props;
const yawFromCompass = (deg: number) => (-deg * Math.PI) / 180; // +Z-forward models facing compass `deg` need π offset (see `faceCompass`)
/** rotation.y that turns a model whose forward is three +Z (south) toward compass heading `deg` */
export const faceCompass = (deg: number) => ((180 - deg) * Math.PI) / 180;

function Prop({ name, at, rotY = 0, scale = 1, tint, occluder, part }: { name: ModelName; at: [number, number, number]; rotY?: number; scale?: number; tint?: Record<string, string>; occluder?: { y: number; r: number; h?: number }; part?: string }) {
  const obj = useModel(name, { tint, part });
  useEffect(() => {
    if (!occluder) return;
    const e = { obj, x: at[0], y: at[1] + occluder.y * scale, z: at[2], r: occluder.r * scale, h: occluder.h === undefined ? undefined : occluder.h * scale };
    camOccluders.add(e);
    return () => { camOccluders.delete(e); };
  }, [obj, at[0], at[1], at[2], scale]);  
  return <primitive object={obj} position={at} rotation-y={rotY} scale={scale} />;
}

// ───────────── walls (RF truth) ─────────────
function Walls() {
  const items = useMemo(() => {
    const mats = {
      glass: MAT.glassLowE(), clear: MAT.glassClear(), paint: MAT.paint(), concrete: MAT.paint('#d9d6cf'), brick: MAT.paint('#c9a58a'),
      metal: MAT.frame(), frame: MAT.frame(),
    };
    const out: JSX.Element[] = [];
    LAYOUT.walls.forEach((w, i) => {
      if (w.door || w.zone === 'desert') return;
      const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
      const len = Math.hypot(dx, dy);
      const isGlass = w.material.includes('glass');
      const thick = isGlass ? 0.06 : w.material === 'concrete' ? 0.25 : w.material === 'brick' ? 0.25 : 0.12;
      const h = w.rfIgnore ? 1.05 : w.h;
      const m = w.material === 'lowE_glass' ? mats.glass : w.material === 'clear_glass' ? mats.clear : w.material === 'concrete' ? mats.concrete : w.material === 'brick' ? mats.brick : w.material === 'metal' ? mats.metal : mats.paint;
      const mid: [number, number, number] = [(w.a[0] + w.b[0]) / 2, h / 2, -(w.a[1] + w.b[1]) / 2];
      const rot = Math.atan2(dy, dx);
      out.push(
        <mesh key={`w${i}`} position={mid} rotation-y={rot} geometry={boxGeo(len + (isGlass ? 0 : thick), h, thick)} material={m} castShadow={!isGlass} receiveShadow />,
      );
      if (isGlass) {
        // mullions every 1.5 m and a head/sill frame: glass walls read as glass walls
        const n = Math.max(1, Math.round(len / 1.5));
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          out.push(<mesh key={`m${i}-${k}`} position={[w.a[0] + dx * t, h / 2, -(w.a[1] + dy * t)]} rotation-y={rot} geometry={boxGeo(0.06, h, 0.1)} material={mats.frame} castShadow />);
        }
        out.push(<mesh key={`h${i}`} position={[mid[0], h - 0.04, mid[2]]} rotation-y={rot} geometry={boxGeo(len, 0.08, 0.12)} material={mats.frame} />);
        out.push(<mesh key={`s${i}`} position={[mid[0], 0.04, mid[2]]} rotation-y={rot} geometry={boxGeo(len, 0.08, 0.12)} material={mats.frame} />);
      }
    });
    return out;
  }, []);
  return <>{items}</>;
}

// ───────────── buildings above the RF floor ─────────────
function polyBounds(poly: Vec2[]) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** a window frame (four bars, a centre mullion) and a sill, merged, for a w × h opening; +Z is outward */
function frameGeo(w: number, h: number) {
  const t = 0.07, d = 0.1;
  const bar = (sx: number, sy: number, sz: number, x: number, y: number, z = 0) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
  return mergeGeometries([
    bar(w + 2 * t, t, d, 0, h / 2 + t / 2), bar(w + 2 * t, t, d, 0, -h / 2 - t / 2),
    bar(t, h, d, -w / 2 - t / 2, 0), bar(t, h, d, w / 2 + t / 2, 0),
    bar(0.045, h, d * 0.8, 0, 0),
    bar(w + 0.3, 0.05, 0.2, 0, -h / 2 - t - 0.025, 0.05), // sill
  ])!;
}
// glass tints per pane: mostly sky-reflecting grey-blue, a few with pale blinds down (multiplied into the glass)
const PANE_TINTS = ['#9fb3bf', '#8aa0ad', '#b4c3cb', '#7c909c', '#d9d4c6', '#a9b8bf', '#e6e0d0'].map((c) => new THREE.Color(c));

/** façade windows (glass, frame and sill) as instanced meshes per building */
function Windows({ b, fromZ, toZ, floorH = 3.4, every = 3, w = 1.6, h = 1.9 }: { b: ReturnType<typeof polyBounds>; fromZ: number; toZ: number; floorH?: number; every?: number; w?: number; h?: number }) {
  const meshes = useMemo(() => {
    const mats: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const sides: Array<{ a: Vec2; b: Vec2 }> = [
      { a: [b.x0, b.y0], b: [b.x1, b.y0] }, { a: [b.x1, b.y0], b: [b.x1, b.y1] },
      { a: [b.x1, b.y1], b: [b.x0, b.y1] }, { a: [b.x0, b.y1], b: [b.x0, b.y0] },
    ];
    for (const sd of sides) {
      const L = Math.hypot(sd.b[0] - sd.a[0], sd.b[1] - sd.a[1]);
      const k = Math.floor(L / every);
      const ux = (sd.b[0] - sd.a[0]) / L, uy = (sd.b[1] - sd.a[1]) / L;
      const nx = uy, ny = -ux; // outward for a CCW-listed rectangle
      for (let z = fromZ + floorH * 0.5; z < toZ - 0.8; z += floorH) {
        for (let i = 0; i < k; i++) {
          const d = (L - k * every) / 2 + every * (i + 0.5);
          p.set(sd.a[0] + ux * d + nx * 0.04, z, -(sd.a[1] + uy * d + ny * 0.04));
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(nx, -ny)); // plane +Z → outward normal
          mats.push(new THREE.Matrix4().compose(p, q, s));
        }
      }
    }
    const n = Math.max(1, mats.length);
    const glass = new THREE.InstancedMesh(new THREE.PlaneGeometry(w, h), MAT.windowGlass(), n);
    const frame = new THREE.InstancedMesh(frameGeo(w, h), MAT.windowFrame(), n);
    let seed = Math.round(b.x0 * 7 + b.y0 * 13) >>> 0 || 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    mats.forEach((m, i) => {
      glass.setMatrixAt(i, m);
      frame.setMatrixAt(i, m);
      glass.setColorAt(i, PANE_TINTS[Math.floor(rnd() * PANE_TINTS.length)]);
    });
    glass.count = frame.count = mats.length;
    glass.receiveShadow = frame.receiveShadow = true;
    frame.castShadow = true;
    return [glass, frame];
  }, [b, fromZ, toZ, floorH, every, w, h]);
  return <>{meshes.map((m, i) => <primitive key={i} object={m} />)}</>;
}

/** ground-floor shopfront mullions every ~2 m around a block, plus a fascia band above the glass */
function Shopfront({ b, top, from = 0.4, every = 2.2 }: { b: ReturnType<typeof polyBounds>; top: number; from?: number; every?: number }) {
  const mesh = useMemo(() => {
    const ps: THREE.Vector3[] = [];
    const edge = (a: Vec2, c: Vec2) => {
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]), k = Math.max(1, Math.round(L / every));
      for (let i = 0; i <= k; i++) ps.push(new THREE.Vector3(a[0] + ((c[0] - a[0]) * i) / k, 0, -(a[1] + ((c[1] - a[1]) * i) / k)));
    };
    edge([b.x0, b.y0], [b.x1, b.y0]); edge([b.x1, b.y0], [b.x1, b.y1]); edge([b.x1, b.y1], [b.x0, b.y1]); edge([b.x0, b.y1], [b.x0, b.y0]);
    const H = top - from;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, H, 0.1), MAT.windowFrame(), ps.length);
    const m = new THREE.Matrix4();
    ps.forEach((p, i) => im.setMatrixAt(i, m.makeTranslation(p.x, from + H / 2, p.z)));
    im.castShadow = true;
    return im;
  }, [b, top, from, every]);
  return <primitive object={mesh} />;
}

function Buildings({ cutaway }: { cutaway: boolean }) {
  const parts = useMemo(() => {
    const out: JSX.Element[] = [];
    const tints = ['#e9dfcd', '#f1ece2', '#ddd1bb', '#e6ddd0', '#d9cdb8'];
    let ti = 0;
    for (const bd of LAYOUT.buildings) {
      const b = polyBounds(bd.poly as Vec2[]);
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, sx = b.x1 - b.x0, sy = b.y1 - b.y0;
      if (bd.kind === 'block') {
        const H = bd.height ?? 12;
        const m = MAT.paint(tints[ti++ % tints.length]);
        out.push(<mesh key={bd.id} position={[cx, H / 2, -cy]} geometry={boxGeo(sx, H, sy)} material={m} castShadow receiveShadow />);
        out.push(<mesh key={`${bd.id}-par`} position={[cx, H + 0.45, -cy]} geometry={boxGeo(sx + 0.3, 0.9, sy + 0.3)} material={m} castShadow />);
        out.push(<mesh key={`${bd.id}-roof`} position={[cx, H + 0.2, -cy]} geometry={boxGeo(sx - 0.4, 0.42, sy - 0.4)} material={MAT.concrete('#a9a59c')} receiveShadow />);
        for (let k = 0; k < 3; k++) out.push(<Prop key={`${bd.id}-ac${k}`} name="ph_aircon" at={[cx + sx * 0.18 + k * 1.0, H + 0.41, -cy + 2]} />);
        out.push(<Windows key={`${bd.id}-win`} b={b} fromZ={3.4} toZ={H} />);
        // ground floor: a shopfront (glass, mullions, a fascia), a stone plinth, and a band at every floor slab
        out.push(<mesh key={`${bd.id}-shop`} position={[cx, 1.8, -cy]} geometry={boxGeo(sx + 0.06, 2.8, sy + 0.06)} material={MAT.shopGlass()} />);
        out.push(<Shopfront key={`${bd.id}-mul`} b={{ x0: b.x0 - 0.05, x1: b.x1 + 0.05, y0: b.y0 - 0.05, y1: b.y1 + 0.05 }} top={3.2} />);
        out.push(<mesh key={`${bd.id}-fas`} position={[cx, 3.3, -cy]} geometry={boxGeo(sx + 0.2, 0.4, sy + 0.2)} material={MAT.concrete('#8f8b84')} castShadow receiveShadow />);
        out.push(<mesh key={`${bd.id}-pl`} position={[cx, 0.2, -cy]} geometry={boxGeo(sx + 0.14, 0.4, sy + 0.14)} material={MAT.concrete('#9d978c')} receiveShadow />);
        for (let z = 6.8; z < H - 0.5; z += 3.4) out.push(<mesh key={`${bd.id}-fb${z}`} position={[cx, z, -cy]} geometry={boxGeo(sx + 0.1, 0.16, sy + 0.1)} material={m} castShadow receiveShadow />);
      }
    }
    return out;
  }, []);
  const office = LAYOUT.buildings.find((b) => b.id === 'office')!;
  const cafe = LAYOUT.buildings.find((b) => b.id === 'cafe')!;
  const upper = useMemo(() => {
    const out: JSX.Element[] = [];
    // office: a mid-rise above the ground floor (curtain wall + spandrel bands)
    const o = polyBounds(office.poly as Vec2[]);
    const ox = (o.x0 + o.x1) / 2, oy = (o.y0 + o.y1) / 2, osx = o.x1 - o.x0, osy = o.y1 - o.y0;
    const top = 3.2 + 4 * 3.6;
    out.push(<mesh key="off-up" position={[ox, (3.2 + top) / 2, -oy]} geometry={boxGeo(osx - 0.4, top - 3.2, osy - 0.4)} material={MAT.shopGlass()} castShadow receiveShadow />);
    out.push(<Shopfront key="off-mul" b={{ x0: o.x0 + 0.17, x1: o.x1 - 0.17, y0: o.y0 + 0.17, y1: o.y1 - 0.17 }} from={3.2} top={top} every={1.5} />);
    const band = MAT.concrete('#d9d6cf');
    for (let z = 3.2; z <= top + 0.01; z += 3.6) out.push(<mesh key={`band${z}`} position={[ox, z + 0.35, -oy]} geometry={boxGeo(osx, 0.7, osy)} material={band} castShadow />);
    out.push(<mesh key="off-par" position={[ox, top + 0.9, -oy]} geometry={boxGeo(osx, 0.5, osy)} material={band} castShadow />);
    // café: two plastered storeys above the shop
    const c = polyBounds(cafe.poly as Vec2[]);
    const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
    const cm = MAT.paint('#efe4d2');
    out.push(<mesh key="cafe-up" position={[cx, 3.5 + 3.4, -cy]} geometry={boxGeo(c.x1 - c.x0, 6.8, c.y1 - c.y0)} material={cm} castShadow receiveShadow />);
    out.push(<Windows key="cafe-win" b={c} fromZ={3.5} toZ={10.3} />);
    out.push(<mesh key="cafe-awn" position={[c.x1 + 1.2, 3.0, -cy]} geometry={boxGeo(2.4, 0.08, c.y1 - c.y0)} material={new THREE.MeshStandardMaterial({ color: '#3f4a3c', roughness: 0.8 })} castShadow />);
    return out;
  }, [office, cafe]);
  const ceilings = useMemo(() => {
    const out: JSX.Element[] = [];
    for (const bd of [office, cafe]) {
      const h = bd.id === 'office' ? 3.0 : 3.2;
      const g = floorGeo(bd.poly as Array<[number, number]>, h);
      out.push(<mesh key={`ceil-${bd.id}`} geometry={g} material={MAT.ceiling()} />);
      // the slab above: casts the interior shadow, so daylight only enters through the façade
      out.push(<mesh key={`slab-${bd.id}`} geometry={floorGeo(bd.poly as Array<[number, number]>, h + 0.2)} material={new THREE.MeshStandardMaterial({ color: '#888', side: THREE.DoubleSide, colorWrite: false, depthWrite: false })} castShadow />);
    }
    // office ceiling light panels (0.6 × 1.2 m, a grid)
    const o = polyBounds(office.poly as Vec2[]);
    const lm = MAT.ceilingLight();
    for (let x = o.x0 + 3; x < o.x1 - 2; x += 4) for (let y = o.y0 + 3; y < o.y1 - 2; y += 4) {
      out.push(<mesh key={`cl${x},${y}`} position={[x, 2.99, -y]} rotation-x={Math.PI / 2} material={lm}><planeGeometry args={[0.6, 1.2]} /></mesh>);
    }
    return out;
  }, [office, cafe]);
  const floors = useMemo(() => LAYOUT.buildings.filter((b) => b.kind === 'cutaway').map((b) => (
    <mesh key={`floor-${b.id}`} geometry={floorGeo(b.poly as Array<[number, number]>, 0.015)} material={b.floor === 'wood' ? MAT.wood() : MAT.terrazzo()} receiveShadow />
  )), []);
  return (
    <>
      {parts}
      {floors}
      {!cutaway && upper}
      {!cutaway && ceilings}
    </>
  );
}

// ───────────── street ─────────────
function Street() {
  const els = useMemo(() => {
    const out: JSX.Element[] = [];
    const { road, sidewalks } = LAYOUT.street;
    const [[rx0], [rx1]] = road;
    // the road and pavements are drawn on past both ends of the modelled street, so the traffic has somewhere to go
    const ry0 = ROAD_VIS.y0, ry1 = ROAD_VIS.y1;
    const asphalt = MAT.asphalt();
    out.push(<mesh key="road" geometry={floorGeo([[rx0, ry0], [rx1, ry0], [rx1, ry1], [rx0, ry1]], 0.0)} material={asphalt} receiveShadow />);
    const paving = MAT.paving();
    const curb = MAT.curb();
    for (const [i, [[x0], [x1]]] of sidewalks.entries()) {
      const cx = (x0 + x1) / 2, cy = (ry0 + ry1) / 2;
      out.push(<mesh key={`sw${i}`} position={[cx, 0.06, -cy]} geometry={boxGeo(x1 - x0, 0.12, ry1 - ry0)} material={paving} receiveShadow />);
      const ex = i === 0 ? x1 : x0;
      out.push(<mesh key={`cb${i}`} position={[ex, 0.075, -cy]} geometry={boxGeo(0.18, 0.15, ry1 - ry0)} material={curb} receiveShadow />);
    }
    const line = MAT.paintLine();
    const cx = (rx0 + rx1) / 2;
    const zebra = (y: number) => Math.abs(y - CROSSING.y) < CROSSING.half + 3;
    for (let y = ry0 + 2; y < ry1; y += 9) if (!zebra(y + 1.5)) out.push(<mesh key={`d${y}`} position={[cx, 0.006, -(y + 1.5)]} rotation-x={-Math.PI / 2} material={line}><planeGeometry args={[0.15, 3]} /></mesh>);
    // the parking lanes along both kerbs (3 m), then one running lane each way
    for (const x of [rx0 + 3, rx1 - 3]) out.push(<mesh key={`e${x}`} position={[x, 0.006, -(ry0 + ry1) / 2]} rotation-x={-Math.PI / 2} material={line}><planeGeometry args={[0.12, ry1 - ry0]} /></mesh>);
    // pedestrian crossing at the café, with a stop line 2 m before it in each running lane
    for (let k = 0; k < 8; k++) out.push(<mesh key={`zb${k}`} position={[rx0 + 1 + k * 2, 0.007, -CROSSING.y]} rotation-x={-Math.PI / 2} material={line}><planeGeometry args={[1.0, 2 * CROSSING.half]} /></mesh>);
    out.push(<mesh key="stopS" position={[(rx0 + 3 + cx) / 2, 0.007, -(CROSSING.y + CROSSING.half + 2)]} rotation-x={-Math.PI / 2} material={line}><planeGeometry args={[cx - rx0 - 3, 0.3]} /></mesh>);
    out.push(<mesh key="stopN" position={[(cx + rx1 - 3) / 2, 0.007, -(CROSSING.y - CROSSING.half - 2)]} rotation-x={-Math.PI / 2} material={line}><planeGeometry args={[rx1 - 3 - cx, 0.3]} /></mesh>);
    // the city floor around the blocks
    out.push(<mesh key="city" position={[0, -0.01, 0]} rotation-x={-Math.PI / 2} material={MAT.paving()} receiveShadow><planeGeometry args={[900, 900]} /></mesh>);
    return out;
  }, []);
  return <>{els}</>;
}

/**
 * Palm fronds move in the wind: a vertex sway on the frond materials (shared by every palm), growing with the
 * distance from the crown, with a slow gust on top. The shadow keeps the still fronds (a small mismatch, unseen).
 */
const wind = { value: 0 };
function usePalmWind() {
  const { scene } = useGLTF(modelUrl('palm'));
  useMemo(() => {
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m || !/Palm(Leaf|Dead)/.test(m.name) || m.userData.wind) return;
      m.userData.wind = true;
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uWind = wind;
        sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vec2 crown = vec2(0.35, -0.1);
          float reach = length(transformed.xz - crown);
          vec4 wp0 = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float ph = wp0.x * 0.37 + wp0.z * 0.21;
          float gust = 0.65 + 0.35 * sin(uWind * 0.31 + ph);
          float k = reach * reach * 0.014 * gust;
          transformed.x += sin(uWind * 1.35 + ph + reach * 0.9) * k;
          transformed.z += cos(uWind * 1.1 + ph * 1.7 + reach * 0.7) * k * 0.6;
          transformed.y += sin(uWind * 1.8 + ph + reach * 1.3) * k * 0.45;`);
      };
      m.needsUpdate = true;
    });
  }, [scene]);
  useFrame((_, dt) => { wind.value += Math.min(dt, 0.1); });
}

/** a fabric awning over a shopfront: façade at x (engine), facing east (+1) or west (−1), centred at y, w metres wide */
function Awning({ x, y, w, side, color }: { x: number; y: number; w: number; side: 1 | -1; color: string }) {
  const m = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide }), [color]);
  return (
    <group position={[x + side * 0.75, 2.95, -y]} rotation-z={-side * 0.28}>
      <mesh geometry={boxGeo(1.6, 0.03, w)} material={m} castShadow receiveShadow />
      <mesh position={[side * 0.79, -0.12, 0]} geometry={boxGeo(0.02, 0.24, w)} material={m} castShadow />
    </group>
  );
}

function StreetProps() {
  usePalmWind();
  return (
    <>
      {(P.palms as Vec2[]).map(([x, y], i) => <Prop key={`p${i}`} name="palm" at={[x, 0.12, -y]} rotY={i * 1.3} scale={0.9 + ((i * 37) % 10) / 40} occluder={{ y: 7.5, r: 5.5 }} />)}
      {(P.lamps as Vec2[]).map(([x, y], i) => <Prop key={`l${i}`} name="street_lamp" at={[x, 0.12, -y]} rotY={x < 16 ? 0 : Math.PI} occluder={{ y: 0, r: 1.4, h: 9 }} />)}
      <ParkedCars />
      <Traffic />
      <Prop name="ph_covered_car" at={[22.2, 0, 58]} rotY={0.02} />
      {/* a bus stop, bins, crossing signs, a café board, closed shutters and awnings on the shopfronts */}
      <Prop name="bus_shelter" at={[SHELTER.at[0], 0.12, -SHELTER.at[1]]} rotY={faceCompass(270)} />
      {[[7.5, -35], [7.5, -105], [24.5, -45], [24.5, -150], [7.5, 15], [24.5, 10]].map(([x, y], i) => <Prop key={`bin${i}`} name="street_bin" at={[x, 0.12, -y]} rotY={i} />)}
      <Prop name="crossing_sign" at={[7.6, 0.12, -(CROSSING.y + CROSSING.half + 1)]} rotY={faceCompass(0)} />
      <Prop name="crossing_sign" at={[24.4, 0.12, -(CROSSING.y - CROSSING.half - 1)]} rotY={faceCompass(180)} />
      <Prop name="ph_chalkboard" at={[1.5, 0.015, 131.6]} rotY={0.35} />
      {/* the slat curtain is at the back of the model (0.15 m behind its origin): kept just proud of the shop glass */}
      {[[0.24, -20, 90], [0.24, -21.08, 90], [0.24, -70, 90], [29.76, -95, 270], [29.76, -96.08, 270], [29.76, -5, 270], [29.76, -6.08, 270], [29.76, -7.16, 270]].map(([x, y, f], i) => (
        <Prop key={`sh${i}`} name="ph_shutter" at={[x, 0.015, -y]} rotY={faceCompass(f)} />
      ))}
      <Awning x={0} y={-42} w={6} side={1} color="#6f5a43" />
      <Awning x={0} y={-79} w={5} side={1} color="#3e4d58" />
      <Awning x={0} y={-160} w={6} side={1} color="#6a3433" />
      <Awning x={30} y={-68} w={6} side={-1} color="#4a5a46" />
      <Awning x={30} y={12} w={5} side={-1} color="#7b6a52" />
      <Awning x={30} y={-150} w={5} side={-1} color="#3b4656" />
      {[[5, -112], [5, -90], [27, -60], [27, -138]].map(([x, y], i) => <Prop key={`b${i}`} name="bench" at={[x, 0.12, -y]} rotY={x < 16 ? -Math.PI / 2 : Math.PI / 2} />)}
      {[-118, -121, -141, -144].map((y, i) => <Prop key={`bo${i}`} name="bollard" at={[7.4, 0.12, -y]} />)}
      {[[7.4, -50], [24.6, -95], [7.4, 8]].map(([x, y], i) => <Prop key={`hy${i}`} name="ph_hydrant" at={[x, 0.12, -y]} rotY={faceCompass(x < 16 ? 270 : 90)} />)}
      {[[2.4, -78], [29.6, -30], [2.4, -152]].map(([x, y], i) => <Prop key={`ub${i}`} name="ph_utility_box" at={[x, 0.12, -y]} rotY={faceCompass(x < 16 ? 90 : 270)} />)}
      {[[16, -45], [13, -112], [19, -5], [14, -168]].map(([x, y], i) => <Prop key={`mh${i}`} name="ph_manhole" at={[x, 0.002, -y]} rotY={i} />)}
    </>
  );
}

// ───────────── interiors ─────────────
/** a desk set whose monitor shows one of four work screens (lit), so the office looks occupied */
function Desk({ i }: { i: number }) {
  const obj = useModel('desk_set');
  useMemo(() => {
    const s = obj.getObjectByName('Screen') as THREE.Mesh | undefined;
    if (!s) return;
    screenUVs(s.geometry);
    s.material = screenMaterials()[i % 4];
  }, [obj, i]);
  return <primitive object={obj} />;
}

/** a 55-inch display on a mobile stand (meeting rooms with glass walls use these), showing the dashboard */
function DisplayStand({ at, rotY }: { at: [number, number, number]; rotY: number }) {
  const mats = useMemo(() => ({ dark: new THREE.MeshStandardMaterial({ color: '#1c1e21', roughness: 0.4, metalness: 0.6 }), steel: MAT.frame() }), []);
  const screen = useMemo(() => {
    const g = boxGeo(1.21, 0.68, 0.004);
    screenUVs(g);
    return g;
  }, []);
  return (
    <group position={at} rotation-y={rotY}>
      <mesh position={[0, 0.03, 0]} geometry={boxGeo(0.9, 0.05, 0.55)} material={mats.steel} castShadow receiveShadow />
      {[-0.25, 0.25].map((x) => <mesh key={x} position={[x, 0.8, -0.02]} geometry={boxGeo(0.05, 1.55, 0.04)} material={mats.steel} castShadow />)}
      <mesh position={[0, 1.45, 0.02]} geometry={boxGeo(1.24, 0.71, 0.05)} material={mats.dark} castShadow />
      <mesh position={[0, 1.45, 0.047]} geometry={screen} material={screenMaterials()[2]} />
    </group>
  );
}

function Office() {
  return (
    <>
      {(P.desks as Vec2[]).map(([x, y], i) => (
        // desk_set: 1.6 × 0.8 m top at 0.75 m, monitor at the back (three −z), chair in front; a little clutter on each
        <group key={`d${i}`} position={[x, 0.015, -y]} rotation-y={i % 2 ? Math.PI : 0}>
          <Desk i={i} />
          {i % 3 !== 1 && <Prop name="ph_desk_plant" at={[0.62, 0.75, -0.24]} rotY={i} />}
          {i % 4 === 1 && <Prop name="ph_desk_lamp" at={[-0.66, 0.75, -0.26]} rotY={faceCompass(200)} />}
          {i % 2 === 0 && <Prop name="ph_stationery" at={[-0.5, 0.75, 0.02]} rotY={0.4 + i * 0.3} />}
          {i % 3 === 0 && <Prop name="ph_notepads" part={`piece_${i % 4}`} at={[0.42, 0.751, 0.14]} rotY={0.15 - i * 0.05} />}
          {i % 2 === 1 && <Prop name="ph_binders" part="piece_1" at={[-0.55, 0.75, 0.1]} rotY={1.4 + i * 0.1} />}
          {i % 4 === 2 && <Prop name="ph_binders" part="piece_0" at={[0.36, 0.75, 0.12]} rotY={-0.2} />}
          {i % 3 === 2 && <Prop name="ph_notepads" part="piece_7" at={[0.3, 0.75, -0.12]} rotY={0.5} />}
        </group>
      ))}
      <Prop name="rack_42u" at={[(P.rack as Vec2)[0], 0.015, -(P.rack as Vec2)[1]]} rotY={Math.PI / 2} />
      <mesh position={[(P.reception as Vec2)[0], 0.55, -(P.reception as Vec2)[1]]} geometry={boxGeo(1.0, 1.1, 3.2)} material={MAT.wood()} castShadow receiveShadow />
      {/* meeting room B (x −30…−22, y 19…25): a table for four and a display at the east end */}
      <Prop name="meeting_table" at={[MEETING.table[0], 0.015, -MEETING.table[1]]} />
      {MEETING.chairs.map(([x, y, f], i) => <Prop key={`mc${i}`} name="office_chair" at={[x, 0.015, -y]} rotY={yawFromCompass(f)} />)}
      <DisplayStand at={[-22.5, 0.015, -22]} rotY={faceCompass(270)} />
      {/* meeting room A (x −38…−30): a whiteboard on the concrete wall and a small round table */}
      <Prop name="whiteboard" at={[-39.86, 0.015, -22.2]} rotY={faceCompass(90)} />
      <Prop name="ph_round_table" at={[-35, 0.015, -22]} />
      <Prop name="office_chair" at={[-35, 0.015, -21.3]} rotY={yawFromCompass(0)} />
      <Prop name="office_chair" at={[-35.1, 0.015, -22.75]} rotY={yawFromCompass(175)} />
      {/* by the core: a water cooler and the printer; a wet-floor sign by the door; storage on the west wall */}
      <Prop name="water_dispenser" at={[-17.2, 0.015, -8.55]} />
      <Prop name="printer" at={[-21.5, 0.015, -8.55]} />
      <Prop name="ph_wet_floor" at={[-2.2, 0.015, -10]} rotY={faceCompass(110)} />
      <Prop name="ph_shelf_narrow" at={[-39.6, 0.015, -14.0]} rotY={faceCompass(90)} />
      {/* a break-out corner in the north-east alcove, behind reception */}
      <Prop name="ph_round_coffee_table" at={[-4.6, 0.015, -22.5]} scale={0.8} />
      <Prop name="ph_armchair" at={[-6.35, 0.015, -22.6]} rotY={faceCompass(90)} />
      <Prop name="ph_armchair" at={[-4.5, 0.015, -24.25]} rotY={faceCompass(180)} />
      <Prop name="ph_ottoman" at={[-2.95, 0.015, -22.2]} rotY={Math.PI / 2 + 0.2} />
      {/* plants (Poly Haven) by the door, in the corners and by the core */}
      {([[-7.3, 0.7, 'ph_plant_tall'], [-2, 23.2, 'ph_plant_wide'], [-38.6, 23.4, 'ph_plant_tall'], [-15.3, 9.6, 'ph_plant_wide'], [-0.7, 9.8, 'ph_plant_tall'], [-0.7, 15.2, 'ph_plant_tall']] as const).map(([x, y, n], i) => (
        <Prop key={`pl${i}`} name={n} at={[x, 0.015, -y]} rotY={i * 1.7} />
      ))}
      {/* a waiting corner in the south-east nook */}
      <Prop name="ph_sofa" at={[-4.2, 0.015, -0.75]} rotY={faceCompass(0)} />
      <Prop name="ph_coffee_table" at={[-4.2, 0.015, -2.2]} rotY={Math.PI / 2} />
      <Prop name="ph_armchair" at={[-1.6, 0.015, -2.3]} rotY={faceCompass(270)} />
      {/* storage along the west wall and a low cabinet on the north glass */}
      {[9.5, 11.0].map((y, i) => <Prop key={`sh${i}`} name="ph_shelves" at={[-39.6, 0.015, -y]} rotY={faceCompass(90)} />)}
      <Prop name="ph_cabinet" at={[-12, 0.015, -24.65]} />
      <Prop name="ph_drawers" at={[-39.7, 0.015, -12.6]} rotY={faceCompass(90)} />
      <Prop name="ph_lounge_chair" at={[-6.6, 0.015, -2.1]} rotY={faceCompass(110)} />
      {LAYOUT.transmitters.filter((t) => t.net === 'office-corp').map((t) => <Prop key={t.id} name="ap_ceiling" at={[t.pos[0], 3.0, -t.pos[1]]} />)}
    </>
  );
}

/** a ceiling fan: the blades turn about the shaft (the GLB keeps them as their own node, origin on the shaft) */
function CeilingFan({ at, rpm, phase }: { at: [number, number, number]; rpm: number; phase: number }) {
  const obj = useModel('ph_ceiling_fan');
  const blades = useMemo(() => obj.getObjectByName('ceiling_fan_blades'), [obj]);
  useFrame((_, dt) => { if (blades) blades.rotation.y -= Math.min(dt, 0.1) * (rpm / 60) * Math.PI * 2; });
  return <primitive object={obj} position={at} rotation-y={phase} />;
}

/**
 * café tables with a round top and dining chairs (indices into props.cafeTables): (−6, −135), (−12, −134),
 * (−17, −129). Table 2 is square to the room: the two customers there sit on its chairs.
 */
const ROUND_TABLES = new Set([1, 2, 4]);
function Cafe() {
  const ap = LAYOUT.transmitters.find((t) => t.id === 'ap-cafe')!;
  const [ax, ay] = P.attackerSeat as Vec2;
  const vision = useUi((st) => st.vision);
  return (
    <>
      {/* pendant lamps over the counter and two slow ceiling fans (hang from the 3.2 m ceiling; hidden with it in Network Vision) */}
      {!vision && [125.9, 127, 128.1].map((y, i) => <Prop key={`pd${i}`} name="ph_pendant" at={[-18.5, 3.2 - 0.95, y]} />)}
      {!vision && <CeilingFan at={[-7.5, 2.68, 130.5]} rpm={70} phase={0} />}
      {!vision && <CeilingFan at={[-13, 2.68, 131]} rpm={64} phase={0.6} />}
      <Prop name="cafe_counter" at={[-18.5, 0.015, 127]} rotY={-Math.PI / 2} />
      <Prop name="ph_vase" at={[-18.5, 1.08, 125.75]} />
      <Prop name="ph_cake" at={[-18.45, 1.08, 128.2]} />
      {/* pastries: a cake and croissants in the case, a basket of croissants on the counter */}
      <Prop name="ph_cake_berry" at={[-18.5, 1.085, 126.25]} rotY={0.4} />
      {[[-18.62, 126.62, 0.3], [-18.4, 126.66, 2.1], [-18.52, 126.78, 1.2]].map(([x, z, r], i) => <Prop key={`cr${i}`} name="ph_croissant" at={[x, 1.085, z]} rotY={r} />)}
      <Prop name="ph_basket" at={[-18.25, 1.08, 127.1]} rotY={Math.PI / 2} />
      {[[-18.3, 127.03, 0.2], [-18.2, 127.17, 2.6]].map(([x, z, r], i) => <Prop key={`cb${i}`} name="ph_croissant" at={[x, 1.12, z]} rotY={r} />)}
      {/* a display shelf on the back wall with vases and a jug */}
      <Prop name="ph_display_shelves" at={[-21.7, 0.015, 131]} />
      <Prop name="ph_vase_white" at={[-21.7, 1.575, 130.75]} />
      <Prop name="ph_jug" at={[-21.7, 1.575, 131.3]} rotY={2.2} />
      {[126.0, 127.2, 128.4].map((y, i) => <Prop key={`st${i}`} name="ph_bar_stool" at={[-17.35, 0.015, y]} rotY={i * 0.6} />)}
      {/* bistro sets where people sit (their seats are measured on it), round tables with dining chairs elsewhere */}
      {(P.cafeTables as Vec2[]).map(([x, y], i) => (ROUND_TABLES.has(i)
        ? (
          <group key={`t${i}`} position={[x, 0.015, -y]} rotation-y={i === 2 ? 0 : i * 0.35}>
            <Prop name="ph_round_table" at={[0, 0, 0]} />
            <Prop name="ph_dining_chair" at={[0, 0, -0.72]} rotY={0} />
            <Prop name="ph_dining_chair" at={[0, 0, 0.72]} rotY={Math.PI} />
            {/* tea for the two at table 2 */}
            {i === 2 && <Prop name="ph_tea_set" at={[0.05, 0.752, 0]} rotY={Math.PI / 2} scale={0.6} />}
          </group>
        )
        : <Prop key={`t${i}`} name="ph_bistro_set" at={[x, x > 1 ? 0.12 : 0.015, -y]} rotY={0} />))}
      {[[2.6, -123.2], [2.6, -136.8]].map(([x, y], i) => <Prop key={`pb${i}`} name="ph_planter" at={[x, 0.12, -y]} rotY={faceCompass(90)} />)}
      {/* the café's own router, on a column by the counter */}
      <mesh position={[ap.pos[0] + 0.2, 1.6, -ap.pos[1]]} geometry={boxGeo(0.3, 3.2, 0.3)} material={MAT.paint('#e8e2d6')} castShadow />
      <Prop name="ap_cafe" at={[ap.pos[0], ap.pos[2], -ap.pos[1]]} rotY={-Math.PI / 2} />
      {/* the customer at the corner table: a laptop and a small USB adapter, like everyone else */}
      <Prop name="laptop" at={[ax, 0.735, -(ay - 0.2)]} />
      <Prop name="adapter_usb" at={[ax + 0.22, 0.735, -(ay - 0.12)]} />
    </>
  );
}

// ───────────── cell sites ─────────────
function Towers() {
  return (
    <>
      {LAYOUT.transmitters.filter((t) => t.kind === 'cell').map((t) => (
        <Prop key={t.id} name="tower_monopole" at={[t.pos[0], 0, -t.pos[1]]} rotY={yawFromCompass(t.sectors?.[0].azDeg ?? 0)} scale={t.pos[2] / 30} />
      ))}
    </>
  );
}

// ───────────── desert site ─────────────
function dune(x: number, y: number) {
  return 2.2 * Math.sin(x * 0.021 + 1.3) * Math.cos(y * 0.017) + 1.4 * Math.sin(x * 0.047 + y * 0.031) + 0.6 * Math.sin(x * 0.11 - y * 0.09);
}
const SITE: Vec2 = [12000, 0];
export function desertHeight(x: number, y: number) {
  const r = Math.hypot(x - SITE[0], y - SITE[1]);
  const k = THREE.MathUtils.smoothstep(r, 45, 110);
  return dune(x, y) * k * (1 + r / 300) + k * 0.4;
}

function Terrain() {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(4000, 4000, 220, 220);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + SITE[0], y = -pos.getZ(i) + SITE[1];
      pos.setY(i, desertHeight(x, y) - 0.02);
      uv.setXY(i, x, y);
    }
    g.computeVertexNormals();
    g.translate(SITE[0], 0, -SITE[1]);
    return g;
  }, []);
  const ridge = useMemo(() => {
    // a rocky ridge on the horizon (3–4 km), low poly, fogged
    const N = 180, R0 = 2600;
    const v: number[] = [], idx: number[] = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = R0 + 500 * Math.sin(a * 3.1) + 300 * Math.sin(a * 7.7);
      const h = 60 + 90 * Math.max(0, Math.sin(a * 5.3 + 1)) + 50 * Math.abs(Math.sin(a * 13.1)) + (i % 3) * 8;
      const x = SITE[0] + Math.cos(a) * r, z = -(SITE[1] + Math.sin(a) * r);
      v.push(x, -5, z, SITE[0] + Math.cos(a) * (r + 400), h, -(SITE[1] + Math.sin(a) * (r + 400)));
      if (i < N) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, []);
  const rocks = useMemo(() => {
    const out: Array<{ p: [number, number, number]; s: number; r: number }> = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2, d = 60 + rnd() * 500;
      const x = SITE[0] + Math.cos(a) * d, y = SITE[1] + Math.sin(a) * d;
      out.push({ p: [x, desertHeight(x, y) - 0.1, -y], s: 0.4 + rnd() * 2.2, r: rnd() * 6 });
    }
    return out;
  }, []);
  return (
    <>
      <mesh geometry={geo} material={MAT.sand()} receiveShadow />
      <mesh geometry={ridge}><meshStandardMaterial color="#8a6a52" roughness={1} /></mesh>
      {rocks.map((r, i) => <Prop key={i} name="ph_rocks" part={`piece_${i % 4}`} at={r.p} rotY={r.r} scale={r.s * 5} />)}
    </>
  );
}

/** dry scrub on the sand outside the pad (Poly Haven bush set, five pieces), denser near the site */
function Scrub() {
  const items = useMemo(() => {
    const out: Array<{ p: [number, number, number]; s: number; r: number; k: number }> = [];
    let seed = 23;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 90; i++) {
      const a = rnd() * Math.PI * 2, d = 24 + Math.pow(rnd(), 2.2) * 300;
      const x = SITE[0] + Math.cos(a) * d, y = SITE[1] + Math.sin(a) * d;
      out.push({ p: [x, desertHeight(x, y) - 0.04, -y], s: 1.8 + rnd() * 1.8, r: rnd() * 6.3, k: i % 5 });
    }
    return out;
  }, []);
  return <>{items.map((b, i) => <Prop key={i} name="ph_bush" part={`piece_${b.k}`} at={b.p} rotY={b.r} scale={b.s} />)}</>;
}

/**
 * the site's windsock: a steady north-westerly (the shamal) that veers and gusts. The sock swings about the mast
 * and droops when the gust drops. Scene-only: no wind enters the radio model.
 */
function Windsock({ at }: { at: [number, number, number] }) {
  const obj = useModel('windsock');
  const sock = useMemo(() => {
    const s = obj.getObjectByName('Sock');
    if (s) s.rotation.order = 'YZX'; // yaw about the mast, then droop about the sock's own horizontal axis
    return s;
  }, [obj]);
  const t = useRef(0);
  useFrame((_, dt) => {
    if (!sock) return;
    t.current += Math.min(dt, 0.1);
    const k = t.current;
    const gust = 0.5 + 0.3 * Math.sin(k * 0.45) + 0.2 * Math.sin(k * 1.7 + 1);
    sock.rotation.y = -Math.PI / 4 + 0.22 * Math.sin(k * 0.31) + 0.08 * Math.sin(k * 1.9);
    sock.rotation.z = -0.55 * (1 - gust) - 0.05 + 0.03 * Math.sin(k * 6.1);
  });
  return <primitive object={obj} position={at} />;
}

const GEO_LOOK = geoLookAngle(LAYOUT.site.latDeg, LAYOUT.site.lonDeg, PARAMS.geoSatLonDeg.v);
function DesertSite() {
  const [gx, gy] = P.generator as Vec2;
  const [lx, ly, lz] = P.leoTerminal as number[];
  const [dx, dy] = P.geoDish as Vec2;
  const router = LAYOUT.transmitters.find((t) => t.id === 'ap-site')!;
  const dish = useModel('vsat_geo');
  useMemo(() => {
    const az = dish.getObjectByName('Az'), el = dish.getObjectByName('El');
    if (az) az.rotation.y = (-GEO_LOOK.azDeg * Math.PI) / 180;
    if (el) el.rotation.x = (GEO_LOOK.elDeg * Math.PI) / 180;
  }, [dish]);
  const fence = P.fence as Vec2[];
  const fenceEls = useMemo(() => {
    const out: JSX.Element[] = [];
    const post = MAT.frame();
    const mesh = new THREE.MeshStandardMaterial({ color: '#9a9a96', metalness: 0.7, roughness: 0.5, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
    fence.forEach((a, i) => {
      const b = fence[(i + 1) % fence.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const rot = Math.atan2(b[1] - a[1], b[0] - a[0]);
      out.push(<mesh key={`fm${i}`} position={[(a[0] + b[0]) / 2, 0.9, -(a[1] + b[1]) / 2]} rotation-y={rot} material={mesh}><planeGeometry args={[L, 1.8]} /></mesh>);
      const n = Math.round(L / 3);
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        out.push(<mesh key={`fp${i}-${k}`} position={[a[0] + (b[0] - a[0]) * t, 0.95, -(a[1] + (b[1] - a[1]) * t)]} geometry={boxGeo(0.06, 1.9, 0.06)} material={post} castShadow />);
      }
      out.push(<mesh key={`fr${i}`} position={[(a[0] + b[0]) / 2, 1.85, -(a[1] + b[1]) / 2]} rotation-y={rot} geometry={boxGeo(L, 0.04, 0.04)} material={post} />);
    });
    return out;
  }, [fence]);
  return (
    <>
      <Terrain />
      <mesh position={[12000, 0.08, 0]} geometry={boxGeo(44, 0.16, 44)} material={MAT.concrete('#bfb5a4')} receiveShadow />
      <Prop name="container_office" at={[12000.03, 0.16, 0]} />
      <Prop name="generator" at={[gx, 0.16, -gy]} rotY={0.2} />
      {/* site clutter (Poly Haven): fuel, the power cabinet, the AC unit, spares, and a barrier line at the gate */}
      {[[gx + 1.6, gy - 1.3], [gx + 2.0, gy - 1.35]].map(([x, y], i) => <Prop key={`jc${i}`} name="ph_jerrycan" at={[x, 0.16, -y]} rotY={0.3 + i * 0.4} />)}
      <Prop name="ph_power_cabinet" at={[gx - 1.7, 0.16, -(gy + 2.2)]} rotY={faceCompass(90)} />
      <Prop name="ph_aircon" at={[12001.5, 0.16, 1.22 + 0.21]} />
      <Prop name="ph_crate" at={[11996.3, 0.16, -2.0]} rotY={0.1} />
      <Prop name="ph_crate" at={[11995.3, 0.16, -2.3]} rotY={-0.25} />
      <Prop name="ph_box" at={[11996.3, 0.51, -2.0]} rotY={0.5} />
      {[-5.2, -3.6, -2.0].map((y, i) => <Prop key={`br${i}`} name="ph_barrier" at={[11977.5, 0, -y]} rotY={Math.PI / 2} />)}
      {/* a portable backup generator and fuel drums by the main set; spare crates; a hand truck by the stores */}
      <Prop name="ph_generator" at={[11993.4, 0.16, 6.6]} rotY={0.5} />
      {[[11986.5, -5.5], [11986.4, -6.3], [11987.2, -5.9]].map(([x, y], i) => <Prop key={`dr${i}`} name="ph_drum" at={[x, 0.16, -y]} rotY={i * 1.1} />)}
      <Prop name="ph_plastic_crate" at={[11997.2, 0.16, 6.0]} rotY={0.05} />
      <Prop name="ph_plastic_crate" at={[11997.2, 0.41, 6.0]} rotY={-0.08} />
      <Prop name="ph_hand_truck" at={[11997.5, 0.16, -2.9]} rotY={faceCompass(200)} />
      {/* the crew's rest spot in the container's shade (the low sun is in the west-south-west) */}
      <Prop name="ph_picnic_table" at={[12013.5, 0.16, -6.5]} />
      <Prop name="ph_toolbox" at={[12013.4, 0.91, -6.0]} rotY={0.3} />
      {[[12015.1, 6.0, 270], [12011.9, 7.2, 95], [12004.3, -2.2, 200], [12005.3, -2.6, 160]].map(([x, y, f], i) => (
        <Prop key={`mb${i}`} name="ph_monobloc" at={[x, 0.16, -y]} rotY={faceCompass(f)} />
      ))}
      {[[12013.85, 0.91, -7.15], [12012.2, 0.16, -4.65], [12012.45, 0.16, -4.55]].map((p, i) => <Prop key={`wj${i}`} name="ph_water_jug" at={p as [number, number, number]} rotY={i * 1.9} />)}
      <Prop name="ph_trash_can" at={[12011.5, 0.16, -8.8]} rotY={0.6} />
      {/* the crew's pickup, parked inside the gate */}
      <Prop name="pickup" at={[11986, 0.16, -12]} rotY={faceCompass(120)} tint={{ CarPaint: '#e9e7e1' }} />
      {/* work kit around the container: a ladder against the east end, a tool cart, a storage rack, crates and a tote */}
      <group position={[12003.6, 0.16, -0.6]} rotation-y={Math.PI / 2}>
        <group rotation-x={-0.25}><Prop name="ph_ladder" part="piece_1" at={[0, 0, 0]} /></group>
      </group>
      <Prop name="ph_hose" at={[12003.16, 1.0, 0.7]} rotY={faceCompass(90)} />
      <Prop name="ph_breaker_box" at={[11996.77, 1.2, 0.3]} rotY={faceCompass(270)} />
      <Prop name="ph_security_light" at={[12000, 2.11, -1.43]} rotY={faceCompass(0)} />
      <Prop name="ph_tool_cart" at={[11999.8, 0.16, 3.4]} rotY={0.04} />
      <Prop name="ph_metal_rack" at={[11998.6, 0.16, -1.95]} rotY={faceCompass(0)} />
      <Prop name="ph_crate_red" at={[11999.75, 0.16, -2.05]} rotY={0.1} />
      <Prop name="ph_crate_red" at={[11999.75, 0.43, -2.05]} rotY={-0.05} />
      <Prop name="ph_tote" at={[11994.6, 0.16, -3.0]} rotY={0.4} />
      <group position={[12002.6, 0.16, -1.5]}>
        <group rotation-x={0.22}><Prop name="ph_broom" at={[0, 0, 0]} /></group>
      </group>
      {[[11983.5, 14, 0.4], [11983.9, 14.6, 1.2]].map(([x, z, r], i) => <Prop key={`ty${i}`} name="ph_tyre" at={[x, 0.16, z]} rotY={r} />)}
      <Windsock at={[12017.5, 0.16, 17]} />
      <Scrub />
      <mesh position={[lx, (lz - 0.6) / 2, -ly]} geometry={boxGeo(0.08, lz - 0.6, 0.08)} material={MAT.frame()} castShadow />
      <Prop name="leo_terminal" at={[lx, lz - 0.6, -ly]} />
      <primitive object={dish} position={[dx, 0.16, -dy]} />
      <Prop name="site_router" at={[router.pos[0] + 0.06, router.pos[2], -router.pos[1]]} rotY={Math.PI / 2} />
      {fenceEls}
    </>
  );
}

export function Zones() {
  const zone = useUi((s) => s.snap?.zone ?? 'office');
  const vision = useUi((s) => s.vision);
  if (zone === 'desert') return (<><DesertSite /><Towers /><People zone="desert" /></>);
  return (
    <>
      <Street />
      <Buildings cutaway={vision} />
      <Walls />
      <StreetProps />
      <Office />
      <Cafe />
      <Towers />
      <People zone={zone} />
    </>
  );
}
