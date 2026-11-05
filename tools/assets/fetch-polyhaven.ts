/**
 * Fetch the CC0 Poly Haven HDRIs, PBR textures and 3D models the realistic renderer uses (plan §11, §12).
 *   npx tsx tools/assets/fetch-polyhaven.ts
 * Raw downloads go to assets-src/downloads/ (not shipped); the used maps are copied into public/hdri and public/textures.
 * Models (1k glTF) are converted to GLB by tools/blender/import_polyhaven.py, which reads MODELS below from models.json.
 * Every asset is CC0 (polyhaven.com/license). Listed in CREDITS.md.
 */
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const HDRIS: Array<{ id: string; res: string; as: string }> = [
  { id: 'kloofendal_43d_clear_puresky', res: '2k', as: 'midday' },        // clear midday: office and street
  { id: 'qwantani_late_afternoon_puresky', res: '2k', as: 'golden' },     // low warm sun: the desert site
  // (a dusk sky was tried for the desert and dropped: almost no direct sun, so the scene went flat)
];
const TEXTURES: Array<{ id: string; res: string; as: string }> = [
  { id: 'asphalt_02', res: '2k', as: 'asphalt' },
  { id: 'rectangular_paving', res: '1k', as: 'paving' },
  { id: 'terrazzo_tiles', res: '1k', as: 'terrazzo' },
  { id: 'wood_floor', res: '1k', as: 'wood' },
  { id: 'coast_sand_01', res: '2k', as: 'sand' },
  { id: 'painted_plaster_wall', res: '1k', as: 'paint' },
  { id: 'concrete_floor_02', res: '1k', as: 'concrete' },
];
/** Poly Haven model → our GLB name and a triangle budget (the importer decimates anything above it). */
// drop: object names containing this are left out (sets that ship a clean and a weathered copy side by side)
// height: rescale to this height in metres (a model authored at the wrong scale)
// split: a set of separate objects (rocks): each is recentred and kept as its own top-level node in one GLB
export const MODELS: Array<{ id: string; as: string; tris: number; split?: boolean; drop?: string; height?: number }> = [
  // café
  { id: 'outdoor_table_chair_set_01', as: 'ph_bistro_set', tris: 12000 },
  { id: 'metal_stool_01', as: 'ph_stool', tris: 6000 },
  { id: 'modern_ceiling_lamp_01', as: 'ph_pendant', tris: 6000 },
  { id: 'ceramic_vase_02', as: 'ph_vase', tris: 3000 },
  { id: 'planter_box_01', as: 'ph_planter', tris: 8000 },
  // office
  { id: 'potted_plant_01', as: 'ph_plant_tall', tris: 24000 },
  { id: 'potted_plant_02', as: 'ph_plant_wide', tris: 24000 },
  { id: 'sofa_02', as: 'ph_sofa', tris: 4000 },
  { id: 'modern_coffee_table_01', as: 'ph_coffee_table', tris: 5000 },
  { id: 'modern_arm_chair_01', as: 'ph_armchair', tris: 9000 },
  { id: 'steel_frame_shelves_01', as: 'ph_shelves', tris: 5000, height: 1.8 },
  { id: 'modern_wooden_cabinet', as: 'ph_cabinet', tris: 10000 },
  // street
  { id: 'fire_hydrant', as: 'ph_hydrant', tris: 8000, drop: 'aged' },
  { id: 'utility_box_01', as: 'ph_utility_box', tris: 5000 },
  { id: 'water_manhole_cover', as: 'ph_manhole', tris: 3000 },
  { id: 'exterior_aircon_unit', as: 'ph_aircon', tris: 6000, drop: 'rusted' },
  // desert site
  { id: 'concrete_road_barrier_02', as: 'ph_barrier', tris: 6000 },
  { id: 'metal_jerrycan', as: 'ph_jerrycan', tris: 5000 },
  { id: 'wooden_crate_01', as: 'ph_crate', tris: 7000 },
  { id: 'cardboard_box_01', as: 'ph_box', tris: 3000 },
  { id: 'utility_box_02', as: 'ph_power_cabinet', tris: 6000 },
  { id: 'namaqualand_rocks_01', as: 'ph_rocks', tris: 12000, split: true }, // four field stones, ~0.2 m: scaled up in the scene
];
const MODEL_RES = '1k';

const MAPS: Record<string, string> = { Diffuse: 'diff', nor_gl: 'nor', Rough: 'rough' };

const DL = 'assets-src/downloads/polyhaven';
async function get(url: string, to: string) {
  if (existsSync(to) && statSync(to).size > 0) return;
  mkdirSync(dirname(to), { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  writeFileSync(to, Buffer.from(await r.arrayBuffer()));
  console.log('  got', to, `${(statSync(to).size / 1e6).toFixed(1)} MB`);
}
const files = async (id: string) => (await (await fetch(`https://api.polyhaven.com/files/${id}`)).json()) as any;

const credits: string[] = [];
for (const h of HDRIS) {
  const f = await files(h.id);
  const url = f.hdri[h.res].hdr.url as string;
  const raw = join(DL, 'hdri', `${h.id}_${h.res}.hdr`);
  await get(url, raw);
  mkdirSync('public/hdri', { recursive: true });
  copyFileSync(raw, `public/hdri/${h.as}.hdr`);
  credits.push(`| public/hdri/${h.as}.hdr | Poly Haven \`${h.id}\` (${h.res}) | CC0 | https://polyhaven.com/a/${h.id} |`);
}
for (const t of TEXTURES) {
  const f = await files(t.id);
  for (const [key, short] of Object.entries(MAPS)) {
    const m = f[key]?.[t.res]?.jpg ?? f[key]?.[t.res]?.png;
    if (!m) { console.log(`  (no ${key} for ${t.id})`); continue; }
    const ext = m.url.endsWith('.png') ? 'png' : 'jpg';
    const raw = join(DL, 'tex', t.id, `${short}_${t.res}.${ext}`);
    await get(m.url, raw);
    mkdirSync(`public/textures/${t.as}`, { recursive: true });
    copyFileSync(raw, `public/textures/${t.as}/${short}.${ext}`);
  }
  credits.push(`| public/textures/${t.as}/ | Poly Haven \`${t.id}\` (${t.res}) | CC0 | https://polyhaven.com/a/${t.id} |`);
}
const modelDir = join(DL, 'models');
for (const m of MODELS) {
  const f = await files(m.id);
  const g = f.gltf[MODEL_RES].gltf;
  const dir = join(modelDir, m.id);
  await get(g.url, join(dir, `${m.id}.gltf`));
  for (const [rel, inc] of Object.entries(g.include as Record<string, { url: string }>)) await get(inc.url, join(dir, rel));
  credits.push(`| public/models/${m.as}.glb | Poly Haven \`${m.id}\` (${MODEL_RES}) | CC0 | https://polyhaven.com/a/${m.id} |`);
}
writeFileSync(join(modelDir, 'models.json'), JSON.stringify(MODELS.map((m) => ({ ...m, gltf: join(m.id, `${m.id}.gltf`) })), null, 1));

console.log('\nCREDITS rows:\n' + credits.join('\n'));
