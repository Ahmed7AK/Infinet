/** The 3D world (style guide p. 21): night ground, survey grid, cut-away floor plans, flat cells, one fixed light. */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { driver, useUi } from '../driver';
import { color } from '../tokens';
import { Static } from './Static';
import { Coverage } from './Coverage';
import { Networks } from './Networks';
import { CamExport } from './labels';

/** Camera per zone: three-quarter view about 35° down, from the azimuth given (degrees from north). */
const CAM = { elevDeg: 35, dist: 62, fov: 30 };
const CAM_AZ: Record<string, number> = { office: 160, street: 160, desert: 200 };

function SimTicker() {
  useFrame((_, dt) => driver.tick(dt), -10);
  return null;
}

function CameraRig() {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3());
  const first = useRef(true);
  useFrame((_, dt) => {
    const s = driver.snap;
    const az = ((CAM_AZ[s.zone] ?? 160) * Math.PI) / 180;
    driver.cameraYaw = az + Math.PI; // forward on screen = from camera toward target
    const [px, py] = s.player.pos;
    // look slightly ahead of the walker so the route ahead is in view
    const ahead = 4;
    const v = s.player.vel, sp = Math.hypot(v[0], v[1]);
    const tx = px + (sp > 0.1 ? (v[0] / sp) * ahead : 0), ty = py + (sp > 0.1 ? (v[1] / sp) * ahead : 0);
    const goal = new THREE.Vector3(tx, s.zone === 'desert' ? 3 : 0, -ty); // desert: lift the view so the (compressed) sky fits
    const k = first.current || target.current.distanceTo(goal) > 60 ? 1 : 1 - Math.exp(-dt * 2.5);
    first.current = false;
    target.current.lerp(goal, k);
    const el = (CAM.elevDeg * Math.PI) / 180;
    const horiz = CAM.dist * Math.cos(el);
    const off = new THREE.Vector3(Math.sin(az) * horiz, CAM.dist * Math.sin(el), -Math.cos(az) * horiz);
    camera.position.copy(target.current).add(off);
    camera.lookAt(target.current);
  });
  return null;
}

/** Survey grid: 1 m lines, heavier every 5 m, violet crosshairs every 10 m. World-anchored, follows the player. */
function Ground() {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      cBase: { value: new THREE.Color(color.night) },
      cMinor: { value: new THREE.Color('#141726') },
      cMajor: { value: new THREE.Color('#20243A') },
      cCross: { value: new THREE.Color('#3A1670') },
    },
    vertexShader: `varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = vec2(w.x, -w.z); gl_Position = projectionMatrix * viewMatrix * w; }`,
    // colours are sRGB hex written straight out: hex in, hex out (no colour-space chunk on purpose)
    fragmentShader: `
      uniform vec3 cBase, cMinor, cMajor, cCross; varying vec2 vW;
      float gridLine(vec2 p, float step, float w){ vec2 g = abs(fract(p/step - 0.5) - 0.5) * step; vec2 fw = fwidth(p); vec2 l = 1.0 - smoothstep(vec2(w)*0.5, vec2(w)*0.5 + fw, g); return max(l.x, l.y); }
      void main(){
        vec3 c = cBase;
        c = mix(c, cMinor, gridLine(vW, 1.0, 0.03));
        c = mix(c, cMajor, gridLine(vW, 5.0, 0.07));
        vec2 q = abs(fract(vW/10.0 - 0.5) - 0.5) * 10.0;
        float cross = (step(q.x, 0.06) * step(q.y, 0.6)) + (step(q.y, 0.06) * step(q.x, 0.6));
        c = mix(c, cCross, clamp(cross, 0.0, 1.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
    extensions: {} as any,
  }), []);
  useFrame(() => {
    const [x, y] = driver.snap.player.pos;
    mesh.current?.position.set(Math.round(x / 10) * 10, 0, -Math.round(y / 10) * 10);
  });
  return (
    <mesh ref={mesh} rotation-x={-Math.PI / 2} material={mat} renderOrder={-1}>
      <planeGeometry args={[700, 700]} />
    </mesh>
  );
}

function Renderer() {
  const { gl, scene } = useThree();
  useEffect(() => {
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.NoToneMapping; // hex in = hex out
    scene.background = new THREE.Color(color.night);
    const canvas = gl.domElement;
    const lost = (e: Event) => { e.preventDefault(); setTimeout(() => location.reload(), 500); };
    canvas.addEventListener('webglcontextlost', lost);
    return () => canvas.removeEventListener('webglcontextlost', lost);
  }, [gl, scene]);
  return null;
}

export function World() {
  const zone = useUi((s) => s.snap?.zone ?? 'office');
  return (
    <Canvas
      flat
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: CAM.fov, near: 0.5, far: 3000, position: [0, 40, 40] }}
    >
      <Renderer />
      <SimTicker />
      <CameraRig />
      <CamExport />
      {/* one fixed light, flat shading */}
      <ambientLight intensity={1.5} />
      <directionalLight position={[-30, 80, 40]} intensity={1.6} />
      <Ground />
      <Static zone={zone} />
      <Coverage />
      <Networks />
    </Canvas>
  );
}
