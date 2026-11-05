/**
 * Renderer, light and camera (plan §11, D2, D3, §7.3).
 * - Poly Haven HDRI per scenario as background + image-based light; the sun is found in the HDRI and the
 *   shadow-casting directional light is aimed at it, so shadows agree with the sky.
 * - Post: N8AO · Bloom (threshold 1, so only emissive network objects glow) · AgX tone mapping ·
 *   Network Vision grade (desaturate ~85 %, −1 EV, cool navy, vignette) · SMAA.
 * - Camera: third person, over the shoulder; drag to look; pulls back in Network Vision.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, BrightnessContrast, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import { BlendFunction, Effect, ToneMappingMode } from 'postprocessing';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { LAYOUT, type Vec2 } from '../../engine/index';
import { driver, useUi, type Playable } from '../driver';
import { CamExport } from './labels';
import { Zones } from './Zones';
import { NetworkLayer } from '../network/NetworkLayer';
import { pointInPoly } from '../../engine/world/layout';
import { camOccluders, NET_LAYER, visionK } from './vision';
import { SceneMounted } from '../ui/Loader';

// ───────────── sky and sun per scenario (midday in the city, low golden sun at the desert site) ─────────────
interface Sky { hdr: string; sunAzDeg: number; sun: number; env: number; fog: number; bg: number }
/** overall exposure: scales sun, sky light and background together */
const EXPOSURE = 0.75;
const SKY: Record<Playable, Sky> = {
  // sun: multiplier on the sun energy measured in the HDRI (the dusk sky has almost none, so it gets a floor)
  'building-exit': { hdr: '/hdri/midday.hdr', sunAzDeg: 200, sun: 1.0, env: 1.0, fog: 0.00045, bg: 1.0 },
  'cafe-twin': { hdr: '/hdri/midday.hdr', sunAzDeg: 150, sun: 1.0, env: 1.0, fog: 0.0005, bg: 1.0 },
  'desert-sat': { hdr: '/hdri/golden.hdr', sunAzDeg: 252, sun: 1.0, env: 0.9, fog: 0.00042, bg: 1.0 },
};


const dirFromCompass = (azDeg: number, elDeg: number) => {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
};

interface Loaded { tex: THREE.DataTexture; env: THREE.DataTexture; sunE: number; sunDir: THREE.Vector3; sunColor: THREE.Color; horizon: THREE.Color; rot: number; elDeg: number }
const hdrCache = new Map<string, Promise<Loaded>>();
function loadSky(sky: Sky): Promise<Loaded> {
  const hit = hdrCache.get(sky.hdr);
  if (hit) return hit;
  const p = new HDRLoader().setDataType(THREE.FloatType).loadAsync(sky.hdr).then((tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const { width: w, height: h, data } = tex.image as { width: number; height: number; data: Float32Array };
    // brightest pixel = the sun (puresky HDRIs: one clear disc)
    let best = -1, bi = 0;
    for (let i = 0; i < w * h; i++) {
      const L = 0.2126 * data[4 * i] + 0.7152 * data[4 * i + 1] + 0.0722 * data[4 * i + 2];
      if (L > best) { best = L; bi = i; }
    }
    const row = Math.floor(bi / w), col = bi % w;
    const u = (col + 0.5) / w, v = 1 - (row + 0.5) / h; // flipY: row 0 is the top of the image
    const phi = (u - 0.5) * 2 * Math.PI, theta = (v - 0.5) * Math.PI;
    let d = new THREE.Vector3(Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi));
    if (d.y < 0) { d = new THREE.Vector3(d.x, -d.y, d.z); }
    const elDeg = Math.max(3, (Math.asin(d.y) * 180) / Math.PI);
    // HDRI compass azimuth (north = −z, east = +x) → rotate the sky so the sun sits where we want it
    const hdrAz = (Math.atan2(d.x, -d.z) * 180) / Math.PI;
    const rot = ((hdrAz - sky.sunAzDeg) * Math.PI) / 180;
    const sunDir = dirFromCompass(sky.sunAzDeg, elDeg);
    const c = new THREE.Color(data[4 * bi], data[4 * bi + 1], data[4 * bi + 2]);
    const m = Math.max(c.r, c.g, c.b);
    const sunColor = new THREE.Color(c.r / m, c.g / m, c.b / m).lerp(new THREE.Color(1, 1, 1), 0.35);
    // horizon colour (1° above), averaged around the sky: the fog colour so distant ground meets the sky
    const hr = Math.floor((1 - (0.5 + 1 / 180)) * h);
    let r = 0, g = 0, b = 0;
    for (let x = 0; x < w; x += 4) { const k = 4 * (hr * w + x); r += data[k]; g += data[k + 1]; b += data[k + 2]; }
    const n = w / 4;
    const horizon = new THREE.Color(r / n, g / n, b / n);
    // the environment copy has the sun clamped out: the shadow-casting light carries it instead,
    // otherwise image-based light floods the shadows with unshadowed sunlight
    let sum = 0, cnt = 0;
    for (let y = 0; y < h / 2; y += 2) for (let x = 0; x < w; x += 4) { const k = 4 * (y * w + x); sum += 0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2]; cnt++; }
    const cap = (sum / cnt) * 3;
    // the energy clamped out is the sun's normal irradiance: it becomes the directional light's intensity
    // (three: a uniform sky of radiance L lights like L; a directional light I lights like I·cosθ/π · π)
    const ed = new Float32Array(data);
    let sunE = 0;
    for (let i = 0; i < w * h; i++) {
      const k = 4 * i, L = 0.2126 * ed[k] + 0.7152 * ed[k + 1] + 0.0722 * ed[k + 2];
      if (L > cap) {
        const f = cap / L; ed[k] *= f; ed[k + 1] *= f; ed[k + 2] *= f;
        const lat = (0.5 - (Math.floor(i / w) + 0.5) / h) * Math.PI;
        sunE += (L - cap) * (2 * Math.PI / w) * (Math.PI / h) * Math.cos(lat);
      }
    }
    const env = new THREE.DataTexture(ed, w, h, THREE.RGBAFormat, THREE.FloatType);
    env.mapping = THREE.EquirectangularReflectionMapping;
    env.colorSpace = tex.colorSpace; env.flipY = tex.flipY; env.magFilter = env.minFilter = THREE.LinearFilter; env.generateMipmaps = false;
    env.needsUpdate = true;
    return { tex, env, sunE, sunDir, sunColor, horizon, rot, elDeg };
  });
  hdrCache.set(sky.hdr, p);
  return p;
}

function SkyAndSun() {
  const { scene } = useThree();
  const sc = useUi((s) => s.scenario);
  const sun = useRef<THREE.DirectionalLight>(null);
  const cur = useRef<{ sky: Sky; l: Loaded } | null>(null);
  useEffect(() => {
    let live = true;
    const sky = SKY[sc];
    void loadSky(sky).then((l) => {
      if (!live) return;
      scene.background = l.tex;
      scene.environment = l.env;
      scene.backgroundRotation.set(0, l.rot, 0);
      scene.environmentRotation.set(0, l.rot, 0);
      scene.fog = new THREE.FogExp2(l.horizon.clone().multiplyScalar(0.9), sky.fog);
      cur.current = { sky, l };
      if (sun.current) sun.current.color.copy(l.sunColor);
    });
    return () => { live = false; };
  }, [sc, scene]);
  useFrame((_, dt) => {
    const want = useUi.getState().vision ? 1 : 0;
    visionK.v += (want - visionK.v) * (1 - Math.exp(-dt * 7)); // ≈ 600 ms
    const c = cur.current, L = sun.current;
    if (!c || !L) return;
    const dim = 1 - 0.6 * visionK.v; // about −1 EV in Network Vision
    scene.environmentIntensity = c.sky.env * EXPOSURE * dim;
    scene.backgroundIntensity = c.sky.bg * EXPOSURE * (1 - 0.7 * visionK.v);
    L.intensity = Math.max(1.2, c.l.sunE * c.sky.sun) * EXPOSURE * dim;
    const [px, py] = driver.snap.player.pos;
    const tgt = new THREE.Vector3(px, 0, -py);
    L.target.position.copy(tgt);
    L.position.copy(tgt).addScaledVector(c.l.sunDir, 160);
    L.target.updateMatrixWorld();
  });
  return (
    <>
      <directionalLight
        ref={sun} castShadow intensity={2.5}
        shadow-mapSize={[4096, 4096]} shadow-bias={-0.0002} shadow-normalBias={0.03} shadow-radius={2.5}
        shadow-camera-left={-45} shadow-camera-right={45} shadow-camera-top={45} shadow-camera-bottom={-45}
        shadow-camera-near={1} shadow-camera-far={420}
      />
      <CeilingLight />
    </>
  );
}

/**
 * Indoors the sun only reaches the façade strip, and image-based light has no occlusion, so desks, chairs and
 * people would float. A warm overhead light (≈ 4000 K, the colour of office LED panels) fades in under a roof and
 * casts the soft shadows a grid of ceiling panels gives. It sits just under the ceiling, so the shadow-casting
 * slab above (which keeps the sun out) is behind its shadow camera and does not block it.
 */
const CEIL_TILT = new THREE.Vector3(0.22, 1, 0.12).normalize();
function CeilingLight() {
  const L = useRef<THREE.DirectionalLight>(null);
  const k = useRef(0);
  useFrame((_, dt) => {
    const l = L.current;
    if (!l) return;
    const [px, py] = driver.snap.player.pos;
    const inside = driver.snap.zone !== 'desert' && ROOFED.some((b) => pointInPoly([px, py], b.poly as Vec2[]));
    k.current += ((inside ? 1 : 0) - k.current) * (1 - Math.exp(-dt * 3));
    l.intensity = 1.9 * EXPOSURE * k.current * (1 - 0.6 * visionK.v);
    const h = 2.9;
    l.target.position.set(px, 0, -py);
    l.position.set(px + (CEIL_TILT.x / CEIL_TILT.y) * h, h, -py + (CEIL_TILT.z / CEIL_TILT.y) * h);
    l.target.updateMatrixWorld();
  });
  return (
    <directionalLight
      ref={L} castShadow intensity={0} color="#fff1e4"
      shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02} shadow-radius={5}
      shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-14}
      shadow-camera-near={0.05} shadow-camera-far={4}
    />
  );
}

// ───────────── Network Vision grade (post) ─────────────
// The world desaturates, darkens and cools; the network layer (NET_LAYER) keeps full colour. A half-res mask
// pass renders the world as depth only, then the network layer in its own colours, so walls still hide it.
class GradeEffect extends Effect {
  private mask = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
  private depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  private scene: THREE.Scene;
  private cam: THREE.Camera;
  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    super('Grade', /* glsl */`
      uniform float k; uniform sampler2D netMask;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 m = texture2D(netMask, uv).rgb;
        // lines, dots, tunnel and rings keep their colour; the heatmap's faint wash does not, so the ground darkens too
        float keep = smoothstep(0.14, 0.45, max(m.r, max(m.g, m.b)));
        // night-mode world: luminance only, cooled and about −1.5 EV, so the network is the brightest thing on screen
        vec3 navy = pow(vec3(L), vec3(1.15)) * vec3(0.55, 0.66, 1.0) * 0.42 + vec3(0.004, 0.007, 0.018);
        float g = 0.92 * k * (1.0 - keep);
        // … with the wash's hue laid back over the graded ground, faintly
        outputColor = vec4(mix(c, navy, g) + m * 0.55 * g, inputColor.a);
      }`, { blendFunction: BlendFunction.NORMAL, uniforms: new Map<string, THREE.Uniform>([['k', new THREE.Uniform(0)], ['netMask', new THREE.Uniform(null)]]) });
    this.scene = scene; this.cam = camera;
    (this.uniforms.get('netMask') as THREE.Uniform).value = this.mask.texture;
  }
  override update(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget) {
    const k = visionK.v;
    (this.uniforms.get('k') as THREE.Uniform).value = k;
    if (k < 0.005) return;
    const w = Math.max(1, input.width >> 1), h = Math.max(1, input.height >> 1);
    if (this.mask.width !== w || this.mask.height !== h) this.mask.setSize(w, h);
    const { scene, cam } = this;
    const bg = scene.background, fog = scene.fog, ov = scene.overrideMaterial, layers = cam.layers.mask;
    const ac = renderer.autoClear, sm = renderer.shadowMap.autoUpdate, cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    renderer.autoClear = false; renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.mask);
    renderer.setClearColor(0x000000, 0); renderer.clear();
    scene.background = null; scene.fog = null;
    scene.overrideMaterial = this.depthOnly; cam.layers.set(0); renderer.render(scene, cam);
    scene.overrideMaterial = null; cam.layers.set(NET_LAYER); renderer.render(scene, cam);
    scene.background = bg; scene.fog = fog; scene.overrideMaterial = ov; cam.layers.mask = layers;
    renderer.autoClear = ac; renderer.shadowMap.autoUpdate = sm; renderer.setClearColor(cc, ca);
  }
  override dispose() { this.mask.dispose(); this.depthOnly.dispose(); super.dispose(); }
}
function Grade() {
  const { scene, camera } = useThree();
  const fx = useMemo(() => new GradeEffect(scene, camera), [scene, camera]);
  return <primitive object={fx} dispose={null} />;
}

function Post() {
  const vig = useRef<any>(null);
  useFrame(() => { if (vig.current) vig.current.darkness = 0.32 + 0.3 * visionK.v; });
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <N8AO aoRadius={1.2} intensity={2.2} distanceFalloff={0.6} halfRes quality="medium" />
      <Grade />
      <Bloom luminanceThreshold={1.0} luminanceSmoothing={0.2} intensity={0.85} mipmapBlur />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <BrightnessContrast brightness={0} contrast={0.04} />
      <Vignette ref={vig} offset={0.32} darkness={0.32} />
      <SMAA />
    </EffectComposer>
  );
}

// ───────────── third-person camera ─────────────
const SOLID = [
  ...LAYOUT.walls.filter((w) => !w.door).map((w) => ({ a: w.a as Vec2, b: w.b as Vec2, h: w.h })),
  ...LAYOUT.buildings.filter((b) => b.kind === 'block' || b.kind === 'container').flatMap((b) => {
    const p = b.poly as Vec2[];
    return p.map((a, i) => ({ a, b: p[(i + 1) % p.length], h: b.height ?? 10 }));
  }),
];
const ROOFED = LAYOUT.buildings.filter((b) => b.kind === 'cutaway');
/** fraction along p→q where it first hits a solid taller than height y (1 = clear) */
function firstHit(p: Vec2, q: Vec2, y: number): number {
  let best = 1;
  const rx = q[0] - p[0], ry = q[1] - p[1];
  for (const s of SOLID) {
    if (s.h < y) continue;
    const sx = s.b[0] - s.a[0], sy = s.b[1] - s.a[1];
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((s.a[0] - p[0]) * sy - (s.a[1] - p[1]) * sx) / den;
    const u = ((s.a[0] - p[0]) * ry - (s.a[1] - p[1]) * rx) / den;
    if (t > 0 && t < best && u >= 0 && u <= 1) best = t;
  }
  return best;
}

function CameraRig() {
  const { camera } = useThree();
  const st = useRef({ yaw: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false });
  useEffect(() => {
    // drag to look (no pointer-lock banner at the booth)
    let down = false, lx = 0, ly = 0;
    const d = (e: PointerEvent) => { if ((e.target as HTMLElement).tagName === 'CANVAS') { down = true; lx = e.clientX; ly = e.clientY; } };
    const m = (e: PointerEvent) => {
      if (!down) return;
      driver.look.yaw += (e.clientX - lx) * 0.0045;
      driver.look.pitch = THREE.MathUtils.clamp(driver.look.pitch + (e.clientY - ly) * 0.003, -0.5, 0.9);
      driver.look.at = performance.now();
      lx = e.clientX; ly = e.clientY;
    };
    const u = () => { down = false; };
    addEventListener('pointerdown', d); addEventListener('pointermove', m); addEventListener('pointerup', u);
    return () => { removeEventListener('pointerdown', d); removeEventListener('pointermove', m); removeEventListener('pointerup', u); };
  }, []);
  useFrame((_, dt) => {
    const s = driver.snap, ui = useUi.getState(), k = st.current;
    const [px, py] = s.player.pos;
    const head = (s.player.headingDeg * Math.PI) / 180;
    const sp = Math.hypot(s.player.vel[0], s.player.vel[1]);
    const mouseIdle = performance.now() - driver.look.at > 2500;
    if (!k.init) { k.yaw = head; k.init = true; }
    // follow the walking direction (scripted always; live only when the mouse is idle)
    if (sp > 0.3 && (!ui.live || mouseIdle)) {
      let d = head - k.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      k.yaw += d * (1 - Math.exp(-dt * (ui.live ? 0.9 : 1.6)));
    }
    const yaw = k.yaw + driver.look.yaw;
    driver.cameraYaw = yaw;
    if (mouseIdle) driver.look.yaw *= Math.exp(-dt * 0.4);
    const v = visionK.v;
    const desert = s.zone === 'desert';
    const dist = THREE.MathUtils.lerp(3.6, 10, v), shoulder = THREE.MathUtils.lerp(0.55, 0, v);
    const pitch = THREE.MathUtils.lerp(desert ? 0.06 : 0.16, desert ? 0.12 : 0.5, v) + driver.look.pitch;
    const pivot = new THREE.Vector3(px, 1.55, -py);
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const back = fwd.clone().multiplyScalar(-Math.cos(pitch) * dist);
    let want = pivot.clone().add(back).addScaledVector(right, shoulder);
    want.y = pivot.y + Math.sin(pitch) * dist + 0.25;
    // collide the boom with walls and buildings (2D, by height)
    const t = firstHit([px, py], [want.x, -want.z], want.y);
    if (t < 1) want = pivot.clone().lerp(want, Math.max(0.15, t - 0.12 / dist));
    // under a ceiling, stay under it (Network Vision cuts the ceilings away instead)
    if (v < 0.5 && ROOFED.some((b) => pointInPoly([px, py], b.poly as Vec2[]))) want.y = Math.min(want.y, 2.7);
    const look = pivot.clone().addScaledVector(fwd, 6).addScaledVector(right, shoulder * 0.25);
    look.y = THREE.MathUtils.lerp(1.45, 0.4, v) - (desert ? -0.6 : 0);
    const a = k.pos.distanceTo(want) > 40 ? 1 : 1 - Math.exp(-dt * 6);
    k.pos.lerp(want, a);
    k.look.lerp(look, a);
    camera.layers.enable(NET_LAYER);
    // debug / recording hook (?cam=x,y,h,lookX,lookY,lookH in engine metres): a fixed camera for checking a spot
    const dbg = (window as { __infinetCam?: number[] }).__infinetCam;
    if (dbg) { k.pos.set(dbg[0], dbg[2], -dbg[1]); k.look.set(dbg[3], dbg[5], -dbg[4]); }
    camera.position.copy(k.pos);
    for (const o of camOccluders) {
      o.obj.visible = o.h !== undefined
        ? !(k.pos.y > o.y - 1 && k.pos.y < o.y + o.h + 1 && Math.hypot(k.pos.x - o.x, k.pos.z - o.z) < o.r)
        : Math.hypot(k.pos.x - o.x, k.pos.y - o.y, k.pos.z - o.z) > o.r;
    }
    camera.lookAt(k.look);
  });
  return null;
}

function SimTicker() {
  useFrame((_, dt) => driver.tick(dt), -10);
  return null;
}

function Renderer() {
  const { gl, scene, camera } = useThree();
  useEffect(() => { (window as any).__three = { gl, scene, camera }; }, [gl, scene, camera]);
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (e: Event) => { e.preventDefault(); setTimeout(() => location.reload(), 500); };
    canvas.addEventListener('webglcontextlost', lost);
    return () => canvas.removeEventListener('webglcontextlost', lost);
  }, [gl]);
  return null;
}

export function World() {
  const sc = useUi((s) => s.scenario);
  const key = useMemo(() => sc, [sc]);
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 1.5]}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: 52, near: 0.1, far: 6000, position: [0, 2, 5] }}
    >
      <Renderer />
      <SimTicker />
      <CameraRig />
      <CamExport />
      <SkyAndSun />
      <Suspense fallback={null}>
        <group key={key}>
          <Zones />
          <NetworkLayer />
        </group>
        <SceneMounted />
      </Suspense>
      <Post />
    </Canvas>
  );
}
