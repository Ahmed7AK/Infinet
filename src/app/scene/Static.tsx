/**
 * Static world built from src/world/layout.json — the same polylines the radio model uses (plan D9).
 * Walls are drawn 1.5 m high and cut away so the inside shows (style guide p. 21). Two shades per object.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { LAYOUT } from '../../engine/index';
import type { Vec2 } from '../../engine/index';
import { color } from '../tokens';

const WALL_H = 1.5;
const mat = {
  wall: new THREE.MeshLambertMaterial({ color: color.night3 }),
  glass: new THREE.MeshLambertMaterial({ color: '#2C3560', transparent: true, opacity: 0.75 }),
  metal: new THREE.MeshLambertMaterial({ color: '#2B3044' }),
  block: new THREE.MeshLambertMaterial({ color: color.night2 }),
  floor: new THREE.MeshBasicMaterial({ color: '#10121F' }),
  prop: new THREE.MeshLambertMaterial({ color: color.night3 }),
  propDark: new THREE.MeshLambertMaterial({ color: '#1B1E2E' }),
  road: new THREE.MeshBasicMaterial({ color: '#0E1019' }),
  walk: new THREE.MeshBasicMaterial({ color: '#12141F' }),
  dash: new THREE.MeshBasicMaterial({ color: color.steel }),
  person: new THREE.MeshLambertMaterial({ color: color.steel }),
  palm: new THREE.MeshLambertMaterial({ color: '#2A3048' }),
};

function shapeOf(poly: Vec2[]): THREE.Shape {
  const s = new THREE.Shape();
  poly.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

function Box({ at, size, rotY = 0, m }: { at: [number, number, number]; size: [number, number, number]; rotY?: number; m: THREE.Material }) {
  return (
    <mesh position={at} rotation-y={rotY} material={m}>
      <boxGeometry args={size} />
    </mesh>
  );
}

function Walls() {
  const items = useMemo(() => LAYOUT.walls.filter((w) => !w.door).map((w, i) => {
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
    const len = Math.hypot(dx, dy);
    const glass = w.material.includes('glass');
    const metal = w.material === 'metal';
    const h = w.rfIgnore ? 1.05 : Math.min(WALL_H, w.h);
    const thick = glass ? 0.12 : w.rfIgnore ? 0.6 : 0.22;
    return {
      key: i,
      at: [(w.a[0] + w.b[0]) / 2, h / 2, -(w.a[1] + w.b[1]) / 2] as [number, number, number],
      size: [len + thick * 0.5, h, thick] as [number, number, number],
      rotY: Math.atan2(dy, dx),
      m: glass ? mat.glass : metal ? mat.metal : mat.wall,
    };
  }), []);
  return <>{items.map((w) => <Box key={w.key} at={w.at} size={w.size} rotY={w.rotY} m={w.m} />)}</>;
}

function Buildings() {
  const geos = useMemo(() => LAYOUT.buildings.map((b) => {
    if (b.kind === 'block') {
      const g = new THREE.ExtrudeGeometry(shapeOf(b.poly), { depth: WALL_H, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      return { id: b.id, g, m: mat.block, y: 0 };
    }
    const g = new THREE.ShapeGeometry(shapeOf(b.poly));
    g.rotateX(-Math.PI / 2);
    return { id: b.id, g, m: mat.floor, y: 0.01 };
  }), []);
  return <>{geos.map((b) => <mesh key={b.id} geometry={b.g} material={b.m} position-y={b.y} />)}</>;
}

function Street() {
  const { road, sidewalks } = LAYOUT.street;
  const rect = (r: [Vec2, Vec2], m: THREE.Material, y: number, key: string) => {
    const [[x0, y0], [x1, y1]] = r;
    return (
      <mesh key={key} position={[(x0 + x1) / 2, y, -(y0 + y1) / 2]} rotation-x={-Math.PI / 2} material={m}>
        <planeGeometry args={[x1 - x0, y1 - y0]} />
      </mesh>
    );
  };
  const cx = (road[0][0] + road[1][0]) / 2;
  const dashes: JSX.Element[] = [];
  for (let y = road[0][1] + 3; y < road[1][1]; y += 9) dashes.push(rect([[cx - 0.1, y], [cx + 0.1, y + 3.5]], mat.dash, 0.006, `d${y}`));
  return (
    <>
      {rect(road, mat.road, 0.002, 'road')}
      {sidewalks.map((s, i) => rect(s, mat.walk, 0.003, `sw${i}`))}
      {dashes}
    </>
  );
}

function Props() {
  const P = LAYOUT.props;
  const out: JSX.Element[] = [];
  (P.desks as Vec2[]).forEach(([x, y], i) => out.push(<Box key={`desk${i}`} at={[x, 0.37, -y]} size={[1.6, 0.74, 0.8]} m={mat.prop} />));
  (P.cafeTables as Vec2[]).forEach(([x, y], i) => out.push(<Box key={`tab${i}`} at={[x, 0.37, -y]} size={[0.8, 0.74, 0.8]} m={mat.prop} />));
  (P.palms as Vec2[]).forEach(([x, y], i) => {
    out.push(<Box key={`pt${i}`} at={[x, 2.2, -y]} size={[0.3, 4.4, 0.3]} m={mat.palm} />);
    out.push(<Box key={`pl${i}`} at={[x, 4.4, -y]} size={[1.8, 0.3, 1.8]} rotY={Math.PI / 4} m={mat.palm} />);
  });
  (P.cars as Array<[number, number, number]>).forEach(([x, y, h], i) => {
    out.push(<Box key={`car${i}`} at={[x, 0.55, -y]} size={[1.8, 1.1, 4.4]} rotY={(h * Math.PI) / 180} m={mat.prop} />);
    out.push(<Box key={`cab${i}`} at={[x, 1.3, -y + (h ? -0.2 : 0.2)]} size={[1.6, 0.5, 2.2]} rotY={(h * Math.PI) / 180} m={mat.propDark} />);
  });
  (P.lamps as Vec2[]).forEach(([x, y], i) => out.push(<Box key={`lamp${i}`} at={[x, 3, -y]} size={[0.14, 6, 0.14]} m={mat.prop} />));
  const [rx, ry] = P.rack as Vec2;
  out.push(<Box key="rack" at={[rx, 1, -ry]} size={[0.6, 2, 1]} m={mat.metal} />);
  const [cx, cy] = P.reception as Vec2;
  out.push(<Box key="rec" at={[cx, 0.55, -cy]} size={[1, 1.1, 3]} m={mat.prop} />);
  const [gx, gy] = P.generator as Vec2;
  out.push(<Box key="gen" at={[gx, 0.6, -gy]} size={[2.2, 1.2, 1.2]} m={mat.metal} />);
  const fence = P.fence as Vec2[];
  fence.forEach((a, i) => {
    const b = fence[(i + 1) % fence.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    out.push(<Box key={`f${i}`} at={[(a[0] + b[0]) / 2, 0.6, -(a[1] + b[1]) / 2]} size={[len, 1.2, 0.05]} rotY={Math.atan2(b[1] - a[1], b[0] - a[0])} m={mat.glass} />);
  });
  // other people: steel columns (anonymous, like other people's networks)
  const people: Vec2[] = [[-35, 5], [-29, 14], [-12, 9], [-15, -131], [-9, -127], [3, -132], [15, -50]];
  people.forEach(([x, y], i) => out.push(<Box key={`pp${i}`} at={[x, 0.85, -y]} size={[0.42, 1.7, 0.42]} m={mat.person} />));
  // the customer at the corner table, with a laptop and a small USB adapter: looks like everyone else
  const [ax, ay] = P.attackerSeat as Vec2;
  out.push(<Box key="att" at={[ax - 0.7, 0.85, -ay]} size={[0.42, 1.7, 0.42]} m={mat.person} />);
  out.push(<Box key="lap" at={[ax, 0.78, -ay]} size={[0.34, 0.03, 0.24]} m={mat.propDark} />);
  return <>{out}</>;
}

export function Static({ zone }: { zone: string }) {
  void zone;
  return (
    <group>
      <Street />
      <Buildings />
      <Walls />
      <Props />
    </group>
  );
}

import type { JSX } from 'react';
