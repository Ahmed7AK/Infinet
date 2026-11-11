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
import { isArea, LAYOUT, VENUE, type Vec2 } from '../../engine/index';
import { AREA_NPCS } from './areas/people';
import { driver, useUi } from '../driver';
import { useModel } from './assets';
import { crowd } from './crowd';

const faceCompass = (deg: number) => ((180 - deg) * Math.PI) / 180;

// ───────────── people and clips ─────────────
export const PEOPLE = {
  player: 'm', office_f1: 'f', office_m1: 'm', office_m2: 'm', office_f2: 'f', office_m3: 'm',
  street_m1: 'm', street_f1: 'f', barista: 'm', cafe_f1: 'f', cafe_m1: 'm', cafe_f2: 'f', cafe_m2: 'm', site_m1: 'm',
  office_f3: 'f', office_m4: 'm', office_m5: 'm', office_f4: 'f', office_m6: 'm', office_f5: 'f', guard: 'm',
  street_m2: 'm', street_m3: 'm', street_m4: 'm', street_m5: 'm', street_f2: 'f', street_f3: 'f', street_f4: 'f', street_f5: 'f',
  gardener: 'm', cafe_f3: 'f', cafe_m3: 'm', cafe_f4: 'f', cafe_m4: 'm', site_m2: 'm', site_m3: 'm', site_m4: 'm',
} as const satisfies Record<string, 'm' | 'f'>;
export type Who = keyof typeof PEOPLE;
type Sex = 'm' | 'f';
type Clip = 'idle' | 'look' | 'talk' | 'text' | 'call' | 'sit' | 'sit_table' | 'walk' | 'run'
  | 'stroll' | 'sit_think' | 'sit_look' | 'sit_relax' | 'drink' | 'wait' | 'listen' | 'work' | 'work_mid' | 'crouch';

const SHARED: Clip[] = ['idle', 'look', 'talk', 'text', 'sit', 'sit_table', 'walk', 'run', 'stroll', 'sit_think', 'sit_look', 'sit_relax', 'drink', 'wait', 'listen', 'work', 'work_mid', 'crouch'];
const CLIPS: Record<Sex, Clip[]> = {
  m: [...SHARED, 'call'],
  f: SHARED, // (no female phone-call clip in the library)
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
/**
 * the ground speed each locomotion clip was captured at: root travel ÷ clip length, measured from the shipped
 * anim_<m|f>_*.glb (men's and women's clips have different strides: 1.21 m vs 1.46 m per walk cycle)
 */
const CLIP_SPEED: Record<Sex, { walk: number; stroll: number; run: number }> = {
  m: { walk: 1.01, stroll: 0.7, run: 2.88 },
  f: { walk: 1.21, stroll: 0.93, run: 2.76 },
};
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
    const ws = Math.max(0.5, k.sp / CLIP_SPEED.m.walk), rs = Math.max(0.6, k.sp / CLIP_SPEED.m.run);
    rig.loco[1].call.timeScale = rig.loco[1].text.timeScale = ws;
    rig.loco[2].call.timeScale = rig.loco[2].text.timeScale = rs;
    rig.call.setEffectiveWeight(1 - k.txt);
    rig.text.setEffectiveWeight(k.txt);
    rig.mixer.update(dt);
    g.current?.position.set(pos[0], groundAt(pos), -pos[1]);
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
  return <group ref={g}><primitive object={obj} /><Contact r={0.42} /></group>;
}

/**
 * A soft contact shadow at the feet: the occlusion right under a body that a shadow map is too coarse to give
 * (and the only grounding indoors away from the overhead light's frustum). One shared radial texture.
 */
let blobTex: THREE.Texture | null = null;
function contactTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}
const contactGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
function Contact({ r, opacity = 0.42 }: { r: number; opacity?: number }) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({
    map: contactTexture(), color: '#000', transparent: true, opacity, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }), [opacity]);
  return <mesh geometry={contactGeo} material={mat} position-y={0.006} scale={[2 * r, 1, 2 * r]} renderOrder={1} />;
}

/** sidewalks are a 12 cm step up from the road (drawn on past both ends of the street); the desert site stands on a 16 cm concrete pad */
const SW = [[2, 8], [24, 30]];
export function groundAt(p: Vec2) {
  if (p[0] < -5000) return 0.02; // the park, Downtown, the metro station and the souk: level paving
  if (p[0] > 30000) return 0.02; // the venue hall: event carpet on the concrete floor
  if (p[0] > 10000) return 0.16;
  if (p[1] < 300 && p[1] > -440 && SW.some(([a, b]) => p[0] >= a && p[0] <= b)) return 0.12;
  if (p[0] >= 8 && p[0] <= 24 && p[1] < 300 && p[1] > -440) return 0.0;
  return 0.015;
}


// ───────────── background people (ambience) ─────────────
type Act = Exclude<Clip, 'walk' | 'run' | 'stroll'>;
interface Walk {
  /** waypoints (engine coords); people walk to the end and back */
  path: Vec2[];
  speed: number;
  gait?: 'walk' | 'stroll';
  /** seconds standing at each end */
  pause?: number;
  /** the path crosses the road at the zebra: wait at the kerb until the traffic has stopped */
  crosses?: boolean;
}
export interface Npc { who: Who; at: Vec2; face: number; act: Act; walk?: Walk; lift?: number }

/** desk seats: the desk set's chair sits 0.1 m right of and 0.6 m in front of the desk (turned with odd desks) */
const DESKS = LAYOUT.props.desks as Vec2[];
const deskSeat = (i: number): { at: Vec2; face: number } => (i % 2
  ? { at: [DESKS[i][0] - 0.1, DESKS[i][1] + 0.6], face: 180 }
  : { at: [DESKS[i][0] + 0.1, DESKS[i][1] - 0.6], face: 0 });

/** the meeting room (x −30 … −22, y 19 … 25): its table and four chairs, shared with Zones.tsx */
export const MEETING = { table: [-26, 22] as Vec2, chairs: [[-26.7, 20.85, 0], [-25.3, 20.85, 0], [-26.7, 23.15, 180], [-25.3, 23.15, 180]] as Array<[number, number, number]> };
/** the bus shelter on the east pavement (opens west, to the road) and its bench seat */
export const SHELTER = { at: [27.6, -84] as Vec2, seat: [28.02, -83.1] as Vec2 };

const NPCS: Record<'office' | 'street' | 'desert', Npc[]> = {
  office: [
    { who: 'office_f1', ...deskSeat(0), act: 'sit_table' },
    { who: 'office_m1', ...deskSeat(3), act: 'sit_table' },
    { who: 'office_m2', ...deskSeat(10), act: 'sit_table' },
    { who: 'office_f3', ...deskSeat(2), act: 'sit_think' },
    { who: 'office_f5', ...deskSeat(7), act: 'sit_look' },
    // at reception: the receptionist behind the desk and a visitor in front of it; the guard by the door
    { who: 'office_f2', at: [-5.0, 18], face: 90, act: 'idle' },
    { who: 'office_m3', at: [-2.9, 18.2], face: 270, act: 'talk' },
    { who: 'guard', at: [-1.5, 15.4], face: 205, act: 'wait' },
    // a meeting: two at the table, one presenting at the screen
    { who: 'office_m5', at: [MEETING.chairs[0][0], MEETING.chairs[0][1]], face: 0, act: 'sit_table' },
    { who: 'office_f4', at: [MEETING.chairs[3][0], MEETING.chairs[3][1]], face: 180, act: 'sit_think' },
    { who: 'office_m4', at: [-23.1, 22.3], face: 260, act: 'talk' },
    // someone walking the aisles: down the west aisle, along the corridor, past the core to reception
    { who: 'office_m6', at: [-33, 1.4], face: 0, act: 'idle', walk: { path: [[-33, 1.4], [-33, 10], [-26.5, 10], [-26.5, 17.9], [-15, 17.9]], speed: 1.1, pause: 6 } },
  ],
  street: [
    // pavement walkers, both pavements, both ways (west pavement x 2 … 8, east 24 … 30)
    { who: 'street_m1', at: [6.3, 0], face: 180, act: 'idle', walk: { path: [[6.3, 35], [6.3, -250]], speed: 1.3 } },
    { who: 'street_f2', at: [6.8, 0], face: 0, act: 'idle', walk: { path: [[6.8, -250], [6.8, 35]], speed: 1.15 } },
    { who: 'street_m5', at: [6.5, 0], face: 0, act: 'idle', walk: { path: [[6.5, 30], [6.5, -200]], speed: 0.75, gait: 'stroll' } },
    { who: 'street_f5', at: [6.0, 0], face: 0, act: 'idle', walk: { path: [[6.0, -20], [6.0, -240]], speed: 1.1 } },
    { who: 'street_m3', at: [6.6, 0], face: 0, act: 'idle', walk: { path: [[6.6, -60], [6.6, 30]], speed: 1.2, pause: 4 } },
    { who: 'street_f1', at: [25.5, 0], face: 0, act: 'idle', walk: { path: [[25.5, 35], [25.5, -250]], speed: 1.2 } },
    { who: 'street_m2', at: [25.9, 0], face: 0, act: 'idle', walk: { path: [[25.9, -250], [25.9, 35]], speed: 1.35 } },
    { who: 'street_f3', at: [25.7, 0], face: 0, act: 'idle', walk: { path: [[25.7, -240], [25.7, 30]], speed: 0.9, gait: 'stroll' } },
    // someone crossing at the zebra, back and forth, waiting for the cars each time
    { who: 'cafe_f3', at: [6.4, -127.4], face: 90, act: 'wait', walk: { path: [[6.4, -127.4], [25.6, -127.4]], speed: 1.25, pause: 7, crosses: true } },
    // at the bus stop: one on the bench, one waiting
    { who: 'street_f4', at: SHELTER.seat, face: 270, act: 'sit', lift: 0.0 },
    { who: 'street_m4', at: [26.9, -87.3], face: 300, act: 'wait' },
    // the gardener at a palm
    { who: 'gardener', at: [4.65, -60.2], face: 260, act: 'crouch' },
    { who: 'site_m1', at: [5.6, -133], face: 90, act: 'text' },
    // café (seats measured on the bistro set: chair 1 at +0.085, −0.57 m from the table origin, chair 2 at −0.015, +0.51 m)
    { who: 'barista', at: [-20.2, -127], face: 90, act: 'work' },
    { who: 'cafe_f4', at: [-16.55, -125.4], face: 265, act: 'wait' },
    { who: 'cafe_f1', at: [-5.915, -129.57], face: 0, act: 'sit_table' },
    { who: 'cafe_m1', at: [-17.015, -133.49], face: 180, act: 'sit_table' },
    { who: 'cafe_f2', at: [4.085, -126.57], face: 0, act: 'sit' },
    // two friends at the round table (−12, −134): dining chairs 0.72 m either side
    { who: 'cafe_m3', at: [-12, -134.68], face: 0, act: 'sit_table' },
    { who: 'cafe_m4', at: [-12, -133.32], face: 180, act: 'sit_think' },
    // the customer with the laptop (the attacker looks like everyone else)
    { who: 'cafe_m2', at: [-3.915, -136.57], face: 0, act: 'sit_table' },
  ],
  desert: [
    { who: 'site_m1', at: [11995.5, -3.6], face: 40, act: 'look' },
    // at the power cabinet, at the picnic table, and walking the fence line
    { who: 'site_m2', at: [11989.0, -1.8], face: 270, act: 'work_mid' },
    { who: 'site_m3', at: [12012.8, 6.2], face: 90, act: 'sit_table' },
    { who: 'site_m4', at: [11984, 16], face: 90, act: 'idle', walk: { path: [[11984, 16], [12016, 16], [12016, -12]], speed: 1.0, pause: 5 } },
  ],
};
const SEATED: ReadonlySet<Act> = new Set(['sit', 'sit_table', 'sit_think', 'sit_look', 'sit_relax']);

/**
 * The venue hall's crowd comes from the venue file (where people stand, sit and walk on show day); each gets one of
 * the casual-dress people, spread so neighbours differ. Staff and site workers keep their own scenes.
 */
const CASUAL: Who[] = (Object.keys(PEOPLE) as Who[]).filter((w) => /^(street|cafe|office)_/.test(w));
const HALL_ACTS: ReadonlySet<string> = new Set(['idle', 'look', 'talk', 'text', 'sit', 'sit_table', 'sit_think', 'sit_look', 'sit_relax', 'drink', 'wait', 'listen', 'work', 'work_mid', 'crouch']);
const HALL_NPCS: Npc[] = (VENUE?.plan.people ?? []).map((p, i) => ({
  who: CASUAL[(i * 7) % CASUAL.length],
  at: p.at, face: p.face,
  act: (HALL_ACTS.has(p.act) ? p.act : 'idle') as Act,
  walk: p.walk ? { path: p.walk.path, speed: p.walk.speed, pause: p.walk.pause } : undefined,
}));
const ROAD_X: [number, number] = [LAYOUT.street.road[0][0], LAYOUT.street.road[1][0]];

/** a walker's state along its path: distance from the start, direction, and the seconds left to stand */
function pathLen(path: Vec2[]) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  return cum;
}
function pointAt(path: Vec2[], cum: number[], d: number): { p: Vec2; dir: Vec2 } {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const a = path[i - 1], b = path[i];
  const L = cum[i] - cum[i - 1] || 1;
  const t = Math.min(1, Math.max(0, (d - cum[i - 1]) / L));
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
}
const compassOf = (dx: number, dy: number) => (Math.atan2(dx, dy) * 180) / Math.PI;

/** people further than this from the camera are hidden and not animated (they still walk their paths) */
const CULL_M = 70;
/** the hall is one big crowded room: draw and animate only the people near the camera */
const CULL_HALL_M = 36;
/** … and only those this close to you cast shadows (the overhead light's shadow reaches about 14 m) */
const SHADOW_HALL_M = 15;
/** a bystander closer to the camera than this (on the ground plan) is not drawn */
const NEAR_CAM_M = 1.7;
/** the camera's view volume, refreshed once a frame, and a person's bounding sphere (skinned bounds are the bind pose) */
const frustum = new THREE.Frustum(), viewProj = new THREE.Matrix4(), body = new THREE.Sphere(new THREE.Vector3(), 1.3);
let frustumAt = -1;

function Person({ n, id }: { n: Npc; id: string }) {
  const obj = usePerson(n.who);
  const sex = PEOPLE[n.who];
  const clips = useClips(sex);
  const g = useRef<THREE.Group>(null);
  const rig = useMemo(() => {
    const mx = new THREE.AnimationMixer(obj);
    const idle = mx.clipAction(clips[n.act] ?? clips.idle);
    idle.setLoop(THREE.LoopPingPong, Infinity);
    idle.play();
    idle.time = Math.random() * idle.getClip().duration; // nobody moves in step with anybody else
    let gait: THREE.AnimationAction | null = null;
    if (n.walk) {
      const kind = n.walk.gait ?? 'walk';
      gait = mx.clipAction(clips[kind]);
      gait.play();
      gait.time = Math.random() * gait.getClip().duration;
      gait.timeScale = n.walk.speed / CLIP_SPEED[sex][kind];
    }
    return { mx, idle, gait };
  }, [obj, clips, n, sex]);
  useEffect(() => () => { rig.mx.stopAllAction(); }, [rig]);
  const st = useRef<{ d: number; sgn: number; wait: number; yaw: number; side: number; moving: number; init: boolean } | null>(null);
  const path = useMemo(() => (n.walk ? { pts: n.walk.path, cum: pathLen(n.walk.path) } : null), [n]);
  useEffect(() => () => { crowd.onRoad.delete(id); }, [id]);
  const shadowOn = useRef(true);
  const attached = useRef(true);
  useFrame((state, dtRaw) => {
    const grp = g.current;
    if (!grp) return;
    const dt = Math.min(dtRaw, 0.1);
    let pos: Vec2 = n.at;
    if (n.walk && path && rig.gait) {
      const total = path.cum[path.cum.length - 1];
      if (!st.current) {
        // start somewhere along the path (seeded by name, so a reload looks the same)
        let h = 0;
        for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        const u = (h % 1000) / 1000;
        st.current = { d: n.walk.crosses ? 0 : u * total, sgn: h % 2 ? 1 : -1, wait: n.walk.crosses ? n.walk.pause ?? 5 : 0, yaw: 0, side: 0, moving: 0, init: false };
      }
      const k = st.current;
      if (k.wait > 0) {
        k.wait -= dt;
        if (n.walk.crosses && k.wait <= 0) {
          // at the kerb: ask to cross, and step out only once the traffic has stopped
          crowd.request = true;
          if (!crowd.crossingClear) k.wait = 0.05;
        }
      } else {
        k.d += k.sgn * n.walk.speed * dt;
        if (k.d >= total || k.d <= 0) {
          k.d = Math.min(total, Math.max(0, k.d));
          k.sgn = -k.sgn;
          k.wait = n.walk.pause ?? 0;
          if (n.walk.crosses) crowd.request = false;
        }
      }
      const { p, dir } = pointAt(path.pts, path.cum, k.d);
      const fx = dir[0] * k.sgn, fy = dir[1] * k.sgn;
      // step aside for the player: up to 0.8 m sideways when they're close ahead
      const pl = driver.snap.player.pos;
      const rx = pl[0] - p[0], ry = pl[1] - p[1];
      const dist = Math.hypot(rx, ry);
      const ahead = rx * fx + ry * fy;
      const lateral = rx * fy - ry * fx; // > 0: the player is to our right
      const want = dist < 2.6 && ahead > -0.6 ? -Math.sign(lateral || 1) * Math.min(0.8, (2.6 - dist) * 0.55) : 0;
      k.side += (want - k.side) * (1 - Math.exp(-dt * 3));
      pos = [p[0] + fy * k.side, p[1] - fx * k.side];
      const moving = k.wait > 0 ? 0 : 1;
      k.moving += (moving - k.moving) * (1 - Math.exp(-dt * 6));
      rig.gait.setEffectiveWeight(k.moving);
      rig.idle.setEffectiveWeight(1 - k.moving);
      const target = faceCompass(k.wait > 0 && n.walk.crosses ? (k.sgn > 0 ? 90 : 270) : compassOf(fx, fy));
      if (!k.init) { k.yaw = target; k.init = true; }
      let dy = target - k.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      k.yaw += dy * (1 - Math.exp(-dt * 5));
      grp.rotation.y = k.yaw;
      grp.position.set(pos[0], groundAt(pos), -pos[1]);
      if (n.walk.crosses) {
        if (pos[0] > ROAD_X[0] - 0.4 && pos[0] < ROAD_X[1] + 0.4) crowd.onRoad.set(id, pos);
        else crowd.onRoad.delete(id);
      }
    }
    // cull far away people (and skip their animation)
    const cam = state.camera.position;
    const hall = pos[0] > 30000;
    const camD = Math.hypot(cam.x - pos[0], cam.z + pos[1]);
    // … and anyone the camera is all but standing in: a head filling a corner of the frame reads as a glitch
    let far = camD > (hall ? CULL_HALL_M : CULL_M) || (camD < NEAR_CAM_M && cam.y < 2.6);
    if (hall && !far) {
      // skinned people skip frustum culling (their bounds are the bind pose), so in the crowded hall cull them
      // here against the view (a sphere round the body), and only people near you cast the overhead shadows
      if (frustumAt !== state.clock.elapsedTime) {
        frustumAt = state.clock.elapsedTime;
        state.camera.updateMatrixWorld();
        frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(state.camera.projectionMatrix, state.camera.matrixWorldInverse));
      }
      body.center.set(pos[0], 0.9, -pos[1]);
      far = !frustum.intersectsSphere(body);
      const pl = driver.snap.player.pos;
      const near = Math.hypot(pl[0] - pos[0], pl[1] - pos[1]) < SHADOW_HALL_M;
      if (near !== shadowOn.current) { shadowOn.current = near; obj.traverse((o) => { if ((o as THREE.Mesh).isMesh && !/opacity/i.test(((o as THREE.Mesh).material as THREE.Material).name)) o.castShadow = near; }); }
    }
    grp.visible = !far;
    // three.js updates the matrices of hidden objects too: take a culled person's skeleton out of the graph
    if (far === attached.current) { attached.current = !far; if (far) grp.remove(obj); else grp.add(obj); }
    if (!far) rig.mx.update(dt);
  });
  const y = groundAt(n.at) + (n.lift ?? 0);
  const seated = SEATED.has(n.act) && !n.walk;
  return (
    <group ref={g} position={[n.at[0], y, -n.at[1]]} rotation-y={faceCompass(n.face)}>
      <primitive object={obj} />
      <Contact r={seated ? 0.36 : 0.4} opacity={seated ? 0.3 : 0.42} />
    </group>
  );
}

export function People({ zone }: { zone: string }) {
  const list = isArea(zone) ? AREA_NPCS[zone] : zone === 'desert' ? NPCS.desert : zone === 'hall' ? HALL_NPCS : [...NPCS.office, ...NPCS.street];
  return (
    <>
      <Player />
      {list.map((n, i) => <Person key={`${zone}${i}`} id={`${zone}${i}`} n={n} />)}
    </>
  );
}
