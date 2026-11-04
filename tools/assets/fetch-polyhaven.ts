/**
 * Fetch the CC0 Poly Haven HDRIs and PBR textures the realistic renderer uses (plan §11, §12).
 *   npx tsx tools/assets/fetch-polyhaven.ts
 * Raw downloads go to assets-src/downloads/ (not shipped); the used maps are copied into public/hdri and public/textures.
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
console.log('\nCREDITS rows:\n' + credits.join('\n'));
