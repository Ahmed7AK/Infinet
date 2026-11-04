/**
 * The player and the background people (plan §5, §12.5). The figure is the Blender placeholder mannequin
 * (tools/blender/build_all.py → mannequin.glb): rigid parts under named joints, animated here in code
 * (speed-driven walk cycle, a phone pose, a seated pose). The Mixamo character replaces it later (PROGRESS.md).
 * Model forward is three +Z; `faceCompass` turns it to a compass heading.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Vec2 } from '../../engine/index';
import { driver, useUi } from '../driver';
import { useModel } from './assets';

const faceCompass = (deg: number) => ((180 - deg) * Math.PI) / 180;

type Rig = Record<string, THREE.Object3D | undefined>;
const JOINTS = ['Hips', 'Spine', 'Neck', 'Head', 'Thigh_L', 'Thigh_R', 'Shin_L', 'Shin_R', 'Foot_L', 'Foot_R', 'UpperArm_L', 'UpperArm_R', 'LowerArm_L', 'LowerArm_R', 'Hand_L', 'Hand_R'];
function rigOf(o: THREE.Object3D): Rig {
  const r: Rig = {};
  for (const j of JOINTS) r[j] = o.getObjectByName(j);
  return r;
}

/** pose a rig. phase in radians, amp 0..1 (0 = standing), sit, phone (0..1 how raised) */
function pose(r: Rig, phase: number, amp: number, sit = false, phone = 0) {
  const s = Math.sin(phase), c = Math.cos(phase);
  const set = (j: string, x: number, z = 0) => { const o = r[j]; if (o) { o.rotation.x = x; o.rotation.z = z; } };
  if (sit) {
    set('Thigh_L', -1.5); set('Thigh_R', -1.45); set('Shin_L', 1.5); set('Shin_R', 1.4);
    set('UpperArm_L', -0.5, 0.05); set('UpperArm_R', -0.5, -0.05); set('LowerArm_L', -0.9); set('LowerArm_R', -0.9);
    set('Spine', -0.05); set('Head', 0.15);
    if (r.Hips) r.Hips.position.y = 0.52;
    return;
  }
  if (r.Hips) r.Hips.position.y = 0.95 - Math.abs(c) * 0.03 * amp;
  set('Thigh_L', -0.5 * s * amp); set('Thigh_R', 0.5 * s * amp);
  set('Shin_L', (0.15 + 0.6 * Math.max(0, -c)) * amp); set('Shin_R', (0.15 + 0.6 * Math.max(0, c)) * amp);
  set('Foot_L', 0); set('Foot_R', 0);
  set('UpperArm_L', 0.35 * s * amp, 0.06); set('LowerArm_L', -0.15 - 0.2 * amp);
  // right arm: swings, or holds the phone up in front of the chest
  const sw = 0.35 * -s * amp * (1 - phone);
  set('UpperArm_R', sw - 0.55 * phone, -0.06 - 0.15 * phone); set('LowerArm_R', -0.15 - 0.2 * amp * (1 - phone) - 1.25 * phone);
  set('Spine', 0.04 * amp); set('Head', 0.32 * phone);
}

/** phone in the right hand */
function usePhoneInHand(rig: Rig) {
  const phone = useModel('phone_hand', { shadows: false });
  useMemo(() => {
    const h = rig.Hand_R;
    if (!h) return;
    phone.position.set(0, -0.09, 0.02);
    phone.rotation.set(-Math.PI / 2 + 0.25, 0, 0);
    h.add(phone);
  }, [phone, rig]);
  return phone;
}

export function Player() {
  const obj = useModel('mannequin');
  const rig = useMemo(() => rigOf(obj), [obj]);
  const phone = usePhoneInHand(rig);
  const g = useRef<THREE.Group>(null);
  const st = useRef({ yaw: 0, phase: 0, amp: 0, phone: 0, init: false });
  useFrame((_, dt) => {
    const s = driver.snap;
    const { pos, vel, headingDeg } = s.player;
    const sp = Math.hypot(vel[0], vel[1]);
    const k = st.current;
    const target = faceCompass(headingDeg);
    if (!k.init) { k.yaw = target; k.init = true; }
    let d = target - k.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    k.yaw += d * (1 - Math.exp(-dt * 8));
    k.amp += (Math.min(1, sp / 1.4) - k.amp) * (1 - Math.exp(-dt * 6));
    k.phase += dt * sp * 4.2;
    const up = useUi.getState().phoneUp ? 1 : 0.35;
    k.phone += (up - k.phone) * (1 - Math.exp(-dt * 7));
    pose(rig, k.phase, k.amp, false, k.phone);
    g.current?.position.set(pos[0], s.zone === 'desert' ? 0.16 : groundAt(pos), -pos[1]);
    if (g.current) g.current.rotation.y = k.yaw;
    // the screen glows with the call state (product layer, diegetic)
    const scr = phone.getObjectByName('Screen') as THREE.Mesh | undefined;
    const m = scr?.material as THREE.MeshStandardMaterial | undefined;
    if (m) {
      const cs = s.policies.infinet?.callState;
      m.emissive.set(cs === 'frozen' || cs === 'dropped' ? '#F87171' : '#67E8F9');
      m.emissiveIntensity = 0.6 + 1.2 * k.phone;
    }
  });
  return <group ref={g}><primitive object={obj} /></group>;
}

/** sidewalks are a 12 cm step up from the road */
const SW = [[2, 8], [24, 30]];
function groundAt(p: Vec2) {
  if (p[1] < 40 && p[1] > -260 && SW.some(([a, b]) => p[0] >= a && p[0] <= b)) return 0.12;
  return 0.015;
}

// ───────────── background people (few; they're ambience) ─────────────
interface Npc { at: Vec2; face: number; sit?: boolean; walk?: { from: number; to: number; speed: number }; shirt: string; trousers: string; h?: number }
const SHIRTS = ['#e8e6e1', '#47556b', '#8b3f3a', '#6c7a5c', '#c9b48f', '#2f3540', '#9fb4c7'];
const NPCS: Record<string, Npc[]> = {
  office: [
    { at: [-36, 2.4], face: 0, sit: true, shirt: SHIRTS[0], trousers: '#2a2d33' },
    { at: [-30, 7.6], face: 180, sit: true, shirt: SHIRTS[1], trousers: '#3b3a36' },
    { at: [-11.9, 13.4], face: 0, sit: true, shirt: SHIRTS[6], trousers: '#1f2228' },
    { at: [-3.2, 18], face: 270, shirt: SHIRTS[5], trousers: '#1d1f24' },
    { at: [-22, 18.5], face: 120, shirt: SHIRTS[4], trousers: '#3a332b' },
  ],
  street: [
    { at: [5, -40], face: 180, walk: { from: -30, to: -110, speed: 1.2 }, shirt: SHIRTS[2], trousers: '#24262b' },
    { at: [27, -60], face: 0, walk: { from: -150, to: -20, speed: 1.35 }, shirt: SHIRTS[3], trousers: '#3b3a36' },
    { at: [5.6, -132], face: 90, shirt: SHIRTS[0], trousers: '#2a2d33' },
    // café
    { at: [-20.2, -127], face: 90, shirt: '#1c1c1c', trousers: '#1c1c1c' },
    { at: [-6, -129.62], face: 0, sit: true, shirt: SHIRTS[4], trousers: '#2a2d33' },
    { at: [-17, -133.38], face: 180, sit: true, shirt: SHIRTS[1], trousers: '#3b3a36' },
    { at: [4, -126.62], face: 0, sit: true, shirt: SHIRTS[6], trousers: '#24262b' },
    // the customer with the laptop (the attacker looks like everyone else)
    { at: [-4, -136.62], face: 0, sit: true, shirt: SHIRTS[5], trousers: '#1d1f24' },
  ],
  office_street: [],
  desert: [
    { at: [11995.5, -3.6], face: 40, shirt: '#d2b77a', trousers: '#4a4436' },
  ],
};

function Person({ n }: { n: Npc }) {
  const obj = useModel('mannequin', { tint: { Shirt: n.shirt, Trousers: n.trousers } });
  const rig = useMemo(() => rigOf(obj), [obj]);
  const g = useRef<THREE.Group>(null);
  const ph = useRef(Math.random() * 10);
  useFrame((_, dt) => {
    const grp = g.current;
    if (!grp) return;
    if (n.walk) {
      const { from, to, speed } = n.walk;
      const L = Math.abs(to - from);
      ph.current += dt * speed;
      const u = ph.current % (2 * L);
      const fwd = u < L;
      const y = fwd ? from + Math.sign(to - from) * u : to - Math.sign(to - from) * (u - L);
      const dir = (fwd ? Math.sign(to - from) : -Math.sign(to - from)) > 0 ? 0 : 180;
      grp.position.set(n.at[0], 0.12, -y);
      grp.rotation.y = faceCompass(dir);
      pose(rig, ph.current * 3, 1);
    } else {
      pose(rig, 0, 0, n.sit);
      ph.current += dt;
      if (rig.Head && !n.sit) rig.Head.rotation.y = 0.3 * Math.sin(ph.current * 0.3);
    }
  });
  const y = groundAt(n.at);
  return <group ref={g} position={[n.at[0], y, -n.at[1]]} rotation-y={faceCompass(n.face)}><primitive object={obj} /></group>;
}

export function People({ zone }: { zone: string }) {
  const list = zone === 'desert' ? NPCS.desert : [...NPCS.office, ...NPCS.street];
  return (
    <>
      <Player />
      {list.map((n, i) => <Person key={`${zone}${i}`} n={n} />)}
    </>
  );
}
