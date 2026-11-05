/**
 * Shared assets for the realistic world (plan §11–§12): Poly Haven PBR textures (CC0), PBR materials, and the GLB
 * props in public/models: Poly Haven models (ph_*, CC0, tools/blender/import_polyhaven.py) and the Blender-scripted
 * network hardware and street pieces (tools/blender/build_all.py). People are in Character.tsx. All local, no network.
 */
import { useGLTF } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';

// ───────────── textures ─────────────
const loader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
function tex(path: string, srgb: boolean, repeatM: number): THREE.Texture {
  const key = `${path}|${repeatM}`;
  let t = texCache.get(key);
  if (t) return t;
  const base = texCache.get(path) ?? loader.load(path);
  texCache.set(path, base);
  t = base.clone();
  t.source = base.source; // share the image
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.repeat.set(1 / repeatM, 1 / repeatM); // geometry UVs are in metres
  // no needsUpdate here: the clone shares the source, which updates when the image arrives
  texCache.set(key, t);
  return t;
}

/** PBR material from a Poly Haven set. UVs are metres, so `tileM` is the real size of one texture tile. */
export function pbr(set: string, tileM: number, opts: { tint?: string; rough?: number; normal?: number; metal?: number } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: tex(`/textures/${set}/diff.jpg`, true, tileM),
    normalMap: tex(`/textures/${set}/nor.jpg`, false, tileM),
    roughnessMap: tex(`/textures/${set}/rough.jpg`, false, tileM),
    roughness: opts.rough ?? 1,
    metalness: opts.metal ?? 0,
    color: opts.tint ?? '#ffffff',
  });
  m.normalScale.setScalar(opts.normal ?? 1);
  return m;
}

export const MAT = {
  terrazzo: () => pbr('terrazzo', 1.6, { tint: '#f2f0ec', rough: 0.8 }),
  wood: () => pbr('wood', 2.0),
  asphalt: () => pbr('asphalt', 4.0, { tint: '#9a9a9a' }),
  paving: () => pbr('paving', 2.0, { tint: '#e3d9c8' }),
  sand: () => pbr('sand', 5.0, { tint: '#e8cfa9' }),
  paint: (tint = '#f1efea') => pbr('paint', 2.5, { tint, normal: 0.4 }),
  concrete: (tint = '#c9c6c0') => pbr('concrete', 2.5, { tint }),
  glassLowE: () => new THREE.MeshPhysicalMaterial({ color: '#7fa6a8', roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.32, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide }),
  glassClear: () => new THREE.MeshPhysicalMaterial({ color: '#d8e6ea', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.16, envMapIntensity: 1.2, depthWrite: false, side: THREE.DoubleSide }),
  windowDark: () => new THREE.MeshStandardMaterial({ color: '#1d2a33', roughness: 0.08, metalness: 0.6, envMapIntensity: 1.5 }),
  frame: () => new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.45, metalness: 0.7 }),
  // façade glazing: reflects the sky (white base, tinted per pane by instance colour), mid-grey anodised frames
  windowGlass: () => new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, metalness: 0.55, envMapIntensity: 1.0, clearcoat: 0.6, clearcoatRoughness: 0.05 }),
  windowFrame: () => new THREE.MeshStandardMaterial({ color: '#5b5f63', roughness: 0.5, metalness: 0.6 }),
  shopGlass: () => new THREE.MeshPhysicalMaterial({ color: '#56656e', roughness: 0.04, metalness: 0.5, envMapIntensity: 1.1, clearcoat: 0.5 }),
  curb: () => new THREE.MeshStandardMaterial({ color: '#b9b4aa', roughness: 0.85 }),
  paintLine: () => new THREE.MeshStandardMaterial({ color: '#e9e6dc', roughness: 0.7 }),
  ceiling: () => new THREE.MeshStandardMaterial({ color: '#e9e8e4', roughness: 0.9, side: THREE.BackSide }),
  ceilingLight: () => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff8ee', emissiveIntensity: 1.1, roughness: 0.5 }),
};

// ───────────── box geometry with metre UVs ─────────────
/** a box whose UVs are in metres on every face (so textures keep real scale on any size) */
export function boxGeo(sx: number, sy: number, sz: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims: Array<[number, number]> = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]);
  }
  uv.needsUpdate = true;
  return g;
}

/** flat polygon (engine coords) as a floor mesh with metre UVs, lying in the XZ plane at height y */
export function floorGeo(poly: Array<[number, number]>, y = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(poly.map(([x, yy]) => new THREE.Vector2(x, yy)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2); // shape y (north) → −z
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[2 * i] = pos.getX(i); uv[2 * i + 1] = -pos.getZ(i); }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.translate(0, y, 0);
  return g;
}

// ───────────── GLB props ─────────────
export const MODELS = [
  // Blender-scripted (generic network hardware: no real product or brand)
  'ap_ceiling', 'ap_cafe', 'adapter_usb', 'laptop', 'phone_hand', 'rack_42u', 'tower_monopole', 'vsat_geo', 'leo_terminal',
  'site_router', 'sat_leo', 'sat_geo', 'gateway_cluster', 'desk_set', 'meeting_table', 'cafe_counter',
  'car_sedan', 'palm', 'street_lamp', 'bollard', 'bench', 'container_office', 'generator',
  'car_suv', 'pickup', 'office_chair', 'bus_shelter', 'street_bin', 'crossing_sign', 'water_dispenser', 'printer', 'whiteboard', 'windsock',
  // Poly Haven (CC0)
  'ph_bistro_set', 'ph_pendant', 'ph_vase', 'ph_planter', 'ph_plant_tall', 'ph_plant_wide', 'ph_sofa',
  'ph_coffee_table', 'ph_armchair', 'ph_shelves', 'ph_cabinet', 'ph_hydrant', 'ph_utility_box', 'ph_manhole', 'ph_aircon',
  'ph_barrier', 'ph_jerrycan', 'ph_crate', 'ph_box', 'ph_power_cabinet', 'ph_rocks',
  'ph_generator', 'ph_drum', 'ph_plastic_crate', 'ph_hand_truck', 'ph_toolbox', 'ph_monobloc', 'ph_picnic_table',
  'ph_bush', 'ph_drawers', 'ph_desk_plant', 'ph_desk_lamp', 'ph_stationery', 'ph_lounge_chair',
  'ph_round_table', 'ph_dining_chair', 'ph_bar_stool', 'ph_cake',
  'ph_wet_floor', 'ph_notepads', 'ph_binders', 'ph_shelf_narrow', 'ph_ottoman', 'ph_round_coffee_table',
  'ph_ceiling_fan', 'ph_croissant', 'ph_basket', 'ph_cake_berry', 'ph_tea_set', 'ph_jug', 'ph_chalkboard', 'ph_display_shelves', 'ph_vase_white',
  'ph_covered_car', 'ph_shutter', 'ph_ladder', 'ph_tool_cart', 'ph_tyre', 'ph_water_jug', 'ph_metal_rack', 'ph_crate_red', 'ph_tote',
  'ph_breaker_box', 'ph_hose', 'ph_trash_can', 'ph_broom', 'ph_security_light',
] as const;
export type ModelName = (typeof MODELS)[number];
export const modelUrl = (n: ModelName) => `/models/${n}.glb`;
for (const n of MODELS) useGLTF.preload(modelUrl(n));

/**
 * a shadow-casting clone of a GLB scene; `tint` recolours a named material (e.g. car paint);
 * `part` takes one named top-level node of a set (ph_rocks: piece_0 … piece_3)
 */
export function useModel(name: ModelName, opts: { tint?: Record<string, string>; shadows?: boolean; part?: string } = {}): THREE.Object3D {
  const { scene } = useGLTF(modelUrl(name));
  const key = JSON.stringify(opts.tint ?? {}) + (opts.part ?? '');
  return useMemo(() => {
    const src = opts.part ? scene.getObjectByName(opts.part) ?? scene : scene;
    const c = src.clone(true);
    if (opts.part) c.position.set(0, 0, 0);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = opts.shadows ?? true;
      m.receiveShadow = true;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (opts.tint && opts.tint[mat.name]) {
        m.material = mat.clone();
        (m.material as THREE.MeshStandardMaterial).color.set(opts.tint[mat.name]);
      }
      if (mat.transparent) { m.castShadow = false; mat.depthWrite = false; }
    });
    return c;
  }, [scene, key]);
}
