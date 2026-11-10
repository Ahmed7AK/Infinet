/**
 * Fetch the Microsoft Rocketbox people and animation clips the scenes use (MIT licence, github.com/microsoft/Microsoft-Rocketbox).
 *   npx tsx tools/assets/fetch-rocketbox.ts
 * Raw FBX and TGA files go to assets-src/downloads/rocketbox/ (not shipped). tools/blender/import_rocketbox.py
 * turns them into public/models/people/*.glb (meshes) and public/models/people/anim_<m|f>_<clip>.glb (one clip each).
 * Only the files listed here are downloaded; the repository itself is ~4 GB.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const RAW = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets';
const API = 'https://api.github.com/repos/microsoft/Microsoft-Rocketbox/contents/Assets';

/** who appears where (Character.tsx). `sex` picks the clip set: Rocketbox clips are authored per body type. */
export const PEOPLE: Array<{ id: string; group: 'Adults' | 'Professions'; sex: 'm' | 'f'; as: string; tex: number; ghutra?: 'white' }> = [
  // you: an Emirati in a white kandura, a plain white ghutra and a black agal (seen from behind). Same Rocketbox
  // person as office_m2; `ghutra` has the import take the red check out of the head-cloth (import_rocketbox.py)
  { id: 'Male_Adult_21', group: 'Adults', sex: 'm', as: 'player', tex: 1024, ghutra: 'white' },
  // office
  { id: 'Business_Female_01', group: 'Professions', sex: 'f', as: 'office_f1', tex: 512 },
  { id: 'Business_Male_06', group: 'Professions', sex: 'm', as: 'office_m1', tex: 512 },
  { id: 'Male_Adult_21', group: 'Adults', sex: 'm', as: 'office_m2', tex: 512 },       // kandura and ghutra
  { id: 'Female_Adult_09', group: 'Adults', sex: 'f', as: 'office_f2', tex: 512 },
  { id: 'Business_Male_02', group: 'Professions', sex: 'm', as: 'office_m3', tex: 512 },
  // street and café
  { id: 'Male_Adult_19', group: 'Adults', sex: 'm', as: 'street_m1', tex: 512 },       // kandura and ghutra
  { id: 'Female_Adult_10', group: 'Adults', sex: 'f', as: 'street_f1', tex: 512 },     // abaya
  { id: 'Male_Adult_09', group: 'Adults', sex: 'm', as: 'barista', tex: 512 },
  { id: 'Female_Adult_14', group: 'Adults', sex: 'f', as: 'cafe_f1', tex: 512 },
  { id: 'Male_Adult_02', group: 'Adults', sex: 'm', as: 'cafe_m1', tex: 512 },
  { id: 'Female_Adult_08', group: 'Adults', sex: 'f', as: 'cafe_f2', tex: 512 },
  { id: 'Male_Adult_11', group: 'Adults', sex: 'm', as: 'cafe_m2', tex: 512 },         // the customer with the laptop: looks like everyone else
  // desert site
  { id: 'Male_Adult_05', group: 'Adults', sex: 'm', as: 'site_m1', tex: 512 },         // field vest
  // second pass: more people everywhere (ambience)
  { id: 'Business_Female_02', group: 'Professions', sex: 'f', as: 'office_f3', tex: 512 },
  { id: 'Business_Male_01', group: 'Professions', sex: 'm', as: 'office_m4', tex: 512 },
  { id: 'Business_Male_04', group: 'Professions', sex: 'm', as: 'office_m5', tex: 512 },
  { id: 'Female_Adult_03', group: 'Adults', sex: 'f', as: 'office_f4', tex: 512 },
  { id: 'Male_Adult_13', group: 'Adults', sex: 'm', as: 'office_m6', tex: 512 },
  { id: 'Business_Female_03', group: 'Professions', sex: 'f', as: 'office_f5', tex: 512 },
  { id: 'Security_Male_01', group: 'Professions', sex: 'm', as: 'guard', tex: 512 },
  { id: 'Male_Adult_01', group: 'Adults', sex: 'm', as: 'street_m2', tex: 512 },
  { id: 'Male_Adult_03', group: 'Adults', sex: 'm', as: 'street_m3', tex: 512 },
  { id: 'Male_Adult_14', group: 'Adults', sex: 'm', as: 'street_m4', tex: 512 },
  { id: 'Male_Adult_16', group: 'Adults', sex: 'm', as: 'street_m5', tex: 512 },
  { id: 'Female_Adult_01', group: 'Adults', sex: 'f', as: 'street_f2', tex: 512 },
  { id: 'Female_Adult_04', group: 'Adults', sex: 'f', as: 'street_f3', tex: 512 },
  { id: 'Female_Adult_12', group: 'Adults', sex: 'f', as: 'street_f4', tex: 512 },
  { id: 'Female_Adult_11', group: 'Adults', sex: 'f', as: 'street_f5', tex: 512 },     // long dress
  { id: 'Gardener_Male_01', group: 'Professions', sex: 'm', as: 'gardener', tex: 512 },
  { id: 'Female_Adult_05', group: 'Adults', sex: 'f', as: 'cafe_f3', tex: 512 },
  { id: 'Male_Adult_15', group: 'Adults', sex: 'm', as: 'cafe_m3', tex: 512 },         // kandura
  { id: 'Female_Adult_15', group: 'Adults', sex: 'f', as: 'cafe_f4', tex: 512 },
  { id: 'Male_Adult_12', group: 'Adults', sex: 'm', as: 'cafe_m4', tex: 512 },
  { id: 'Construction_Male_01', group: 'Professions', sex: 'm', as: 'site_m2', tex: 512 },
  { id: 'Construction_Male_02', group: 'Professions', sex: 'm', as: 'site_m3', tex: 512 },
  { id: 'Construction_Male_04', group: 'Professions', sex: 'm', as: 'site_m4', tex: 512 },
];

/**
 * clips (without the m_/f_ prefix). static = in place; xy = locomotion with the root motion taken out.
 * range = the frames kept (30 fps). Long idles are cut to 10 s to keep the files small; the phone clips keep only
 * the part where the phone is held (measured: the hand rises over frames 1–60 and drops again near the end).
 */
export const CLIPS: Array<{ name: string; set: 'static' | 'xy'; as: string; only?: 'm' | 'f'; range?: [number, number] }> = [
  { name: 'idle_neutral_01', set: 'static', as: 'idle', range: [1, 301] },
  { name: 'idle_look_around_01', set: 'static', as: 'look' },
  { name: 'gestic_talk_neutral_01', set: 'static', as: 'talk', range: [1, 301] },
  { name: 'cell_phone_textmessage', set: 'static', as: 'text', range: [61, 361] },
  { name: 'cell_phone_talk_01', set: 'static', as: 'call', only: 'm', range: [91, 391] },
  { name: 'sit_chair_idle_neutral_01', set: 'static', as: 'sit', range: [1, 301] },
  { name: 'sit_table_idle_neutral_01', set: 'static', as: 'sit_table', range: [1, 301] },
  { name: 'walk_neutral_01', set: 'xy', as: 'walk' },
  { name: 'run_neutral_01', set: 'xy', as: 'run' },
  // second pass: variety for the background people
  { name: 'walk_stroll_01', set: 'xy', as: 'stroll' },
  { name: 'sit_table_gestic_thoughtful', set: 'static', as: 'sit_think', range: [1, 301] },
  { name: 'sit_table_idle_look_around', set: 'static', as: 'sit_look', range: [1, 301] },
  { name: 'sit_chair_idle_relaxed_01', set: 'static', as: 'sit_relax', range: [1, 301] },
  { name: 'drink_drinking', set: 'static', as: 'drink', range: [1, 301] },
  { name: 'idle_waiting_01', set: 'static', as: 'wait', range: [1, 301] },
  { name: 'gestic_listen_neutral_01', set: 'static', as: 'listen', range: [1, 301] },
  { name: 'work_table', set: 'static', as: 'work', range: [1, 301] },
  { name: 'work_mid', set: 'static', as: 'work_mid', range: [1, 301] },
  { name: 'crouch_idle', set: 'static', as: 'crouch', range: [1, 301] },
];

const DL = 'assets-src/downloads/rocketbox';
async function get(url: string, to: string) {
  if (existsSync(to) && statSync(to).size > 0) return;
  mkdirSync(dirname(to), { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  writeFileSync(to, Buffer.from(await r.arrayBuffer()));
  console.log('  got', to, `${(statSync(to).size / 1e6).toFixed(1)} MB`);
}

for (const p of PEOPLE) {
  const base = `${p.group}/${p.id}`;
  await get(`${RAW}/Avatars/${base}/Export/${p.id}.fbx`, join(DL, 'avatars', p.id, `${p.id}.fbx`));
  const texDir = join(DL, 'avatars', p.id, 'textures');
  const listFile = join(texDir, '_list.json');
  if (!existsSync(listFile)) {
    const r = await fetch(`${API}/Avatars/${base}/Textures`);
    if (!r.ok) throw new Error(`${r.status} listing ${base}`);
    mkdirSync(texDir, { recursive: true });
    writeFileSync(listFile, await r.text());
  }
  const list = JSON.parse(await (await import('node:fs/promises')).readFile(listFile, 'utf8')) as Array<{ name: string }>;
  // colour, normal and opacity maps; the specular and wrinkle maps are not used (glTF is metal/rough)
  for (const f of list) if (/_(color|normal)\.tga$/i.test(f.name) && !/wrinkle/i.test(f.name)) await get(`${RAW}/Avatars/${base}/Textures/${f.name}`, join(texDir, f.name));
}
for (const sex of ['m', 'f'] as const) {
  for (const c of CLIPS) {
    if (c.only && c.only !== sex) continue;
    const file = `${sex}_${c.name}.max.fbx`;
    await get(`${RAW}/Animations/all_animations_max_motextr_${c.set}/${file}`, join(DL, 'anim', file));
  }
}
writeFileSync(join(DL, 'manifest.json'), JSON.stringify({ people: PEOPLE, clips: CLIPS }, null, 1));
console.log('done');
