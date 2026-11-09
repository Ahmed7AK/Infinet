import { describe, expect, it } from 'vitest';
import { createSim, PARAMS, type Sim } from '../src/engine/index';
import type { PolicyId, Vec2 } from '../src/engine/types';

// Lab attacks: two DDoS (beacon flood, uplink flood) and a fake Wi-Fi in the desert. Each test runs the same
// walk and signal for Infinet and a "Today's phone" baseline, and checks what each one does.
const SEEDS = [1, 2, 3];

function office(seed: number, base: PolicyId) {
  const sim = createSim('building-exit', seed, { mode: 'live', policies: [base, 'infinet'] });
  const p0 = sim.snapshot().player.pos;
  const stay = (s: number, each?: (sim: Sim) => void) => {
    for (let i = 0; i < s * 10; i++) { sim.advance(0.1, { pos: p0, vel: [0, 0], headingDeg: 0 }); each?.(sim); }
  };
  return { sim, stay };
}
const events = (sim: Sim) => sim.eventsSince(0).events;

describe('DDoS 1 · beacon flood (dozens of fake names, copies of the office Wi-Fi)', () => {
  for (const seed of SEEDS) {
    it(`Infinet raises the alert and keeps its checked Wi-Fi; "Strongest signal" hops to the fakes (seed ${seed})`, () => {
      const { sim, stay } = office(seed, 'b2');
      stay(5);
      sim.setLab({ beaconFlood: true });
      let infinetOnFake = false, b2OnFake = false;
      stay(20, (s) => {
        const p = s.snapshot().policies;
        if (p.infinet.wifiAssoc === 'flood') infinetOnFake = true;
        if (p.b2.wifiAssoc === 'flood') b2OnFake = true;
      });
      const s = sim.snapshot();
      expect(s.infinet.flood).toBe(true);
      expect(events(sim).some((e) => e.type === 'flood.on')).toBe(true);
      expect(infinetOnFake).toBe(false);
      expect(s.policies.infinet.wifiAssoc).toBe('office-corp');
      expect(s.policies.infinet.metrics.frozenS).toBeLessThan(0.5);
      // no fake name was ever upgraded (spec §6: the flood freezes trust upgrades)
      for (const tv of Object.values(s.infinet.trust)) if (tv.net === 'flood') expect(['trusted', 'tunnel']).not.toContain(tv.tier);
      expect(b2OnFake).toBe(true);                          // the loudest "Office-Corp" was a fake
      expect(s.policies.b2.metrics.frozenS).toBeGreaterThan(s.policies.infinet.metrics.frozenS);
      // switched off: the alert clears once no new names arrive
      sim.setLab({ beaconFlood: false });
      stay(8);
      expect(sim.snapshot().infinet.flood).toBe(false);
    });
  }
});

describe('DDoS 2 · uplink flood (strong signal, packets lost and late)', () => {
  // indoors the 5G is marginal on some seeds: judge the move only where 5G is usable at the spot
  // 5G margin over Infinet's own "usable" thresholds (dB): clearly good > +3, clearly unusable < 0, borderline skipped
  const margin5g = (sim: Sim) => {
    const c = sim.snapshot().links.find((l) => l.id === 'cell:cell-a');
    return c ? Math.min((c.rsrpDbm ?? -200) - PARAMS.nrUsableRsrpDbm.v, (c.sinrDb ?? -99) - PARAMS.nrUsableSinrDb.v) : -99;
  };
  const withGood5g: number[] = [], without5g: number[] = [];
  for (let seed = 1; seed <= 16; seed++) {
    const { sim, stay } = office(seed, 'b1');
    stay(5);
    const m = margin5g(sim);
    if (m > 3) withGood5g.push(seed); else if (m < 0) without5g.push(seed);
  }

  it('the seed sweep has both cases', () => {
    expect(withGood5g.length).toBeGreaterThanOrEqual(3);
    expect(without5g.length).toBeGreaterThanOrEqual(1);
  });

  for (const seed of withGood5g.slice(0, 4)) {
    it(`with 5G: Infinet moves the call there, doesn't bounce back while it lasts, and returns after (seed ${seed})`, () => {
      const { sim, stay } = office(seed, 'b1');
      stay(5);
      sim.setLab({ uplinkFlood: true });
      const t0 = sim.t;
      stay(3);
      expect(sim.snapshot().policies.infinet.activePath).toBe('cell:cell-a');
      stay(12);
      const s = sim.snapshot();
      const switchesDuring = events(sim).filter((e) => e.type === 'switch' && e.policy === 'infinet' && e.t >= t0).length;
      expect(switchesDuring).toBeLessThanOrEqual(2);         // no ping-pong back to the flooded Wi-Fi
      expect(events(sim).some((e) => e.type === 'path.congested')).toBe(true);
      expect(s.policies.b1.activePath).toBe('wifi:office-corp'); // full bars: Today's phone stays
      expect(s.policies.b1.metrics.voiceLostPct).toBeGreaterThan(15);
      expect(s.policies.infinet.metrics.voiceLostPct).toBeLessThan(s.policies.b1.metrics.voiceLostPct / 2);
      sim.setLab({ uplinkFlood: false });
      stay(10);
      expect(sim.snapshot().policies.infinet.activePath).toBe('wifi:office-corp');
    });
  }

  it('with no usable 5G: Infinet stays on the Wi-Fi (degraded beats nothing) and never drops the call', () => {
    const { sim, stay } = office(without5g[0], 'b1');
    stay(5);
    sim.setLab({ uplinkFlood: true });
    stay(15);
    const s = sim.snapshot();
    expect(s.policies.infinet.activePath).toBe('wifi:office-corp');
    expect(s.policies.infinet.metrics.callDropped).toBe(false);
  });
});

describe('Fake Wi-Fi · a fake "Site-Net" in the desert, while you are out of range', () => {
  for (const seed of SEEDS) {
    it(`Infinet blocks it and never joins it, even with nothing else; "Tunnel, no check" joins it (seed ${seed})`, () => {
      const sim = createSim('desert-sat', seed, { prewarm: true, mode: 'live', policies: ['b3', 'infinet'], lab: { siteTwin: true } });
      let infOnCopy = false, b3OnCopy = false;
      const go = (x: number) => {
        sim.advance(0.1, { pos: [x, -8] as Vec2, vel: [0, 0], headingDeg: 90, zone: 'desert' });
        const s = sim.snapshot();
        if (s.policies.infinet.wifiAssoc === 'site-twin') infOnCopy = true;
        if (s.policies.b3.wifiAssoc === 'site-twin') b3OnCopy = true;
      };
      let x = 12004;
      for (let i = 0; i < 30; i++) go(x);
      while (x < 12070) { x += 0.14; go(x); }
      for (let i = 0; i < 100; i++) go(x);
      while (x > 12004) { x -= 0.14; go(x); }
      for (let i = 0; i < 100; i++) go(x);
      const s = sim.snapshot();
      expect(infOnCopy).toBe(false);
      expect(b3OnCopy).toBe(true);
      const copy = Object.values(s.infinet.trust).find((t) => t.net === 'site-twin');
      expect(copy?.tier).toBe('blocked');
      expect(s.policies.infinet.metrics.fakeAdmissions).toBe(0);
      expect(s.policies.infinet.wifiAssoc).toBe('site-net');  // back on the real one
    });
  }
});
