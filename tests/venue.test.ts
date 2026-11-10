import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSim, LAYOUT, registerVenue, SCENARIOS, VENUE, type VenueFile } from '../src/engine/index';

// The venue replica (scene 4) is built from the organisers' confidential plans, so its file lives in git-ignored
// venue-private/. These tests run only on a machine that has it (the booth laptop); elsewhere they are skipped.
const FILE = 'venue-private/hall/venue.json';
const have = existsSync(FILE);
if (have) registerVenue(JSON.parse(readFileSync(FILE, 'utf8')) as VenueFile);

describe.skipIf(!have)('venue hall (private venue file present)', () => {
  it('registers the hall: its zone, the fitted venue APs and the scenario', () => {
    expect(LAYOUT.zones.some((z) => z.id === 'hall')).toBe(true);
    expect(LAYOUT.transmitters.filter((t) => t.zone === 'hall' && t.kind === 'wifi').length).toBeGreaterThanOrEqual(10);
    expect((SCENARIOS as Record<string, unknown>)['venue-hall']).toBeDefined();
  });

  it('is deterministic for a seed', () => {
    expect(JSON.stringify(createSim('venue-hall', 5).runToEnd())).toBe(JSON.stringify(createSim('venue-hall', 5).runToEnd()));
  });

  it('Infinet never carries voice on an unchecked network and never joins a hotspot, a device or another venue SSID', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const sim = createSim('venue-hall', seed);
      const dur = sim.scenarioDef!.durationS;
      expect(dur).toBeGreaterThan(10);
      for (let t = 0; t < dur; t += 0.1) {
        sim.advance(0.1);
        const a = sim.snapshot().policies.infinet.wifiAssoc;
        expect(a === 'hotspot' || a === 'device' || a === 'venue-other').toBe(false);
      }
      const r = sim.results().find((x) => x.policy === 'infinet')!;
      expect(r.invariantViolations).toBe(0);
      expect(r.fakeAdmissionFrames).toBe(0);
      expect(r.frozenS).toBeLessThan(0.5);
    }
  });

  it('a busy hall: hotspots and devices are heard with their details but stay anonymous; the venue APs share one check', () => {
    const sim = createSim('venue-hall', 5);
    for (let i = 0; i < 300; i++) sim.advance(0.1);
    const s = sim.snapshot();
    expect(s.zone).toBe('hall');
    const hotspots = s.scan.filter((e) => e.net === 'hotspot'), devices = s.scan.filter((e) => e.net === 'device');
    expect(hotspots.length).toBeGreaterThanOrEqual(10);
    expect(devices.length).toBeGreaterThanOrEqual(4);
    for (const e of [...hotspots, ...devices]) {
      expect(e.anon && e.ssid === '' && e.ssidHex === '').toBe(true);              // never a name
      expect(e.kindHint).toBe(e.net);
      expect(e.std === undefined || [1, 4, 5, 6, 7, 8].includes(e.std)).toBe(true);
    }
    expect(s.scan.filter((e) => e.net === 'venue-other').every((e) => e.anon)).toBe(true);
    const trust = Object.values(s.infinet.trust);
    expect(trust.some((t) => t.net === 'hotspot' || t.net === 'device' || t.net === 'venue-other')).toBe(false);
    const venue = trust.filter((t) => t.net === 'venue-free');
    expect(venue.length).toBeGreaterThan(1);
    expect(venue.filter((t) => !t.follows).length).toBe(1);   // one lead check, the rest follow it
  });

  it('Wi-Fi first: once the user signs in to the venue Wi-Fi, Infinet checks it again and moves the call onto it', () => {
    for (let seed = 1; seed <= 3; seed++) {
      const sim = createSim('venue-hall', seed);
      for (let i = 0; i < 60; i++) sim.advance(0.1);
      let s = sim.snapshot();
      expect(s.policies.infinet.activePath?.startsWith('cell:')).toBe(true);    // a sign-in page: the call waits on 5G
      expect(Object.values(s.infinet.trust).some((t) => t.net === 'venue-free' && t.handshake === 'portal')).toBe(true);
      sim.setLab({ signedIn: ['venue-free'] });
      expect(sim.eventsSince(0).events.some((e) => e.type === 'portal.signin')).toBe(true);
      for (let i = 0; i < 100; i++) sim.advance(0.1);
      s = sim.snapshot();
      expect(s.policies.infinet.activePath).toBe('wifi:venue-free');
      const r = sim.results().find((x) => x.policy === 'infinet')!;
      expect(r.invariantViolations).toBe(0);
      expect(r.fakeAdmissionFrames).toBe(0);
    }
  });

  it('everyone else\'s networks are placed one by one from the survey, each on air part of the time', () => {
    const list = VENUE!.hotspots.list;
    expect(list.filter((h) => h.kind === 'hotspot').length).toBeGreaterThanOrEqual(40);
    expect(list.filter((h) => h.kind === 'device').length).toBeGreaterThanOrEqual(20);
    for (const h of list) expect(h.onAir! >= 0.1 && h.onAir! <= 1).toBe(true);
    // no false beacon-flood alarm from walking among them (spec §6: 8 new names within 5 s)
    for (let seed = 1; seed <= 4; seed++) {
      const sim = createSim('venue-hall', seed);
      sim.runToEnd();
      expect(sim.eventsSince(0).events.some((e) => e.type === 'flood.on')).toBe(false);
    }
  });

  it('the model reproduces our survey: strongest venue AP within 6 dB on average', () => {
    const sim = createSim('venue-hall', 1);
    const pts = VENUE!.survey.points;
    const err = pts.reduce((a, p) => a + Math.abs(sim.wifiCoverage(p.pos, 'truth').dbm - p.bestDbm), 0) / pts.length;
    expect(err).toBeLessThan(6);
  });
});
