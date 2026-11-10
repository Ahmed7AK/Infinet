/**
 * Builds the venue environment (src/engine/world/venue.ts) from a private plan and our own Wi-Fi survey files.
 *   ./node_modules/.bin/tsx venue-private/hall/plan.mts   (the hall's geometry, private)
 *   ./node_modules/.bin/tsx tools/venue/build.ts          → venue-private/hall/venue.json
 *
 * The survey (tools/survey-android) stores every access point as a salted id, a radio group, channel and the
 * median signal at each point we stood. From that:
 *  - venue access points: each radio of the venue's infrastructure (its vendor prefix, from the plan) heard at
 *    5 or more points is placed by a grid search inside the hall, with the engine's own log-distance model
 *    (free-space loss at 1 m from params). One path-loss exponent for the hall (≥ 2, free space) and one mounting
 *    height; the transmit power (EIRP) of each radio is the least-squares fit. Points where a radio was not heard
 *    count against positions that would make it loud there (> −82 dBm).
 *  - its networks: the open network heard on the most radios is the free guest network (also the one on 2.4 GHz);
 *    the other networks on each radio are kept as anonymous aliases, so the scan list has the same density.
 *  - everyone else's networks, one by one: phone hotspots (locally administered addresses) and fixed devices
 *    (exhibitors' routers, printers, …). Each one heard at 3+ points is placed by the same grid search (its own
 *    EIRP); one heard at 1–2 points can't be placed on its own, so it gets the typical EIRP of its kind and the
 *    search finds where that power gives what we heard there and silence elsewhere. Band, channel, security,
 *    PMF, Wi-Fi generation and width are kept as measured; names never are (the survey only has salted ids).
 *  - the mobile network: one operator site whose bearing and distance make the 3GPP model (TR 38.901 UMa with
 *    the hall's O2I loss) match the measured LTE RSRP of the serving cell.
 * Nothing here contains a network name other than the stand-in for the guest network.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { v } from '../../src/engine/params';
import { cellRsrpDet } from '../../src/engine/radio/propagation';
import { LAYOUT, type Building, type Transmitter } from '../../src/engine/world/layout';

type V2 = [number, number];
const ROOT = join(import.meta.dirname, '..', '..');
const DIR = join(ROOT, 'venue-private');
const plan = JSON.parse(readFileSync(join(DIR, 'hall', 'plan.json'), 'utf8'));

// ───────────── survey files ─────────────
interface Ap { ap: string; grp: string; net: string; la: boolean; oui?: string; band: '2.4' | '5'; ch: number; sec: string; rssi: number; std?: number; bw?: number; pmf?: string }
interface Pt { xM: number; yM: number; wifi: Ap[]; cell?: { cells: Array<{ reg: boolean; rat: string; rsrp: number; pci: number; bands: number[] }> }; t: string }
interface Survey { kind: string; id: string; device: { model: string }; points: Pt[]; created: string }
const surveys: Survey[] = readdirSync(join(DIR, 'survey')).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DIR, 'survey', f), 'utf8')) as Survey).filter((s) => s.kind === 'infinet-survey');
if (!surveys.length) throw new Error('no survey files in venue-private/survey');
// each phone salts its ids with its team code: the ids of two phones only match when the codes did. Fit on the
// survey with the most points; the others are a cross-check of the totals.
surveys.sort((a, b) => b.points.length - a.points.length);
const S = surveys[0];
const sf = plan.surveyFrame;
const toEngine = (p: Pt): V2 => [sf.origin[0] + sf.xSign * p.xM * sf.mPerUnit, sf.origin[1] + sf.ySign * p.yM * sf.mPerUnit];
const pts = S.points.map(toEngine);
const notes: string[] = [];
const note = (s: string) => { notes.push(s); console.log(s); };
note(`Survey: ${S.points.length} points by ${S.device.model} on ${S.created.slice(0, 10)} (file ${S.id}); ${surveys.length - 1} other file(s) used as a cross-check.`);

const quant = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };
const median = (xs: number[]) => quant(xs, 0.5);
const PL1 = (band: string) => (band === '2.4' ? v('wifiPl1m2GHz') : v('wifiPl1m5GHz'));
const UE_H = 1.2;
const [[bx0, by0], [bx1, by1]] = plan.apBounds as [V2, V2];
const apH: number = plan.apHeightM;

// ───────────── venue radios ─────────────
interface Radio { grp: string; band: '2.4' | '5'; ch: number; std?: number; obs: Map<number, number>; nets: Map<string, string> }
const radios = new Map<string, Radio>();
S.points.forEach((p, i) => {
  for (const a of p.wifi) {
    if (a.la || a.oui !== plan.venueOui) continue;
    let r = radios.get(a.grp);
    if (!r) { r = { grp: a.grp, band: a.band, ch: a.ch, std: a.std, obs: new Map(), nets: new Map() }; radios.set(a.grp, r); }
    r.obs.set(i, Math.max(r.obs.get(i) ?? -200, a.rssi));
    r.nets.set(a.net, a.sec);
  }
});
// 5 GHz radios heard at 5+ points are placed; 2.4 GHz radios only at 9+ (that band was heard now and then, so
// fewer points carry less); the hall's exponent comes from the 5 GHz radios heard at 15+ points
const used = [...radios.values()].filter((r) => r.obs.size >= (r.band === '5' ? 5 : 9));
const solid = used.filter((r) => r.band === '5' && r.obs.size >= 15);
note(`Venue infrastructure: ${radios.size} radio groups heard; ${used.length} placed (5 GHz at 5+ points, 2.4 GHz at 9+); the exponent comes from the ${solid.length} radios heard at 15+ points.`);

const CENSOR = -82;
function fitRadio(r: Radio, n: number) {
  let best = { sse: Infinity, x: 0, y: 0, p0: 0 };
  // plan frame bounds → engine (y flips)
  const ex0 = sf.origin[0] + bx0, ex1 = sf.origin[0] + bx1, ey0 = sf.origin[1] - by1, ey1 = sf.origin[1] - by0;
  for (let X = ex0; X <= ex1; X += 1) for (let Y = ey0; Y <= ey1; Y += 1) {
    const loss = pts.map(([x, y]) => 10 * n * Math.log10(Math.max(1, Math.hypot(x - X, y - Y, apH - UE_H))));
    let s = 0;
    for (const [i, rs] of r.obs) s += rs + loss[i];
    const p0 = s / r.obs.size;
    let sse = 0;
    for (const [i, rs] of r.obs) sse += (rs - (p0 - loss[i])) ** 2;
    for (let i = 0; i < pts.length; i++) if (!r.obs.has(i)) { const pr = p0 - loss[i]; if (pr > CENSOR) sse += (pr - CENSOR) ** 2; }
    if (sse < best.sse) best = { sse, x: X, y: Y, p0 };
  }
  return best;
}
let bestN = { n: 2, rmse: Infinity };
for (let n = 2.0; n <= 3.01; n += 0.2) {
  let sse = 0, k = 0;
  for (const r of solid) { sse += fitRadio(r, n).sse; k += r.obs.size; }
  const rmse = Math.sqrt(sse / k);
  console.log(`  n = ${n.toFixed(1)}: RMS error ${rmse.toFixed(2)} dB`);
  if (rmse < bestN.rmse) bestN = { n: Math.round(n * 10) / 10, rmse };
}
note(`Path-loss exponent for the hall: n = ${bestN.n} (searched 2.0–3.0, free space or more; RMS error ${bestN.rmse.toFixed(1)} dB over those radios), radios at ${apH} m.`);

// the free guest network: the open network carried by the most radios
const netRadios = new Map<string, number>();
for (const r of used) for (const [net, sec] of r.nets) if (sec === 'OPEN') netRadios.set(net, (netRadios.get(net) ?? 0) + 1);
const guest = [...netRadios.entries()].sort((a, b) => b[1] - a[1])[0][0];
note(`Guest network: the open network on ${netRadios.get(guest)} of ${used.length} radios (both bands), shown as "${plan.guestSsid}".`);

const hx2 = (n: number) => (n & 255).toString(16).padStart(2, '0');
const hall = plan.layout.zones[0].bounds as [V2, V2];
const grid = { bounds: hall, res: 1 };
const aps: Transmitter[] = [];
const secOf = (s: string) => (s === 'OPEN' ? 'OPEN' : s === 'WPA2/3' ? 'WPA2/3' : s === 'WPA3-SAE' ? 'WPA3-SAE' : s.startsWith('WPA2') ? 'WPA2-PSK' : 'WPA2-PSK') as Transmitter['security'] & string;
let skipped = 0;
used.sort((a, b) => b.obs.size - a.obs.size).forEach((r) => {
  if (!r.nets.has(guest)) { skipped++; return; }
  const f = fitRadio(r, bestN.n);
  const k = aps.length + 1;
  const others = [...r.nets.entries()].filter(([net]) => net !== guest);
  aps.push({
    id: `hall-ap-${k}`, kind: 'wifi', net: 'venue-free', ssid: plan.guestSsid, bssid: `0a:7e:51:00:${hx2(k)}:00`,
    security: 'OPEN', pmf: 'none', band: r.band, channel: r.ch, pos: [f.x, f.y, apH], eirpDbm: Math.round((f.p0 + PL1(r.band)) * 10) / 10,
    plExp: bestN.n, captivePortal: true, airtimeLoad: true, zone: 'hall', grid, std: r.std,
    alias: others.map(([, sec], j) => ({ bssid: `0a:7e:51:00:${hx2(k)}:${hx2(j + 1)}`, security: secOf(sec) })),
    fit: { points: r.obs.size, rmseDb: Math.round(Math.sqrt(f.sse / r.obs.size) * 10) / 10 },
  });
});
const rmsBand = (b: string) => { const xs = aps.filter((t) => t.band === b); const n = xs.reduce((s, t) => s + t.fit!.points, 0); return n ? Math.sqrt(xs.reduce((s, t) => s + t.fit!.rmseDb ** 2 * t.fit!.points, 0) / n).toFixed(1) : '—'; };
note(`Fit error per band (RMS): 5 GHz ${rmsBand('5')} dB, 2.4 GHz ${rmsBand('2.4')} dB.`);
const e5 = aps.filter((a) => a.band === '5').map((a) => a.eirpDbm!), e2 = aps.filter((a) => a.band === '2.4').map((a) => a.eirpDbm!);
note(`Placed ${aps.length} venue radios (${e5.length} at 5 GHz, EIRP ${Math.min(...e5)} to ${Math.max(...e5)} dBm; ${e2.length} at 2.4 GHz, EIRP ${e2.length ? `${Math.min(...e2)} to ${Math.max(...e2)}` : '—'} dBm)${skipped ? `; ${skipped} radio(s) without the guest network left out` : ''}.`);
note('Venue Wi-Fi sign-in page: ASSUMPTION. UAE public Wi-Fi asks visitors to register before use; the survey did not join it.');

// ───────────── everyone else's networks: phone hotspots and fixed devices, one by one ─────────────
interface Other { ap: string; la: boolean; net: string; band: '2.4' | '5'; ch: number; sec: string; std?: number; bw?: number; pmf?: string; obs: Map<number, number> }
const others = new Map<string, Other>();
S.points.forEach((p, i) => {
  for (const a of p.wifi) {
    if (!a.la && a.oui === plan.venueOui) continue;
    let o = others.get(a.ap);
    if (!o) { o = { ap: a.ap, la: a.la, net: a.net, band: a.band, ch: a.ch, sec: a.sec, std: a.std, bw: a.bw, pmf: a.pmf, obs: new Map() }; others.set(a.ap, o); }
    o.obs.set(i, Math.max(o.obs.get(i) ?? -200, a.rssi));
  }
});
const oRssi = [...others.values()].flatMap((o) => [...o.obs.values()]);
const FLOOR = quant(oRssi, 0.02);                        // the weakest the survey phone reported: its scan floor
const H_PHONE = 1.2, H_DEVICE = 1.5;                     // ASSUMPTION: phones at hand height, devices on a counter or stand
const EIRP_RANGE: [number, number] = [-5, 23];
// candidate positions: the hall and the Link (plan frame x −12 … W, y −1 … H + 1), every metre
const cand: V2[] = [];
for (let x = -12; x <= plan.size[0]; x += 1) for (let y = -1; y <= plan.size[1] + 1; y += 1) cand.push([sf.origin[0] + x, sf.origin[1] - y]);
// A miss counts only where the model makes the network clearly loud (8 dB over the scan floor): the points were
// taken one after another, phones come and go and one scan misses some, so a quiet miss says little. How often a
// network was on air is fitted after (below), from where it was heard against where it would have been audible.
const CENSOR_O = FLOOR + 8;
const lossTab = (h: number, n: number) => cand.map(([X, Y]) => pts.map(([x, y]) => 10 * n * Math.log10(Math.max(1, Math.hypot(x - X, y - Y, h - UE_H)))));
type Tabs = { phone: number[][]; device: number[][] };
/** best position (and EIRP, unless fixed) for one network; misses count against positions that would make it loud there */
function fitOther(o: Other, T: Tabs, fixedEirp?: number) {
  const tab = o.la ? T.phone : T.device, pl1 = PL1(o.band);
  let best = { sse: Infinity, k: 0, p0: 0 };
  for (let k = 0; k < cand.length; k++) {
    const loss = tab[k];
    let p0: number;
    if (fixedEirp !== undefined) p0 = fixedEirp - pl1;
    else { let s = 0; for (const [i, rs] of o.obs) s += rs + loss[i]; p0 = Math.min(EIRP_RANGE[1] - pl1, Math.max(EIRP_RANGE[0] - pl1, s / o.obs.size)); }
    let sse = 0;
    for (const [i, rs] of o.obs) sse += (rs - (p0 - loss[i])) ** 2;
    for (let i = 0; i < pts.length; i++) if (!o.obs.has(i)) { const pr = p0 - loss[i]; if (pr > CENSOR_O) sse += (pr - CENSOR_O) ** 2; }
    if (sse < best.sse) best = { sse, k, p0 };
  }
  return { pos: cand[best.k], eirp: best.p0 + pl1, rmse: Math.sqrt(best.sse / o.obs.size), sse: best.sse };
}
// phones and devices sit low, among stands and people: their own loss exponent, from the networks heard at 8+
// points (searched 2.0–4.0; the score includes the misses, so it also judges how far each one is heard)
const solidO = [...others.values()].filter((o) => o.obs.size >= 8);
let bestO = { n: 2, score: Infinity, T: null as Tabs | null };
for (let n = 2.0; n <= 4.01; n += 0.25) {
  const T = { phone: lossTab(H_PHONE, n), device: lossTab(H_DEVICE, n) };
  let sse = 0, k = 0;
  for (const o of solidO) { sse += fitOther(o, T).sse; k += o.obs.size; }
  const score = Math.sqrt(sse / k);
  console.log(`  others n = ${n.toFixed(2)}: score ${score.toFixed(2)} dB`);
  if (score < bestO.score) bestO = { n: Math.round(n * 100) / 100, score, T };
}
const LOSS = bestO.T!;
const nameIds = new Map<string, string>();
const placed: Array<{ o: Other; pos: V2; eirp: number; rmse: number; free: boolean }> = [];
const all = [...others.values()].sort((a, b) => b.obs.size - a.obs.size || a.ap.localeCompare(b.ap));
for (const o of all.filter((x) => x.obs.size >= 3)) placed.push({ o, ...fitOther(o, LOSS), free: true });
const typical = { phone: median(placed.filter((p) => p.o.la).map((p) => p.eirp)), device: median(placed.filter((p) => !p.o.la).map((p) => p.eirp)) };
for (const o of all.filter((x) => x.obs.size < 3)) placed.push({ o, ...fitOther(o, LOSS, o.la ? typical.phone : typical.device), free: false });
// on air: heard at h of the a points where the model makes it audible → on air h / a of the time (at least 10 %)
const presence = placed.map((p) => {
  let audible = 0;
  for (let i = 0; i < pts.length; i++) {
    const pr = p.eirp - PL1(p.o.band) - 10 * bestO.n * Math.log10(Math.max(1, Math.hypot(pts[i][0] - p.pos[0], pts[i][1] - p.pos[1], (p.o.la ? H_PHONE : H_DEVICE) - UE_H)));
    if (pr > FLOOR || p.o.obs.has(i)) audible++;
  }
  return Math.max(0.1, Math.min(1, p.o.obs.size / Math.max(1, audible)));
});
const secOther = (s: string) => secOf(s);
const hotspots = placed.map(({ o, pos, eirp, rmse }, k) => {
  if (!nameIds.has(o.net)) nameIds.set(o.net, `n${nameIds.size + 1}`);
  return {
    id: o.la ? `0e:5c:00:00:${hx2(k >> 8)}:${hx2(k)}` : `02:de:00:00:${hx2(k >> 8)}:${hx2(k)}`,
    kind: (o.la ? 'hotspot' : 'device') as 'hotspot' | 'device', name: nameIds.get(o.net)!,
    pos: pos.map((x) => Math.round(x * 10) / 10) as V2, h: o.la ? H_PHONE : H_DEVICE, eirpDbm: Math.round(eirp * 10) / 10,
    band: o.band, channel: o.ch, security: secOther(o.sec), pmf: (o.pmf === 'capable' ? 'optional' : o.pmf === 'required' ? 'required' : 'none') as 'none' | 'optional' | 'required',
    std: o.std, bwMHz: o.bw, onAir: Math.round(presence[k] * 100) / 100, fit: { points: o.obs.size, rmseDb: Math.round(rmse * 10) / 10 },
  };
});
// how well the placed networks reproduce the survey: count heard and signal at each point, per kind
/** expected number of networks of a kind heard at a spot (each weighted by its time on air) */
const simAt = ([x, y]: V2, kind: 'hotspot' | 'device') => hotspots.reduce((s, h, k) => s + (h.kind === kind && h.eirpDbm - PL1(h.band) - 10 * bestO.n * Math.log10(Math.max(1, Math.hypot(x - h.pos[0], y - h.pos[1], h.h - UE_H))) > FLOOR ? presence[k] : 0), 0);
const measAt = (i: number, la: boolean) => S.points[i].wifi.filter((a) => a.la === la && (la || a.oui !== plan.venueOui));
const cnt = (kind: 'hotspot' | 'device') => ({ sim: median(pts.map((p) => simAt(p, kind))).toFixed(1), meas: median(S.points.map((_, i) => measAt(i, kind === 'hotspot').length)) });
let se = 0, ne = 0;
for (const p of placed) for (const [i, rs] of p.o.obs) { const pr = p.eirp - PL1(p.o.band) - 10 * bestO.n * Math.log10(Math.max(1, Math.hypot(pts[i][0] - p.pos[0], pts[i][1] - p.pos[1], (p.o.la ? H_PHONE : H_DEVICE) - UE_H))); se += (pr - rs) ** 2; ne++; }
const nH = placed.filter((p) => p.o.la).length, nD = placed.length - nH;
const fH = placed.filter((p) => p.o.la && p.free).length, fD = placed.filter((p) => !p.o.la && p.free).length;
const ch = cnt('hotspot'), cd = cnt('device');
const gens = (la: boolean) => { const c = new Map<string, number>(); for (const p of placed) if (p.o.la === la) { const g = p.o.std === 8 ? 'Wi-Fi 7' : p.o.std ? `Wi-Fi ${p.o.std}` : '?'; c.set(g, (c.get(g) ?? 0) + 1); } return [...c.entries()].sort().map(([g, n]) => `${n} ${g}`).join(', '); };
note(`Everyone else's networks, placed one by one: ${nH} phone hotspots (randomised addresses; ${gens(true)}) and ${nD} fixed devices (${gens(false)}). ${fH} hotspots and ${fD} devices heard at 3+ points are placed with their own EIRP; the ${placed.length - fH - fD} heard at 1–2 points use the typical EIRP of their kind (hotspots ${typical.phone.toFixed(1)} dBm, devices ${typical.device.toFixed(1)} dBm). Their own loss exponent n = ${bestO.n} (searched 2.0–4.0 on the ${solidO.length} heard at 8+ points, misses included); phones at ${H_PHONE} m, devices at ${H_DEVICE} m (ASSUMPTION). ${nameIds.size} distinct names, kept only as ids.`);
note(`Placed networks against the survey: RMS signal error ${Math.sqrt(se / ne).toFixed(1)} dB over ${ne} readings; each is on air for the share of time it was heard where it should have been audible (median ${Math.round(median(presence) * 100)} %), so per point the model hears ${ch.sim} hotspots and ${cd.sim} devices on average (median over the points), the survey heard ${ch.meas} and ${cd.meas}. Scan floor ${FLOOR} dBm (the weakest 2 % the phone reported).`);

// ───────────── the mobile network ─────────────
const cellPts = S.points.map((p, i) => ({ i, c: p.cell?.cells.find((c) => c.reg) })).filter((x) => x.c);
const rsrp = cellPts.map((x) => x.c!.rsrp);
note(`Mobile: serving cell ${cellPts[0].c!.rat} band ${cellPts[0].c!.bands.join('/')} (one PCI at every point), RSRP ${Math.min(...rsrp)} to ${Math.max(...rsrp)} dBm, median ${median(rsrp)} dBm. The simulated link stays 5G with this RSRP (the second phone is 4G-only, so LTE is all it could show).`);
LAYOUT.buildings.push(...(plan.layout.buildings as Building[]));
const cc = plan.cellCandidates;
const hallC: V2 = [sf.origin[0] + plan.size[0] / 2, sf.origin[1] - plan.size[1] / 2];
// the level is calibrated (one offset for the site, reported); bearing and distance give the shape across the hall
let bestC = { sse: Infinity, az: 0, d: 0, mean: 0 };
for (let az = 0; az < 360; az += 5) for (let d = 100; d <= 3000; d += 25) {
  const a = (az * Math.PI) / 180;
  const pos: [number, number, number] = [hallC[0] + Math.sin(a) * d, hallC[1] + Math.cos(a) * d, cc.heightM];
  const back = (az + 180) % 360;
  const tx = { id: 'fit', kind: 'cell', net: 'cell-a', pos, fcGHz: cc.fcGHz, model: cc.model, sectors: [{ azDeg: back, downtiltDeg: 4 }, { azDeg: (back + 120) % 360, downtiltDeg: 4 }, { azDeg: (back + 240) % 360, downtiltDeg: 4 }], grid } as Transmitter;
  const res = cellPts.map((x) => cellRsrpDet(tx, pts[x.i]).rsrpDbm - x.c!.rsrp);
  const mean = res.reduce((s, r) => s + r, 0) / res.length;
  const sse = res.reduce((s, r) => s + (r - mean) ** 2, 0);
  if (sse < bestC.sse - 1e-6) bestC = { sse, az, d, mean };
}
const a = (bestC.az * Math.PI) / 180, back = (bestC.az + 180) % 360;
const cell: Transmitter = {
  id: 'cellA-hall', kind: 'cell', net: 'cell-a', operator: 'Cellular A', fcGHz: cc.fcGHz, model: cc.model, zone: 'hall',
  pos: [Math.round(hallC[0] + Math.sin(a) * bestC.d), Math.round(hallC[1] + Math.cos(a) * bestC.d), cc.heightM],
  sectors: [{ azDeg: back, downtiltDeg: 4 }, { azDeg: (back + 120) % 360, downtiltDeg: 4 }, { azDeg: (back + 240) % 360, downtiltDeg: 4 }],
  grid: { bounds: hall, res: 2 }, rsrpOffsetDb: Math.round(-bestC.mean * 10) / 10,
  // what the phones were registered on: the screen says 4G for LTE, 5G otherwise (the radio model is the same)
  rat: cellPts.every((x) => x.c!.rat === 'LTE') ? 'LTE' : 'NR',
};
note(`Mobile technology: the survey phone was registered on ${[...new Set(cellPts.map((x) => x.c!.rat))].join(' and ')} at every point${cell.rat === 'LTE' ? ' (no 5G cell reported), so the hall shows it as 4G' : ''}.`);
note(`Mobile site fitted ${bestC.d} m away at bearing ${bestC.az}° (${cc.model}, ${cc.fcGHz} GHz, ${cc.heightM} m, hall O2I ${plan.layout.buildings[0].o2i}): RMS error ${Math.sqrt(bestC.sse / cellPts.length).toFixed(1)} dB after a calibration of ${-bestC.mean > 0 ? '+' : ''}${(-bestC.mean).toFixed(1)} dB. The measured signal is that much stronger than an outdoor site would give through the hall's walls under TR 38.901, so the hall most likely has indoor antennas; the offset makes the site match what we measured.`);

// ───────────── cross-check with the other phone(s) ─────────────
for (const o of surveys.slice(1)) {
  for (const p of o.points) {
    const v5 = p.wifi.filter((x) => x.oui === plan.venueOui && x.band === '5');
    const best = Math.max(...v5.map((x) => x.rssi));
    const [x, y] = toEngine(p);
    let pred = -200;
    for (const t of aps) if (t.band === '5') pred = Math.max(pred, t.eirpDbm! - PL1('5') - 10 * bestN.n * Math.log10(Math.hypot(x - t.pos[0], y - t.pos[1], apH - UE_H)));
    note(`Cross-check (${o.device.model}, ${p.xM}, ${p.yM}): strongest venue 5 GHz ${best} dBm measured, ${pred.toFixed(0)} dBm from the fitted radios; ${p.wifi.filter((q) => q.la).length} hotspots and ${p.wifi.filter((q) => !q.la && q.oui !== plan.venueOui).length} devices heard, ${simAt([x, y], 'hotspot').toFixed(0)} and ${simAt([x, y], 'device').toFixed(0)} in the model.`);
  }
}

// ───────────── survey markers ─────────────
const survey = {
  date: S.created.slice(0, 10),
  points: S.points.map((p, i) => {
    const v5 = p.wifi.filter((x) => x.oui === plan.venueOui);
    return { pos: pts[i], bestDbm: Math.max(...v5.map((x) => x.rssi)), venueRadios: new Set(v5.map((x) => x.grp)).size, hotspots: p.wifi.filter((x) => x.la).length, devices: p.wifi.filter((x) => !x.la && x.oui !== plan.venueOui).length };
  }),
};

const out = {
  kind: 'infinet-venue', v: 1, id: plan.id,
  layout: { ...plan.layout, transmitters: [...aps, cell] },
  hotspots: { plExp: bestO.n, floorDbm: FLOOR, list: hotspots },
  scenario: plan.scenario, plan: plan.plan, survey, notes,
};
writeFileSync(join(DIR, 'hall', 'venue.json'), JSON.stringify(out));
console.log(`→ venue-private/hall/venue.json (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
