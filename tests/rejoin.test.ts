import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../src/engine/index';
import type { Vec2 } from '../src/engine/types';

// Desert site: the only network is Site-Net and there is no usable 5G. Walking out of Wi-Fi range drops every
// phone; walking back in, Infinet must rejoin Site-Net (a network it already trusts) just like Today's phone does.
function walk(sim: Sim, from: Vec2, to: Vec2, speed = 1.4) {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const vel: Vec2 = [((to[0] - from[0]) / d) * speed, ((to[1] - from[1]) / d) * speed];
  const heading = (Math.atan2(vel[0], vel[1]) * 180) / Math.PI;
  const steps = Math.ceil(d / speed / 0.1);
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    sim.advance(0.1, { pos: [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k], vel, headingDeg: heading, zone: 'desert' });
  }
}
function stay(sim: Sim, pos: Vec2, s: number) {
  for (let i = 0; i < s / 0.1; i++) sim.advance(0.1, { pos, vel: [0, 0], headingDeg: 0, zone: 'desert' });
}

describe('desert site: leaving Wi-Fi and coming back', () => {
  for (const seed of [1, 2, 3]) {
    it(`Infinet rejoins Site-Net and the call resumes (seed ${seed})`, () => {
      const sim = createSim('desert-sat', seed, { prewarm: true, mode: 'live', policies: ['b3', 'infinet'] });
      const home: Vec2 = [12004, -8], away: Vec2 = [12070, -8];
      stay(sim, home, 3);
      walk(sim, home, away);
      stay(sim, away, 5);
      const out = sim.snapshot().policies.infinet;
      expect(out.wifiAssoc).toBeNull();                 // out of range: nothing to hold on to
      walk(sim, away, home);
      stay(sim, home, 10);
      const s = sim.snapshot();
      expect(s.policies.b3.wifiAssoc).toBe('site-net'); // Today's phone is back
      expect(s.policies.infinet.wifiAssoc).toBe('site-net');
      expect(s.policies.infinet.joinPhase).toBe('up');
      expect(s.policies.infinet.activePath).toBe('wifi:site-net');
      expect(s.policies.infinet.frozen).toBe(false);
      expect(['live', 'handover']).toContain(s.policies.infinet.callState);
    });
  }

  it('with no other link, Infinet is back about as soon as Today\'s phone (no voice-grade wait)', () => {
    let infFirst = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const sim = createSim('desert-sat', seed, { prewarm: true, mode: 'live', policies: ['b3', 'infinet'] });
      const home: Vec2 = [12004, -8], away: Vec2 = [12070, -8];
      stay(sim, home, 3);
      walk(sim, home, away);
      stay(sim, away, 5);
      const t0 = sim.t;
      const liveAt: Record<string, number> = {};
      const d = away[0] - home[0], steps = Math.ceil(d / 1.4 / 0.1);
      for (let i = 1; i <= steps + 100; i++) {
        const x = i <= steps ? away[0] - (d * i) / steps : home[0];
        sim.advance(0.1, { pos: [x, -8], vel: [-1.4, 0], headingDeg: -90, zone: 'desert' });
        const s = sim.snapshot();
        for (const id of ['b3', 'infinet']) {
          const p = s.policies[id];
          if (liveAt[id] === undefined && p.joinPhase === 'up' && !p.frozen) liveAt[id] = sim.t - t0;
        }
      }
      expect(liveAt.infinet, `seed ${seed}`).toBeLessThan(liveAt.b3 + 1.5); // join timing (DHCP) is random for both
      if (liveAt.infinet <= liveAt.b3) infFirst++;
    }
    expect(infFirst).toBeGreaterThanOrEqual(5); // its join is shorter (no OS portal check), so it usually wins
  });
});
