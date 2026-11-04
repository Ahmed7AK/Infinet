/**
 * Batch experiments (plan §9.11). Same engine as the live demo, scripted routes, many seeded runs.
 *   npm run batch -- --scenario all --runs 300 --seed 1
 *   npm run batch -- --property 5000
 * Output: results/<date>/<scenario>.json + .csv, SUMMARY.md, charts/*.svg
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSim, MUST_SCENARIOS, POLICY_LABEL, ALL_POLICIES, type PolicyResult, type ScenarioId, Rng } from '../../src/engine/index';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const runs = Number(arg('runs', '300'));
const seed0 = Number(arg('seed', '1'));
const scenArg = arg('scenario', 'all');
const property = Number(arg('property', '0'));
const date = arg('date', new Date().toISOString().slice(0, 10));
const outDir = arg('out', join('results', date));
mkdirSync(join(outDir, 'charts'), { recursive: true });

type Row = PolicyResult & { run: number; seed: number; speed: number; staleness: number; offsetDb: number; mode: string };

const METRICS: Array<{ k: keyof PolicyResult; label: string; unit: string; dp: number }> = [
  { k: 'frozenS', label: 'Seconds frozen', unit: 's', dp: 2 },
  { k: 'longestFrozenS', label: 'Longest freeze', unit: 's', dp: 2 },
  { k: 'voiceLostPct', label: 'Voice lost or late', unit: '%', dp: 2 },
  { k: 'mosMean', label: 'MOS (mean)', unit: '', dp: 2 },
  { k: 'mosMin5', label: 'MOS (worst 5 s)', unit: '', dp: 2 },
  { k: 'fakeAdmissionFrames', label: 'Voice frames sent over a fake network', unit: '', dp: 1 },
  { k: 'invariantViolations', label: 'Frames on unchecked/Blocked networks', unit: '', dp: 1 },
  { k: 'wronglyBlocked', label: 'Real networks wrongly blocked', unit: '', dp: 2 },
  { k: 'dupExtraPct', label: 'Extra data from duplication', unit: '%', dp: 2 },
  { k: 'falseDead', label: 'False "link dead" verdicts', unit: '', dp: 2 },
];

function runScenario(sc: Exclude<ScenarioId, 'free'>): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < runs; i++) {
    const seed = seed0 * 100_000 + i;
    const r = Rng.named(seed, 'batch');
    const speed = r.uniform(1.0, 1.6);
    const staleness = r.uniform(0, 0.3);
    const offsetDb = r.uniform(10, 25);
    const mode = r.next() < 0.5 ? 'intercept' : 'relay';
    const sim = createSim(sc, seed, {
      policies: ALL_POLICIES,
      startOffsetS: r.uniform(0, 2),
      lab: { walkSpeed: speed, mapStaleness: staleness, attackerOffsetDb: offsetDb, attackerMode: mode as any },
    });
    for (const res of sim.runToEnd()) rows.push({ ...res, run: i, seed, speed, staleness, offsetDb, mode });
  }
  return rows;
}

// ───────────── statistics ─────────────
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const quant = (x: number[], q: number) => { const s = [...x].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; };
function bootstrapCi(x: number[], seed: number, B = 1000): [number, number] {
  const r = new Rng(seed);
  const ms: number[] = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < x.length; i++) s += x[Math.floor(r.next() * x.length)]; ms.push(s / x.length); }
  return [quant(ms, 0.025), quant(ms, 0.975)];
}
const fmt = (x: number, dp: number) => (Number.isFinite(x) ? x.toFixed(dp) : 'n/a');

const scenarios = scenArg === 'all' ? MUST_SCENARIOS : [scenArg as Exclude<ScenarioId, 'free'>];
const summary: Record<string, any> = { date, runs, seed: seed0, scenarios: {} };
let md = `# Infinet batch results (simulated)\n\nGenerated ${date} · ${runs} seeded runs per scenario · seed base ${seed0} · same engine as the live demo.\n\n`;
md += `Per run, randomised: walking speed 1.0–1.6 m/s, start offset 0–2 s, shadowing and map-error fields, map staleness 0–0.3, attacker mode (intercept/relay) and power offset +10…+25 dB, LEO phase and spike sizes, GEO RTT 600–700 ms, router failover 2–5 s, app reconnect delays.\n\n`;
md += `Policies: ${ALL_POLICIES.map((p) => `**${POLICY_LABEL[p]}** (${p})`).join(' · ')}.\n\n`;
md += `Values: mean · median · p95 · [95% bootstrap CI of the mean]. "Simulated, with settings from published measurements" (see Lab → Sim notes).\n\n`;

for (const sc of scenarios) {
  const t0 = Date.now();
  const rows = runScenario(sc);
  console.log(`${sc}: ${runs} runs in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  writeFileSync(join(outDir, `${sc}.json`), JSON.stringify(rows));
  const cols = Object.keys(rows[0]);
  writeFileSync(join(outDir, `${sc}.csv`), [cols.join(','), ...rows.map((r) => cols.map((c) => (r as any)[c]).join(','))].join('\n'));
  summary.scenarios[sc] = {};
  md += `## ${sc}\n\n| Metric | ${ALL_POLICIES.map((p) => POLICY_LABEL[p]).join(' | ')} |\n|---|${ALL_POLICIES.map(() => '---').join('|')}|\n`;
  for (const m of METRICS) {
    const cells: string[] = [];
    for (const p of ALL_POLICIES) {
      const x = rows.filter((r) => r.policy === p).map((r) => Number(r[m.k] ?? 0));
      const ci = bootstrapCi(x, 7);
      const s = { mean: mean(x), median: quant(x, 0.5), p95: quant(x, 0.95), max: Math.max(...x), ci };
      (summary.scenarios[sc][p] ??= {})[m.k] = s;
      cells.push(`${fmt(s.mean, m.dp)} · ${fmt(s.median, m.dp)} · ${fmt(s.p95, m.dp)} [${fmt(ci[0], m.dp)}–${fmt(ci[1], m.dp)}]`);
    }
    md += `| ${m.label}${m.unit ? ` (${m.unit})` : ''} | ${cells.join(' | ')} |\n`;
  }
  const surv = ALL_POLICIES.map((p) => { const x = rows.filter((r) => r.policy === p); const n = x.filter((r) => r.survived).length; (summary.scenarios[sc][p] ??= {}).survived = { n, of: x.length }; return `${n} / ${x.length}`; });
  md += `| Calls survived (no freeze ≥ 8 s) | ${surv.join(' | ')} |\n`;
  const inf = rows.filter((r) => r.policy === 'infinet' && r.predLeadS !== undefined);
  if (inf.length) {
    const lead = inf.map((r) => r.predLeadS!), err = inf.filter((r) => r.predErrS !== undefined).map((r) => r.predErrS!);
    summary.scenarios[sc].infinet.predLeadS = { mean: mean(lead), median: quant(lead, 0.5), p05: quant(lead, 0.05) };
    md += `\nInfinet prediction: switched a mean of **${fmt(mean(lead), 2)} s** (median ${fmt(quant(lead, 0.5), 2)} s, p5 ${fmt(quant(lead, 0.05), 2)} s) before the Wi-Fi actually crossed −75 dBm` + (err.length ? `; predicted-vs-true crossing error mean ${fmt(mean(err), 2)} s.` : '.') + '\n';
  }
  md += '\n';
  writeFileSync(join(outDir, 'charts', `${sc}-frozen.svg`), frozenChart(sc, rows));
}

if (property > 0) {
  const t0 = Date.now();
  const r = new Rng(2026);
  let violations = 0, fake = 0;
  for (let i = 0; i < property; i++) {
    const sc = r.next() < 0.6 ? 'cafe-twin' : 'building-exit';
    const res = createSim(sc, 900_000 + i, { policies: ['infinet'], lab: { attackerMode: r.next() < 0.5 ? 'intercept' : 'relay', attackerOffsetDb: r.uniform(0, 25), deauth: r.next() < 0.7, mapStaleness: r.uniform(0, 1), walkSpeed: r.uniform(1.0, 1.6) } }).runToEnd()[0];
    violations += res.invariantViolations; fake += res.fakeAdmissionFrames;
  }
  summary.property = { runs: property, violations, fakeAdmissionFrames: fake };
  console.log(`property: ${property} runs in ${((Date.now() - t0) / 1000).toFixed(1)} s → violations ${violations}, fake frames ${fake}`);
  md += `## Invariant (property test)\n\nAcross **${property.toLocaleString('en')}** randomised café and building-exit runs (attacker modes and offsets 0–25 dB, deauth on/off, map staleness 0–1, speeds 1.0–1.6 m/s), Infinet sent **${violations}** voice frames over an unchecked or Blocked network and **${fake}** frames over the fake network.\n`;
}

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(outDir, 'SUMMARY.md'), md);
console.log(`wrote ${outDir}/SUMMARY.md`);

// ───────────── chart (brand: Infinet in Violet, everything else in Steel; bar = average, tick = worst run) ─────────────
function frozenChart(sc: string, rows: Row[]): string {
  const pols = ['b1', 'b2', 'b3', 'infinet'] as const;
  const W = 720, H = 300, L = 200, R = 40, T = 50, rowH = 50;
  const vals = pols.map((p) => { const x = rows.filter((r) => r.policy === p).map((r) => r.frozenS); return { p, avg: mean(x), worst: Math.max(...x) }; });
  const max = Math.max(1, ...vals.map((v) => v.worst)) * 1.08;
  const X = (x: number) => L + ((W - L - R) * x) / max;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="IBM Plex Sans, Arial, sans-serif">`;
  s += `<rect width="${W}" height="${H}" fill="#FFFFFF"/>`;
  s += `<text x="24" y="28" font-family="Chakra Petch, Arial" font-weight="700" font-size="18" fill="#0A0B14">Seconds frozen · ${sc}</text>`;
  s += `<text x="24" y="${H - 12}" font-size="11" fill="#5C6272">Bar = average, tick = worst run · N = ${runs} runs · SIMULATED · same engine as the live demo</text>`;
  for (let g = 0; g <= max; g += max > 20 ? 5 : max > 8 ? 2 : 1) s += `<line x1="${X(g)}" y1="${T - 6}" x2="${X(g)}" y2="${T + rowH * pols.length - 10}" stroke="#E9EBF0"/><text x="${X(g)}" y="${T + rowH * pols.length + 6}" font-size="11" fill="#5C6272" text-anchor="middle" font-family="IBM Plex Mono, Menlo">${g}</text>`;
  vals.forEach((v, i) => {
    const y = T + i * rowH;
    const c = v.p === 'infinet' ? '#730FFF' : '#5C6272';
    s += `<text x="${L - 12}" y="${y + 20}" font-size="13" fill="#0A0B14" text-anchor="end">${POLICY_LABEL[v.p]}</text>`;
    s += `<rect x="${L}" y="${y + 6}" width="${Math.max(1.5, X(v.avg) - L)}" height="22" fill="${c}"/>`;
    s += `<line x1="${X(v.worst)}" y1="${y + 2}" x2="${X(v.worst)}" y2="${y + 32}" stroke="${c}" stroke-width="2"/>`;
    s += `<text x="${Math.min(W - 6, X(v.worst) + 6)}" y="${y + 22}" font-size="12" fill="${c}" font-family="IBM Plex Mono, Menlo">${v.avg.toFixed(2)} s · worst ${v.worst.toFixed(1)} s</text>`;
  });
  return s + '</svg>';
}
