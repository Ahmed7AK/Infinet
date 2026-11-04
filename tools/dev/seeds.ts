/** Pick demo seeds that show *typical* behaviour (near the batch median), not the luckiest or unluckiest run. */
import { createSim } from '../../src/engine/index';
const N = Number(process.argv[2] ?? 60);
for (const sc of ['building-exit', 'cafe-twin', 'desert-sat'] as const) {
  const rows: string[] = [];
  for (let seed = 1; seed <= N; seed++) {
    const sim = createSim(sc, seed, { prewarm: true });
    const r = sim.runToEnd();
    const by = Object.fromEntries(r.map((x) => [x.policy, x]));
    const ev = sim.eventsSince(0).events;
    const frz = (p: string) => ev.filter((e) => e.type === 'call.frozen' && (e as any).policy === p).map((e) => e.t.toFixed(1)).join('/');
    const blocked = ev.find((e) => e.type === 'trust.blocked')?.t;
    const base = sc === 'building-exit' ? 'b1' : sc === 'cafe-twin' ? 'b2' : 'b3';
    rows.push(`${sc} seed ${seed}: inf frozen ${by.infinet.frozenS.toFixed(2)} lost ${by.infinet.voiceLostPct.toFixed(1)}% | ${base} frozen ${by[base].frozenS.toFixed(2)} (at ${frz(base)}) fake ${by[base].fakeAdmissionFrames} falseDead ${by[base].falseDead} | b1 ${by.b1.frozenS.toFixed(1)} | blocked@${blocked?.toFixed(1) ?? '-'}`);
  }
  console.log(rows.join('\n'));
}
