/**
 * The realistic world (plan §6, D3, D9). Every wall that affects radio comes from src/world/layout.json, at its
 * real height and material, so what you see is what the propagation model uses. Decorative props are the
 * Blender-built GLBs. Grounded realism, restrained palette (P9): the network layer is the only loud thing.
 */
import { useEffect, useMemo, type JSX } from 'react';
import * as THREE from 'three';
import { geoLookAngle, LAYOUT, PARAMS, type Vec2 } from '../../engine/index';
import { useUi } from '../driver';
import { boxGeo, floorGeo, MAT, useModel, type ModelName } from './assets';
import { People } from './Character';
import { camOccluders } from './vision';

const P = LAYOUT.props;
const yawFromCompass = (deg: number) => (-deg * Math.PI) / 180; // +Z-forward models facing compass `deg` need π offset (see `faceCompass`)
/** rotation.y that turns a model whose forward is three +Z (south) toward compass heading `deg` */
export const faceCompass = (deg: number) => ((180 - deg) * Math.PI) / 180;

function Prop({ name, at, rotY = 0, scale = 1, tint, occluder }: { name: ModelName; at: [number, number, number]; rotY?: number; scale?: number; tint?: Record<string, string>; occluder?: { y: number; r: number; h?: number } }) {
  const obj = useModel(name, { tint });
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

/** façade windows as one instanced mesh per building */
function Windows({ b, fromZ, toZ, floorH = 3.4, every = 3, w = 1.6, h = 1.9, shop = false }: { b: ReturnType<typeof polyBounds>; fromZ: number; toZ: number; floorH?: number; every?: number; w?: number; h?: number; shop?: boolean }) {
  const mesh = useMemo(() => {
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = MAT.windowDark();
    const mats: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const sides: Array<{ a: Vec2; b: Vec2; n: number }> = [
      { a: [b.x0, b.y0], b: [b.x1, b.y0], n: Math.PI },        // south face (normal −y → three +z)
      { a: [b.x1, b.y0], b: [b.x1, b.y1], n: Math.PI / 2 },    // east
      { a: [b.x1, b.y1], b: [b.x0, b.y1], n: 0 },              // north
      { a: [b.x0, b.y1], b: [b.x0, b.y0], n: -Math.PI / 2 },   // west
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
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.count = mats.length;
    im.receiveShadow = true;
    void shop;
    return im;
  }, [b, fromZ, toZ, floorH, every, w, h, shop]);
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
        out.push(<mesh key={`${bd.id}-ac`} position={[cx + sx * 0.2, H + 1.0, -cy]} geometry={boxGeo(2.4, 1.2, 1.6)} material={MAT.frame()} castShadow />);
        out.push(<Windows key={`${bd.id}-win`} b={b} fromZ={0} toZ={H} />);
        out.push(<mesh key={`${bd.id}-shop`} position={[cx, 1.8, -cy]} geometry={boxGeo(sx + 0.06, 2.8, sy + 0.06)} material={MAT.windowDark()} />);
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
    out.push(<mesh key="off-up" position={[ox, (3.2 + top) / 2, -oy]} geometry={boxGeo(osx - 0.4, top - 3.2, osy - 0.4)} material={MAT.windowDark()} castShadow receiveShadow />);
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
    const [[rx0, ry0], [rx1, ry1]] = road;
    const asphalt = MAT.asphalt();
    out.push(<mesh key="road" geometry={floorGeo([[rx0, ry0], [rx1, ry0], [rx1, ry1], [rx0, ry1]], 0.0)} material={asphalt} receiveShadow />);
    const paving = MAT.paving();
    const curb = MAT.curb();
    for (const [i, [[x0, y0], [x1, y1]]] of sidewalks.entries()) {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      out.push(<mesh key={`sw${i}`} position={[cx, 0.06, -cy]} geometry={boxGeo(x1 - x0, 0.12, y1 - y0)} material={paving} receiveShadow />);
      const ex = i === 0 ? x1 : x0;
      out.push(<mesh key={`cb${i}`} position={[ex, 0.075, -cy]} geometry={boxGeo(0.18, 0.15, y1 - y0)} material={curb} receiveShadow />);
    }
    const line = MAT.paintLine();
    const cx = (rx0 + rx1) / 2;
    for (let y = ry0 + 2; y < ry1; y += 9) out.push(<mesh key={`d${y}`} position={[cx, 0.006, -(y + 1.5)]} rotation-x={-Math.PI / 2} material={line}><planeGeometry args={[0.15, 3]} /></mesh>);
    for (const x of [rx0 + 0.4, rx1 - 0.4]) out.push(<mesh key={`e${x}`} position={[x, 0.006, -(ry0 + ry1) / 2]} rotation-x={-Math.PI / 2} material={line}><planeGeometry args={[0.12, ry1 - ry0]} /></mesh>);
    // pedestrian crossing at the café
    for (let k = 0; k < 8; k++) out.push(<mesh key={`zb${k}`} position={[rx0 + 1 + k * 2, 0.007, 128]} rotation-x={-Math.PI / 2} material={line}><planeGeometry args={[1.0, 4]} /></mesh>);
    // the city floor around the blocks
    out.push(<mesh key="city" position={[0, -0.01, 0]} rotation-x={-Math.PI / 2} material={MAT.paving()} receiveShadow><planeGeometry args={[900, 900]} /></mesh>);
    return out;
  }, []);
  return <>{els}</>;
}

function StreetProps() {
  return (
    <>
      {(P.palms as Vec2[]).map(([x, y], i) => <Prop key={`p${i}`} name="palm" at={[x, 0.12, -y]} rotY={i * 1.3} scale={0.9 + ((i * 37) % 10) / 40} occluder={{ y: 7.5, r: 5.5 }} />)}
      {(P.lamps as Vec2[]).map(([x, y], i) => <Prop key={`l${i}`} name="street_lamp" at={[x, 0.12, -y]} rotY={x < 16 ? 0 : Math.PI} occluder={{ y: 0, r: 1.4, h: 9 }} />)}
      {(P.cars as Array<[number, number, number]>).map(([x, y, h], i) => (
        <Prop key={`c${i}`} name="car_sedan" at={[x, 0, -y]} rotY={faceCompass(h)} tint={{ CarPaint: ['#d9dadc', '#2c3036', '#8c929a', '#f2f2ef', '#5b6470'][i % 5] }} />
      ))}
      {[[5, -112], [5, -90], [27, -60], [27, -138]].map(([x, y], i) => <Prop key={`b${i}`} name="bench" at={[x, 0.12, -y]} rotY={x < 16 ? -Math.PI / 2 : Math.PI / 2} />)}
      {[-118, -121, -141, -144].map((y, i) => <Prop key={`bo${i}`} name="bollard" at={[7.4, 0.12, -y]} />)}
    </>
  );
}

// ───────────── interiors ─────────────
function Office() {
  return (
    <>
      {(P.desks as Vec2[]).map(([x, y], i) => <Prop key={`d${i}`} name="desk_set" at={[x, 0.015, -y]} rotY={i % 2 ? Math.PI : 0} />)}
      <Prop name="rack_42u" at={[(P.rack as Vec2)[0], 0.015, -(P.rack as Vec2)[1]]} rotY={Math.PI / 2} />
      <mesh position={[(P.reception as Vec2)[0], 0.55, -(P.reception as Vec2)[1]]} geometry={boxGeo(1.0, 1.1, 3.2)} material={MAT.wood()} castShadow receiveShadow />
      <Prop name="meeting_table" at={[-24, 0.015, -20]} />
      {[[-2, 2], [-2, 23], [-38, 23], [-20, 12]].map(([x, y], i) => <Prop key={`pl${i}`} name="plant_pot" at={[x, 0.015, -y]} />)}
      {LAYOUT.transmitters.filter((t) => t.net === 'office-corp').map((t) => <Prop key={t.id} name="ap_ceiling" at={[t.pos[0], 3.0, -t.pos[1]]} />)}
    </>
  );
}

function Cafe() {
  const ap = LAYOUT.transmitters.find((t) => t.id === 'ap-cafe')!;
  const [ax, ay] = P.attackerSeat as Vec2;
  return (
    <>
      <Prop name="cafe_counter" at={[-18.5, 0.015, 127]} rotY={-Math.PI / 2} />
      {(P.cafeTables as Vec2[]).map(([x, y], i) => <Prop key={`t${i}`} name="cafe_table" at={[x, x > 1 ? 0.12 : 0.015, -y]} rotY={0} />)}
      {/* the café's own router, on a column by the counter */}
      <mesh position={[ap.pos[0] + 0.2, 1.6, -ap.pos[1]]} geometry={boxGeo(0.3, 3.2, 0.3)} material={MAT.paint('#e8e2d6')} castShadow />
      <Prop name="ap_cafe" at={[ap.pos[0], ap.pos[2], -ap.pos[1]]} rotY={-Math.PI / 2} />
      {/* the customer at the corner table: a laptop and a small USB adapter, like everyone else */}
      <Prop name="laptop" at={[ax, 0.745, -(ay - 0.2)]} />
      <Prop name="adapter_usb" at={[ax + 0.22, 0.745, -(ay - 0.12)]} />
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
      out.push({ p: [x, desertHeight(x, y) - 0.2, -y], s: 0.4 + rnd() * 2.2, r: rnd() * 6 });
    }
    return out;
  }, []);
  return (
    <>
      <mesh geometry={geo} material={MAT.sand()} receiveShadow />
      <mesh geometry={ridge}><meshStandardMaterial color="#8a6a52" roughness={1} /></mesh>
      {rocks.map((r, i) => <Prop key={i} name="rock" at={r.p} rotY={r.r} scale={r.s} />)}
    </>
  );
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
