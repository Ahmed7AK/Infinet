/**
 * Fetch the CC0 Poly Haven HDRIs, PBR textures and 3D models the realistic renderer uses (plan §11, §12).
 *   npx tsx tools/assets/fetch-polyhaven.ts
 *   npx tsx tools/assets/fetch-polyhaven.ts --textures=planks,deck   (only these texture sets; no skies or models)
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
  // the park, Downtown, the metro station and the old souk (11 Nov)
  { id: 'brown_planks_03', res: '1k', as: 'planks' },
  { id: 'wood_floor_deck', res: '1k', as: 'deck' },
  { id: 'rubberized_track', res: '1k', as: 'track' },
  { id: 'white_stucco', res: '1k', as: 'stucco' },
  { id: 'corrugated_iron', res: '1k', as: 'ribbed' },
  { id: 'red_sandstone_pavement', res: '1k', as: 'flagstone' },
  // (leafy_grass, clay_plaster, metal_plate and large_sandstone_blocks were tried and dropped: dead leaves in the
  // lawn, too dark to tint, rusty, and a ledge that shows when tiled)
];
/** Poly Haven model → our GLB name and a triangle budget (the importer decimates anything above it). */
// drop: object names containing this are left out (sets that ship a clean and a weathered copy side by side)
// height: rescale to this height in metres (a model authored at the wrong scale)
// tex: cap the texture width in pixels (small props)
// split: a set of separate objects (rocks): each is recentred and kept as its own top-level node in one GLB
export const MODELS: Array<{ id: string; as: string; tris: number; split?: boolean; drop?: string; height?: number; tex?: number }> = [
  // café
  { id: 'outdoor_table_chair_set_01', as: 'ph_bistro_set', tris: 12000 },
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
  { id: 'portable_generator', as: 'ph_generator', tris: 12000, tex: 512 },
  { id: 'barrel_03', as: 'ph_drum', tris: 2000 },
  { id: 'plastic_crate_02', as: 'ph_plastic_crate', tris: 3000 },
  { id: 'hand_truck', as: 'ph_hand_truck', tris: 4000 },
  { id: 'metal_toolbox', as: 'ph_toolbox', tris: 4000 },
  { id: 'plastic_monobloc_chair_01', as: 'ph_monobloc', tris: 3000 },
  { id: 'wooden_picnic_table', as: 'ph_picnic_table', tris: 5000 },
  { id: 'wild_rooibos_bush', as: 'ph_bush', tris: 10000, split: true },
  // office, second pass
  { id: 'drawer_cabinet', as: 'ph_drawers', tris: 6000 },
  { id: 'potted_plant_04', as: 'ph_desk_plant', tris: 3000 },
  { id: 'desk_lamp_arm_01', as: 'ph_desk_lamp', tris: 4000 },
  { id: 'stationery_supplies', as: 'ph_stationery', tris: 2500 },
  { id: 'mid_century_lounge_chair', as: 'ph_lounge_chair', tris: 6000 },
  // café, second pass
  { id: 'round_wooden_table_01', as: 'ph_round_table', tris: 4000, height: 0.75 },
  { id: 'dining_chair_02', as: 'ph_dining_chair', tris: 5000 },
  { id: 'bar_chair_round_01', as: 'ph_bar_stool', tris: 5000 },
  { id: 'carrot_cake', as: 'ph_cake', tris: 2000, tex: 512 },
  { id: 'namaqualand_rocks_01', as: 'ph_rocks', tris: 12000, split: true }, // four field stones, ~0.2 m: scaled up in the scene
  // office, third pass (projector_screen was tried and dropped: its screen is torn; the meeting room has a display on a stand)
  { id: 'WetFloorSign_01', as: 'ph_wet_floor', tris: 1000 },
  { id: 'office_notepads', as: 'ph_notepads', tris: 1000, tex: 512, split: true },
  { id: 'binder_notebook', as: 'ph_binders', tris: 3000, tex: 512, split: true },
  { id: 'steel_frame_shelves_02', as: 'ph_shelf_narrow', tris: 3000 },
  { id: 'Ottoman_01', as: 'ph_ottoman', tris: 2500 },
  { id: 'coffee_table_round_01', as: 'ph_round_coffee_table', tris: 3000 },
  // café, third pass
  { id: 'ceiling_fan', as: 'ph_ceiling_fan', tris: 6000, tex: 512 },
  { id: 'croissant', as: 'ph_croissant', tris: 800, tex: 256 },
  { id: 'wicker_basket_01', as: 'ph_basket', tris: 3000, tex: 512 },
  { id: 'strawberry_chocolate_cake', as: 'ph_cake_berry', tris: 3000, tex: 512 },
  { id: 'tea_set_01', as: 'ph_tea_set', tris: 6000, tex: 512 },
  { id: 'jug_01', as: 'ph_jug', tris: 1500, tex: 512 },
  { id: 'standing_chalkboard_01', as: 'ph_chalkboard', tris: 1500 },
  { id: 'wooden_display_shelves_01', as: 'ph_display_shelves', tris: 2000 },
  { id: 'ceramic_vase_01', as: 'ph_vase_white', tris: 1500, tex: 512 },
  // street
  { id: 'covered_car', as: 'ph_covered_car', tris: 6000 },
  { id: 'rollershutter_door', as: 'ph_shutter', tris: 1200, drop: 'graffiti' },
  // desert site, third pass
  { id: 'ladder_sectioned_01', as: 'ph_ladder', tris: 5000, split: true },
  { id: 'tool_cart', as: 'ph_tool_cart', tris: 6000 },
  { id: 'old_tyre', as: 'ph_tyre', tris: 2000, tex: 512 },
  { id: 'plastic_bottle_gallon', as: 'ph_water_jug', tris: 2000, tex: 512 },
  { id: 'worn_metal_rack', as: 'ph_metal_rack', tris: 3000 },
  { id: 'plastic_crate_03', as: 'ph_crate_red', tris: 4000, tex: 512 },
  { id: 'industrial_pastic_container', as: 'ph_tote', tris: 3000, tex: 512 },
  { id: 'power_box_01', as: 'ph_breaker_box', tris: 4000, tex: 512 },
  { id: 'garden_hose_wall_mounted_01', as: 'ph_hose', tris: 3000, tex: 512 },
  { id: 'metal_trash_can', as: 'ph_trash_can', tris: 3000, tex: 512, drop: 'rust' },
  { id: 'plastic_broom', as: 'ph_broom', tris: 2000, tex: 512 },
  { id: 'security_light', as: 'ph_security_light', tris: 2000, tex: 512 },
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
const ONLY = process.argv.find((a) => a.startsWith('--textures='))?.slice(11).split(',');
for (const h of ONLY ? [] : HDRIS) {
  const f = await files(h.id);
  const url = f.hdri[h.res].hdr.url as string;
  const raw = join(DL, 'hdri', `${h.id}_${h.res}.hdr`);
  await get(url, raw);
  mkdirSync('public/hdri', { recursive: true });
  copyFileSync(raw, `public/hdri/${h.as}.hdr`);
  credits.push(`| public/hdri/${h.as}.hdr | Poly Haven \`${h.id}\` (${h.res}) | CC0 | https://polyhaven.com/a/${h.id} |`);
}
for (const t of TEXTURES.filter((x) => !ONLY || ONLY.includes(x.as))) {
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
for (const m of ONLY ? [] : MODELS) {
  const f = await files(m.id);
  const g = f.gltf[MODEL_RES].gltf;
  const dir = join(modelDir, m.id);
  await get(g.url, join(dir, `${m.id}.gltf`));
  for (const [rel, inc] of Object.entries(g.include as Record<string, { url: string }>)) await get(inc.url, join(dir, rel));
  credits.push(`| public/models/${m.as}.glb | Poly Haven \`${m.id}\` (${MODEL_RES}) | CC0 | https://polyhaven.com/a/${m.id} |`);
}
if (!ONLY) writeFileSync(join(modelDir, 'models.json'), JSON.stringify(MODELS.map((m) => ({ ...m, gltf: join(m.id, `${m.id}.gltf`) })), null, 1));

console.log('\nCREDITS rows:\n' + credits.join('\n'));
