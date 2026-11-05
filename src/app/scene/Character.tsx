/**
 * The player and the background people (plan §5, §12.5): Microsoft Rocketbox people (MIT), converted by
 * tools/blender/import_rocketbox.py. Each person is a skinned GLB on the shared Bip01 skeleton; each clip is its own
 * small file per body type (anim_m_walk.glb, anim_f_sit.glb, …) and plays on any person of that type, matched by bone name.
 *
 * The player blends idle / walk / run by speed, and holds the phone with an upper-body layer on top:
 * at the ear on the call while the phone UI is down, in front of the chest (texting) while it is up or the call dropped.
 * Model forward is three +Z; `faceCompass` turns it to a compass heading.
 */
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Vec2 } from '../../engine/index';
import { driver, useUi } from '../driver';
import { useModel } from './assets';

const faceCompass = (deg: number) => ((180 - deg) * Math.PI) / 180;

// ───────────── people and clips ─────────────
export const PEOPLE = {
  player: 'm', office_f1: 'f', office_m1: 'm', office_m2: 'm', office_f2: 'f', office_m3: 'm',
  street_m1: 'm', street_f1: 'f', barista: 'm', cafe_f1: 'f', cafe_m1: 'm', cafe_f2: 'f', cafe_m2: 'm', site_m1: 'm',
} as const satisfies Record<string, 'm' | 'f'>;
export type Who = keyof typeof PEOPLE;
type Sex = 'm' | 'f';
type Clip = 'idle' | 'look' | 'talk' | 'text' | 'call' | 'sit' | 'sit_table' | 'walk' | 'run';

const CLIPS: Record<Sex, Clip[]> = {
  m: ['idle', 'look', 'talk', 'text', 'call', 'sit', 'sit_table', 'walk', 'run'],
  f: ['idle', 'look', 'talk', 'text', 'sit', 'sit_table', 'walk', 'run'], // (no female phone-call clip in the library)
};
const personUrl = (w: Who) => `/models/people/${w}.glb`;
const animUrls = (s: Sex) => CLIPS[s].map((c) => `/models/people/anim_${s}_${c}.glb`);
useGLTF.preload(animUrls('m'));
useGLTF.preload(animUrls('f'));
useGLTF.preload(personUrl('player'));

const R_ARM = /^Bip01_R_(Clavicle|UpperArm|Forearm|Hand|Finger)/;
const L_ARM = /^Bip01_L_(Clavicle|UpperArm|Forearm|Hand|Finger)/;
const HEAD = /^Bip01_(Neck|Head)/;
const bone = (t: THREE.KeyframeTrack) => t.name.slice(0, t.name.lastIndexOf('.'));

/**
 * Keep rotations everywhere, the root's position (Bip01: the body's height, e.g. 0.61 m seated vs 0.92 m standing)
 * and the thighs' (in a Biped rig they hang off the spine, so their offset moves as the spine bends); other bone
 * positions would impose the clip skeleton's proportions. The root's horizontal travel is
 * pinned to its first frame: the walk and run clips carry their stride (1.46 m per 1.2 s, 2.02 m per 0.8 s) and the
 * scene moves people itself.
 */
function tidy(c: THREE.AnimationClip, name: string) {
  // trimmed clips start part-way in (texting at frame 61): shift every key so the clip starts at 0
  const t0 = Math.min(...c.tracks.map((t) => t.times[0]));
  const keep = (n: string) => n.endsWith('.quaternion') || n === 'Bip01.position' || /_Thigh\.position$/.test(n);
  const tracks = c.tracks.filter((t) => keep(t.name)).map((t) => {
    const times = Array.from(t.times, (x) => x - t0);
    const v = Array.from(t.values);
    if (t.name === 'Bip01.position') for (let i = 0; i < v.length; i += 3) { v[i] = t.values[0]; v[i + 2] = t.values[2]; }
    return t.name.endsWith('.quaternion') ? new THREE.QuaternionKeyframeTrack(t.name, times, v) : new THREE.VectorKeyframeTrack(t.name, times, v);
  });
  return new THREE.AnimationClip(name, c.duration - t0, tracks);
}
/** the ground speed each locomotion clip was captured at (root travel ÷ clip length, measured from anim_m.glb) */
const CLIP_SPEED = { walk: 1.21, run: 2.53 };
function part(c: THREE.AnimationClip, keep: (b: string) => boolean, name: string) {
  return new THREE.AnimationClip(name, c.duration, c.tracks.filter((t) => keep(bone(t))));
}

const clipCache = new Map<Sex, Record<string, THREE.AnimationClip>>();
function useClips(sex: Sex) {
  const files = useGLTF(animUrls(sex));
  let c = clipCache.get(sex);
  if (!c) {
    c = {};
    CLIPS[sex].forEach((name, i) => { c![name] = tidy(files[i].animations[0], name); });
    clipCache.set(sex, c);
  }
  return c;
}

/**
 * Hair cards ship with normals that often point into the scalp, so half of them render black. Point every normal
 * away from the centre of the hair instead (the usual hair-card trick): smooth, rounded shading. Shared geometry,
 * so this runs once per person file.
 */
const rounded = new WeakSet<THREE.BufferGeometry>();
function sphericalNormals(g: THREE.BufferGeometry) {
  if (rounded.has(g)) return;
  rounded.add(g);
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute | undefined;
  if (!n) return;
  g.computeBoundingBox();
  const c = g.boundingBox!.getCenter(new THREE.Vector3());
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(c).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  n.needsUpdate = true;
}

/** a skinned clone of a person, with materials set up for the realistic renderer */
function usePerson(who: Who) {
  const { scene } = useGLTF(personUrl(who));
  return useMemo(() => {
    const o = cloneSkinned(scene);
    o.traverse((x) => {
      const m = x as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false; // bounds come from the bind pose; a seated or walking pose can leave them
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats as THREE.MeshStandardMaterial[]) {
        if (/opacity/i.test(mat.name)) {
          // hair, lashes and brows are alpha cards: cut them out instead of sorting them. Thin cards a few mm off
          // the scalp streak when they shadow themselves: no shadows, and matte.
          mat.transparent = false;
          mat.alphaTest = 0.4;
          mat.depthWrite = true;
          mat.side = THREE.DoubleSide;
          mat.roughness = 0.85;
          // cards that face away from the sun go black under the AO pass; a little light from the hair's own
          // texture keeps them reading as hair (unlit, the texture is a clean brown: checked on screenshots)
          mat.emissiveMap = mat.map;
          mat.emissive.setScalar(0.12);
          const phys = mat as THREE.MeshPhysicalMaterial;
          if (phys.isMeshPhysicalMaterial) phys.specularIntensity = 0.3;
          m.castShadow = false;
          m.receiveShadow = false;
          sphericalNormals(m.geometry);
        }
        mat.envMapIntensity = 0.8;
      }
    });
    return o;
  }, [scene]);
}

// ───────────── the player ─────────────
/** phone in the right hand. Offsets are in metres in the hand bone's frame (tuned on screenshots). */
const PHONE_AT = { pos: [0.085, 0.02, -0.035] as [number, number, number], rot: [Math.PI / 2, 0, Math.PI / 2 + 0.25] as [number, number, number] };

function usePhoneInHand(obj: THREE.Object3D) {
  const phone = useModel('phone_hand', { shadows: false });
  useEffect(() => {
    const h = obj.getObjectByName('Bip01_R_Hand');
    if (!h) return;
    obj.updateMatrixWorld(true);
    const s = h.getWorldScale(new THREE.Vector3()).x; // bones are in centimetres under a 0.01 armature
    phone.scale.setScalar(1 / s);
    h.add(phone);
    return () => { h.remove(phone); };
  }, [obj, phone]);
  return phone;
}

export function Player() {
  const obj = usePerson('player');
  const clips = useClips('m');
  const phone = usePhoneInHand(obj);
  const g = useRef<THREE.Group>(null);
  const rig = useMemo(() => {
    const mixer = new THREE.AnimationMixer(obj);
    const notCall = (b: string) => !R_ARM.test(b) && !HEAD.test(b);
    const notText = (b: string) => notCall(b) && !L_ARM.test(b);
    const loco = (['idle', 'walk', 'run'] as const).map((k) => ({
      call: mixer.clipAction(part(clips[k], notCall, `${k}_c`)),
      text: mixer.clipAction(part(clips[k], notText, `${k}_t`)),
    }));
    const call = mixer.clipAction(part(clips.call, (b) => R_ARM.test(b) || HEAD.test(b), 'call_o'));
    const text = mixer.clipAction(part(clips.text, (b) => R_ARM.test(b) || L_ARM.test(b) || HEAD.test(b), 'text_o'));
    for (const a of [...loco.flatMap((l) => [l.call, l.text]), call, text]) { a.play(); a.setEffectiveWeight(0); }
    call.setLoop(THREE.LoopPingPong, Infinity);
    text.setLoop(THREE.LoopPingPong, Infinity);
    loco[0].call.setLoop(THREE.LoopPingPong, Infinity);
    loco[0].text.setLoop(THREE.LoopPingPong, Infinity);
    return { mixer, loco, call, text };
  }, [obj, clips]);
  useEffect(() => () => { rig.mixer.stopAllAction(); }, [rig]);
  const st = useRef({ yaw: 0, sp: 0, txt: 0, init: false });
  useFrame((_, dt) => {
    const s = driver.snap;
    const { pos, vel, headingDeg } = s.player;
    const k = st.current;
    const target = faceCompass(headingDeg);
    if (!k.init) { k.yaw = target; k.init = true; }
    let d = target - k.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    k.yaw += d * (1 - Math.exp(-dt * 8));
    k.sp += (Math.hypot(vel[0], vel[1]) - k.sp) * (1 - Math.exp(-dt * 8));
    const cs = s.policies.infinet?.callState;
    const wantText = useUi.getState().phoneUp || cs === 'dropped' ? 1 : 0;
    k.txt += (wantText - k.txt) * (1 - Math.exp(-dt * 6));
    // locomotion weights: idle → walk (0–1.2 m/s) → run (1.6–3.0 m/s); clip speed follows the ground speed
    const walk = THREE.MathUtils.smoothstep(k.sp, 0.05, 1.0);
    const run = THREE.MathUtils.smoothstep(k.sp, 1.7, 2.8);
    const w = [1 - walk, walk * (1 - run), walk * run];
    rig.loco.forEach((l, i) => {
      l.call.setEffectiveWeight(w[i] * (1 - k.txt));
      l.text.setEffectiveWeight(w[i] * k.txt);
    });
    const ws = Math.max(0.5, k.sp / CLIP_SPEED.walk), rs = Math.max(0.6, k.sp / CLIP_SPEED.run);
    rig.loco[1].call.timeScale = rig.loco[1].text.timeScale = ws;
    rig.loco[2].call.timeScale = rig.loco[2].text.timeScale = rs;
    rig.call.setEffectiveWeight(1 - k.txt);
    rig.text.setEffectiveWeight(k.txt);
    rig.mixer.update(dt);
    g.current?.position.set(pos[0], s.zone === 'desert' ? 0.16 : groundAt(pos), -pos[1]);
    if (g.current) g.current.rotation.y = k.yaw;
    // the phone: tuning hook (window.__phoneAt) and the screen glow with the call state (product layer, diegetic)
    const at = (window as unknown as { __phoneAt?: typeof PHONE_AT }).__phoneAt ?? PHONE_AT;
    phone.position.set(...at.pos).multiplyScalar(phone.scale.x);
    phone.rotation.set(...at.rot);
    const scr = phone.getObjectByName('Screen') as THREE.Mesh | undefined;
    const m = scr?.material as THREE.MeshStandardMaterial | undefined;
    if (m) {
      m.emissive.set(cs === 'frozen' || cs === 'dropped' ? '#F87171' : '#67E8F9');
      m.emissiveIntensity = 0.5 + 1.3 * k.txt;
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
interface Npc { who: Who; at: Vec2; face: number; act: Exclude<Clip, 'walk' | 'run'>; walk?: { from: number; to: number; speed: number } }
const NPCS: Record<'office' | 'street' | 'desert', Npc[]> = {
  office: [
    { who: 'office_f1', at: [-36, 2.4], face: 0, act: 'sit_table' },
    { who: 'office_m1', at: [-30, 7.6], face: 180, act: 'sit_table' },
    { who: 'office_m2', at: [-11.9, 13.4], face: 0, act: 'sit_table' },
    // at reception: the receptionist behind the desk and a visitor in front of it
    { who: 'office_f2', at: [-5.0, 18], face: 90, act: 'idle' },
    { who: 'office_m3', at: [-2.9, 18.2], face: 270, act: 'talk' },
  ],
  street: [
    { who: 'street_m1', at: [5, -40], face: 180, act: 'idle', walk: { from: -30, to: -110, speed: 1.25 } },
    { who: 'street_f1', at: [27, -60], face: 0, act: 'idle', walk: { from: -150, to: -20, speed: 1.2 } },
    { who: 'site_m1', at: [5.6, -133], face: 90, act: 'text' },
    // café (seats measured on the bistro set: chair 1 at +0.085, −0.57 m from the table origin, chair 2 at −0.015, +0.51 m)
    { who: 'barista', at: [-20.2, -127], face: 90, act: 'idle' },
    { who: 'cafe_f1', at: [-5.915, -129.57], face: 0, act: 'sit_table' },
    { who: 'cafe_m1', at: [-17.015, -133.49], face: 180, act: 'sit_table' },
    { who: 'cafe_f2', at: [4.085, -126.57], face: 0, act: 'sit' },
    // the customer with the laptop (the attacker looks like everyone else)
    { who: 'cafe_m2', at: [-3.915, -136.57], face: 0, act: 'sit_table' },
  ],
  desert: [
    { who: 'site_m1', at: [11995.5, -3.6], face: 40, act: 'look' },
  ],
};

function Person({ n }: { n: Npc }) {
  const obj = usePerson(n.who);
  const clips = useClips(PEOPLE[n.who]);
  const g = useRef<THREE.Group>(null);
  const mixer = useMemo(() => {
    const mx = new THREE.AnimationMixer(obj);
    const a = mx.clipAction(clips[n.walk ? 'walk' : n.act] ?? clips.idle);
    if (!n.walk) a.setLoop(THREE.LoopPingPong, Infinity);
    a.play();
    a.time = Math.random() * a.getClip().duration; // nobody moves in step with anybody else
    if (n.walk) a.timeScale = n.walk.speed / CLIP_SPEED.walk;
    return mx;
  }, [obj, clips, n]);
  useEffect(() => () => { mixer.stopAllAction(); }, [mixer]);
  const ph = useRef(Math.random() * 100);
  useFrame((_, dt) => {
    const grp = g.current;
    if (!grp) return;
    mixer.update(dt);
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
