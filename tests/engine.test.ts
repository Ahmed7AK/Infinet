import { describe, expect, it } from 'vitest';
import { createSim, geoLookAngle, MUST_SCENARIOS } from '../src/engine/index';
import { mos, rFactor } from '../src/engine/session/emodel';
import { plUMa, plRMa, cellRsrpDet, o2iWallLossDb, wallSet, wifiPathGainDb } from '../src/engine/radio/propagation';
import { txById } from '../src/engine/world/layout';
import { Rng, crn } from '../src/engine/rng';
import { correlatedField } from '../src/engine/fields/shadow';
import { PARAMS } from '../src/engine/params';

describe('determinism', () => {
  it('same seed → byte-identical metrics JSON', () => {
    for (const sc of MUST_SCENARIOS) {
      const a = JSON.stringify(createSim(sc, 7).runToEnd());
      const b = JSON.stringify(createSim(sc, 7).runToEnd());
      expect(a).toBe(b);
    }
  });
  it('different seeds differ', () => {
    const a = JSON.stringify(createSim('building-exit', 1).runToEnd());
    const b = JSON.stringify(createSim('building-exit', 2).runToEnd());
    expect(a).not.toBe(b);
  });
  it('rng and crn are stable', () => {
    expect(new Rng(1).next()).toBe(new Rng(1).next());
    expect(crn(1, 2, 3)).toBe(crn(1, 2, 3));
    expect(crn(1, 2, 3)).not.toBe(crn(1, 2, 4));
  });
});

describe('GEO look angle (trap #13)', () => {
  it('Al Ain → 52.5°E ≈ 188° az, 61° el', () => {
    const la = geoLookAngle(24.2, 55.7, 52.5);
    expect(la.azDeg).toBeGreaterThan(186.5);
    expect(la.azDeg).toBeLessThan(189.5);
    expect(la.elDeg).toBeGreaterThan(60);
    expect(la.elDeg).toBeLessThan(62.5);
  });
});

describe('E-model (ITU-T G.107 / G.113)', () => {
  it('R ≈ 92 at 0 loss, 50 ms mouth-to-ear', () => {
    expect(rFactor(50, 0)).toBeCloseTo(92, 0);
  });
  it('MOS ≈ 3.1–3.2 for GEO (d ≈ 385 ms, no loss)', () => {
    const m = mos(385, 0);
    expect(m).toBeGreaterThan(3.1);
    expect(m).toBeLessThan(3.25);
  });
  it('MOS ≈ 4.3–4.4 for LEO (d ≈ 110 ms)', () => {
    const m = mos(110, 0);
    expect(m).toBeGreaterThan(4.3);
    expect(m).toBeLessThan(4.41);
  });
  it('loss lowers MOS', () => {
    expect(mos(100, 5)).toBeLessThan(mos(100, 1));
  });
});

describe('propagation sanity', () => {
  it('Wi-Fi path gain falls monotonically with distance in free space', () => {
    const ws = wallSet({ survey: false });
    const tx = { pos: [500, 500, 3] as [number, number, number], band: '5' };
    let prev = Infinity;
    for (const d of [2, 4, 8, 16, 32]) {
      const g = wifiPathGainDb(tx, [500 + d, 500], ws);
      expect(g).toBeLessThan(prev);
      prev = g;
    }
  });
  it('each wall subtracts its loss', () => {
    const ws = wallSet({ survey: false });
    const ap = txById('ap-office-2');
    // through the low-E façade (south) vs the same distance without walls
    const inside = wifiPathGainDb(ap, [-13, 1], ws);
    const outside = wifiPathGainDb(ap, [-13, -1], ws);
    const losses = PARAMS.wallLossDb.v as Record<string, number>;
    expect(inside - outside).toBeGreaterThan(losses.lowE_glass - 3);
  });
  it('38.901 UMa NLOS sanity: ≈ −85 dBm at 300 m, < −105 dBm around 1 km', () => {
    const rsrpAt = (d: number) => 17.8 + 18 - plUMa(d, 30, 1.5, 3.5);
    expect(rsrpAt(300)).toBeGreaterThan(-92);
    expect(rsrpAt(300)).toBeLessThan(-80);
    expect(rsrpAt(1000)).toBeLessThan(-105);
  });
  it('RMa NLOS is weaker than nothing at 3.5 km (desert edge is unusable)', () => {
    expect(17.8 + 18 - plRMa(3500, 35, 1.5, 3.5)).toBeLessThan(-105);
  });
  it('O2I high-loss (low-E glass + concrete) ≈ 27 dB at 3.5 GHz; low-loss ≈ 13 dB', () => {
    expect(o2iWallLossDb('high', 3.5)).toBeGreaterThan(25);
    expect(o2iWallLossDb('high', 3.5)).toBeLessThan(29);
    expect(o2iWallLossDb('low', 3.5)).toBeGreaterThan(11);
    expect(o2iWallLossDb('low', 3.5)).toBeLessThan(15);
  });
  it('5G inside the office is far weaker than outside the doors', () => {
    const tx = txById('cellA-mono');
    expect(cellRsrpDet(tx, [-12, 10]).rsrpDbm).toBeLessThan(cellRsrpDet(tx, [6, 10]).rsrpDbm - 20);
  });
  it('shadowing field has unit variance and spatial correlation', () => {
    const f = correlatedField(3, 'x', { nx: 200, ny: 200, res: 0.5, corrM: 4 });
    let m = 0, s = 0;
    for (const x of f) { m += x; s += x * x; }
    m /= f.length; s = s / f.length - m * m;
    expect(Math.abs(m)).toBeLessThan(0.3);
    expect(s).toBeGreaterThan(0.6);
    expect(s).toBeLessThan(1.4);
    // neighbours 0.5 m apart are strongly correlated
    let c = 0;
    for (let j = 0; j < 200; j++) for (let i = 0; i < 199; i++) c += f[j * 200 + i] * f[j * 200 + i + 1];
    expect(c / (200 * 199)).toBeGreaterThan(0.7);
  });
});

describe('policy sanity', () => {
  it('building exit: Infinet switches before the drop and never freezes; B1 freezes for seconds', () => {
    let infFrozen = 0, b1Frozen = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = createSim('building-exit', seed).runToEnd();
      infFrozen += r.find((x) => x.policy === 'infinet')!.frozenS;
      b1Frozen += r.find((x) => x.policy === 'b1')!.frozenS;
    }
    expect(infFrozen / 10).toBeLessThan(0.3);
    expect(b1Frozen / 10).toBeGreaterThan(2);
  });
  it('café: B2 joins the copy at the default power offset; Infinet blocks it', () => {
    const sim = createSim('cafe-twin', 1);
    const r = sim.runToEnd();
    expect(r.find((x) => x.policy === 'b2')!.fakeAdmissionFrames).toBeGreaterThan(0);
    expect(r.find((x) => x.policy === 'infinet')!.fakeAdmissionFrames).toBe(0);
    const ev = sim.eventsSince(0).events;
    expect(ev.some((e) => e.type === 'trust.blocked')).toBe(true);
  });
  it('desert: B3 falsely declares GEO dead (flaps); Infinet does not', () => {
    const r = createSim('desert-sat', 1).runToEnd();
    expect(r.find((x) => x.policy === 'b3')!.falseDead).toBeGreaterThan(2);
    expect(r.find((x) => x.policy === 'infinet')!.falseDead).toBe(0);
    expect(r.find((x) => x.policy === 'infinet')!.survived).toBe(true);
  });
  it('desert: Infinet learns the 15 s pattern', () => {
    const sim = createSim('desert-sat', 4);
    sim.runToEnd();
    const ev = sim.eventsSince(0).events.find((e) => e.type === 'sat.pattern') as any;
    expect(ev).toBeTruthy();
    expect(Math.abs(ev.periodS - 15)).toBeLessThan(0.5);
  });
});

describe('property test: the invariant (pitch line)', () => {
  it(`Infinet never sends user voice over an unchecked or Blocked network (${process.env.PROPERTY_RUNS ?? 300} randomized runs)`, () => {
    const N = Number(process.env.PROPERTY_RUNS ?? 300);
    const rng = new Rng(2026);
    let violations = 0, fake = 0;
    for (let i = 0; i < N; i++) {
      const sc = rng.next() < 0.6 ? 'cafe-twin' : 'building-exit';
      const sim = createSim(sc, 10_000 + i, {
        policies: ['infinet'],
        lab: {
          attackerMode: rng.next() < 0.5 ? 'intercept' : 'relay',
          attackerOffsetDb: rng.uniform(0, 25),
          deauth: rng.next() < 0.7,
          mapStaleness: rng.uniform(0, 1),
          walkSpeed: rng.uniform(1.0, 1.6),
        },
      });
      const r = sim.runToEnd()[0];
      violations += r.invariantViolations;
      fake += r.fakeAdmissionFrames;
    }
    expect(violations).toBe(0);
    expect(fake).toBe(0);
  });
});
