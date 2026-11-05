/** Security spec v1.0: verdicts, red flags, hostile names, anchor down, live scan (§2, §4, §5, §6). */
import { describe, expect, it } from 'vitest';
import { createSim, displayName, screen, skeleton, utf8Hex, type Flag, type LiveEntry } from '../src/engine/index';
import { redFlags } from '../src/engine/trust/trust';
import { Rng } from '../src/engine/rng';
import { cleanBatch, cleanEntry } from '../src/app/liveProtocol';

const F = (weight: 'high' | 'medium'): Flag => ({ id: weight === 'high' ? 'downgrade' : 'new-device', weight, text: '' });

describe('the red-flag rule (spec §4)', () => {
  it('no flag decides alone; two high, or one high and one medium, block', () => {
    expect(screen([])).toBe('clear');
    expect(screen([F('medium')])).toBe('cap');
    expect(screen([F('high')])).toBe('cap');
    expect(screen([F('medium'), F('medium')])).toBe('cap');
    expect(screen([F('high'), F('medium')])).toBe('block');
    expect(screen([F('high'), F('high')])).toBe('block');
  });
});

describe('hostile names (spec §6, I4)', () => {
  it('display names drop control characters, never merge raw bytes, and show hidden or hex names plainly', () => {
    expect(displayName(utf8Hex('Cafe\u0007​_Guest'))).toBe('Cafe_Guest');
    expect(displayName(utf8Hex('<svg onload=alert(1)>'))).toBe('<svg onload=alert(1)>'); // text, rendered with textContent
    expect(displayName('')).toBe('hidden');
    expect(displayName('ff fe'.replace(' ', ''))).toMatch(/^hex /);
    expect(utf8Hex('Cafe<')).not.toBe(utf8Hex('Cafe'));
  });
  it('TS #39 skeletons catch Cyrillic look-alikes; raw bytes still differ', () => {
    const real = 'Infinet-Demo-Cafe', fake = 'Infinet-Demo-Cаfe';
    expect(skeleton(fake)).toBe(skeleton(real));
    expect(utf8Hex(fake)).not.toBe(utf8Hex(real));
    const e = { bssid: 'aa', ssid: fake, ssidHex: utf8Hex(fake), net: 'live:aa', security: 'WPA2-PSK' as const, pmf: 'none' as const, channel: 6, band: '2.4' as const, rssiDbm: -50 };
    const learned = new Map([[utf8Hex(real), { bssids: new Set(['bb']), security: 'WPA2-PSK' as const, name: real }]]);
    expect(redFlags(e, [0, 0], null, { learned }).map((f) => f.id)).toEqual(['look-alike']);
    // a network the map knows, with a Unicode hyphen and a Cyrillic і
    expect(redFlags({ ...e, ssidHex: utf8Hex('Site\u2010Net') }, [0, 0], null).map((f) => f.id)).toEqual(['look-alike']);
    expect(redFlags({ ...e, ssidHex: utf8Hex('Off\u0456ce-Corp') }, [0, 0], null).map((f) => f.id)).toEqual(['look-alike']);
    expect(redFlags({ ...e, ssidHex: utf8Hex('Off1ce-Corp') }, [0, 0], null)).toEqual([]); // TS #39: '1' is confusable with 'l', not 'i'
  });
});

describe('the café (spec §2, §4)', () => {
  it('the open copy is blocked by its red flags before anything is sent, with the spec\'s sentence', () => {
    const sim = createSim('cafe-twin', 21);
    sim.runToEnd();
    const b = sim.eventsSince(0).events.find((e) => e.type === 'trust.blocked') as any;
    expect(b.reason).toBe('Blocked Cafe_Guest: same name as the café, a different device, no password, and far stronger than our map says.');
    expect(b.handshake).toBeUndefined();
    expect(b.verdictMs).toBeLessThanOrEqual(200);
    expect(b.reason).not.toMatch(/handshake failed/);
  });
  it('a perfect copy (password and BSSID copied, relaying) passes the screen, and is counted: it only ever sees ciphertext', () => {
    const sim = createSim('cafe-twin', 21, { lab: { attackVariant: 'perfect', attackerMode: 'relay' } });
    const inf = sim.runToEnd().find((r) => r.policy === 'infinet')!;
    expect(inf.fakeAccepted).toBe(1);
    expect(inf.fakePlainFrames).toBe(0);
    expect(inf.invariantViolations).toBe(0);
  });
  it('the downgrade (the café reappears with no password): one high flag caps at Tunnel only; the probe decides', () => {
    const relay = createSim('cafe-twin', 21, { lab: { attackVariant: 'downgrade', attackerMode: 'relay', attackerOffsetDb: 0 } });
    relay.runToEnd();
    const last = (sim: typeof relay) => sim.eventsSince(0).events.filter((e) => e.type === 'trust.blocked' || e.type === 'trust.tunnel').pop() as any;
    expect(last(relay).type).toBe('trust.tunnel');
    expect(last(relay).flags.map((f: Flag) => f.id)).toEqual(['downgrade']);
    const tamper = createSim('cafe-twin', 21, { lab: { attackVariant: 'downgrade', attackerMode: 'intercept', attackerOffsetDb: 0 } });
    tamper.runToEnd();
    expect(last(tamper).type).toBe('trust.blocked');
    expect(last(tamper).handshake).toBe('authfail');
  });
  it('a café that blocks UDP is Unreachable, not Blocked: caution never counts as an attack', () => {
    const sim = createSim('cafe-twin', 21, { lab: { cafeBlocksUdp: true } });
    const inf = sim.runToEnd().find((r) => r.policy === 'infinet')!;
    expect(inf.wronglyBlocked).toBe(0);
    expect(inf.realUnreachable).toBe(1);
    const u = sim.eventsSince(0).events.find((e) => e.type === 'trust.unreachable') as any;
    expect(u.reason).toBe("Café Wi-Fi isn't answering our check yet. Staying on 5G.");
  });
});

describe('the copy\'s deauths (WPA2 without PMF)', () => {
  it('when a deauth drops the café, Infinet moves to its warm 5G tunnel at once, even a weak one', () => {
    // seed 7: Infinet is on the café when the attack starts, and 5G indoors is below the usable bar
    const sim = createSim('cafe-twin', 7, { prewarm: true });
    let kickedAt: number | null = null, onCafe = false, prev: string | null = null;
    while (sim.t < 30) {
      sim.advance(0.05);
      const pv = sim.snapshot().policies.infinet;
      if (kickedAt === null && prev === 'cafe-guest' && !pv.wifiAssoc && sim.t > 21.6) { kickedAt = sim.t; onCafe = true; }
      prev = pv.wifiAssoc;
      if (kickedAt !== null && pv.activePath?.startsWith('cell:')) break;
    }
    expect(onCafe).toBe(true);
    expect(sim.t - kickedAt!).toBeLessThan(0.5);
  });
});

describe('anchor down: fail closed (spec §5, D2)', () => {
  it('nothing is sent outside the tunnel; the phone notices; the call resumes when the anchor answers', () => {
    const sim = createSim('building-exit', 26);
    sim.advance(1); for (let i = 0; i < 40; i++) sim.advance(0.05);
    sim.setLab({ anchorDown: true });
    for (let i = 0; i < 60; i++) sim.advance(0.05);
    const s = sim.snapshot();
    expect(s.infinet.anchorLost).toBe(true);
    expect(s.policies.infinet.callState).toBe('frozen');
    expect(s.packets.filter((p) => p.policy === 'infinet' && p.t0 > s.t - 1).length).toBe(0);
    sim.setLab({ anchorDown: false });
    for (let i = 0; i < 120; i++) sim.advance(0.05);
    const e = sim.snapshot();
    expect(e.infinet.anchorLost).toBe(false);
    expect(e.policies.infinet.callState).toBe('live');
  });
});

describe('live hotspot scanner input (spec §6)', () => {
  const demo = (bssid: string, security: LiveEntry['security'], name = 'Infinet-Demo-Cafe'): LiveEntry =>
    ({ bssid, ssidHex: utf8Hex(name), ssid: name, security, channel: 6, band: '2.4', rssiDbm: -48, anon: false });
  it('places new networks beside the walker, keeps bystanders anonymous, and flags a copied hotspot', () => {
    const sim = createSim('cafe-twin', 21);
    sim.advance(1);
    sim.setLiveScan([demo('02:00:00:00:00:01', 'WPA2-PSK'), { bssid: 'h:1a2b', ssidHex: '', ssid: '', security: 'WPA2-PSK', channel: 11, band: '2.4', rssiDbm: -70, anon: true }]);
    for (let i = 0; i < 60; i++) sim.advance(0.05);
    let s = sim.snapshot();
    const p = s.player.pos;
    const live = s.scan.filter((e) => e.live);
    expect(live.length).toBe(2);
    for (const e of live) expect(Math.hypot(e.pos![0] - p[0], e.pos![1] - p[1])).toBeLessThan(12);
    expect(s.infinet.trust['h:1a2b']).toBeUndefined();          // a dot: never checked, no name kept
    expect(s.infinet.trust['02:00:00:00:00:01'].tier).toBe('tunnel'); // new to us: only our tunnel
    // the booth moment: same raw name, new BSSID, WPA2 downgraded to open
    sim.setLiveScan([demo('02:00:00:00:00:01', 'WPA2-PSK'), demo('02:00:00:00:00:02', 'OPEN')]);
    for (let i = 0; i < 4; i++) sim.advance(0.05);
    s = sim.snapshot();
    const copy = s.infinet.trust['02:00:00:00:00:02'];
    expect(copy.tier).toBe('blocked');
    expect(copy.flags.map((f) => f.id).sort()).toEqual(['downgrade', 'new-device']);
  });
  it('a phone hotspot in WPA2/3 transition mode is learned on first sight; its open copy is then blocked', () => {
    const sim = createSim('cafe-twin', 21);
    sim.advance(1);
    sim.setLiveScan([demo('02:00:00:00:00:01', 'WPA2/3', 'Infinet-Demo-Hotspot')]);
    for (let i = 0; i < 60; i++) sim.advance(0.05);
    const real = sim.snapshot().infinet.trust['02:00:00:00:00:01'];
    expect(real.flags.map((f) => f.id)).toEqual(['weak-crypto']); // transition mode can be downgraded: medium
    expect(real.tier).toBe('tunnel');
    sim.setLiveScan([demo('02:00:00:00:00:01', 'WPA2/3', 'Infinet-Demo-Hotspot'), demo('02:00:00:00:00:66', 'OPEN', 'Infinet-Demo-Hotspot')]);
    for (let i = 0; i < 4; i++) sim.advance(0.05);
    const copy = sim.snapshot().infinet.trust['02:00:00:00:00:66'];
    expect(copy.tier).toBe('blocked');
    expect(copy.flags.map((f) => f.id).sort()).toEqual(['downgrade', 'new-device']);
    expect(copy.flags.find((f) => f.id === 'downgrade')!.text).toBe('Security downgrade: no password (was WPA2/WPA3 transition)');
  });
  it('the page anonymises any name that is not Infinet-Demo-…, whatever the scanner says, and drops malformed entries', () => {
    const hex = (t: string) => utf8Hex(t);
    const base = { bssid: 'aa:bb:cc:dd:ee:ff', security: 'WPA2-PSK', channel: 6, band: '2.4', rssiDbm: -50, anon: false };
    const home = cleanEntry({ ...base, ssidHex: hex("Someone's Home Wi-Fi") })!;
    expect(home.anon).toBe(true);
    expect(home.ssid).toBe('');
    expect(home.ssidHex).toBe('');
    expect(home.bssid).toMatch(/^anon-[0-9a-f]{12}$/); // the real BSSID is not kept
    const mine = cleanEntry({ ...base, ssidHex: hex('Infinet-Demo-Hotspot') })!;
    expect(mine.anon).toBe(false);
    expect(mine.ssid).toBe('Infinet-Demo-Hotspot');
    expect(cleanEntry({ ...base, ssidHex: hex('Infinet-Demo-Hotspot'), anon: true })!.anon).toBe(true); // the scanner's anon wins
    expect(cleanEntry({ ...base, ssidHex: 'zz' })).toBeNull();
    expect(cleanEntry({ ...base, bssid: '<img src=x>', ssidHex: '' })).toBeNull();
    expect(cleanEntry({ ...base, security: 'WPA9' })).toBeNull();
    expect(cleanEntry({ ...base, rssiDbm: 30 })).toBeNull();
    const many = { v: 1, type: 'scan', entries: Array.from({ length: 400 }, (_, i) => ({ ...base, bssid: `anon-${i.toString(16).padStart(12, '0')}`, ssidHex: '', anon: true })) };
    expect(cleanBatch(many)!.length).toBe(256);
    expect(cleanBatch({ v: 2, type: 'scan', entries: [] })).toBeNull();
  });
  it('a beacon flood raises the alert and freezes upgrades', () => {
    const sim = createSim('cafe-twin', 21);
    sim.advance(1);
    sim.setLiveScan([demo('02:00:00:00:00:01', 'WPA2-PSK')]);
    sim.advance(0.5);
    sim.setLiveScan([demo('02:00:00:00:00:01', 'WPA2-PSK'), ...Array.from({ length: 12 }, (_, i) => ({ ...demo(`h:${i}`, 'OPEN', ''), ssidHex: '', anon: true }))]);
    for (let i = 0; i < 4; i++) sim.advance(0.05);
    expect(sim.snapshot().infinet.flood).toBe(true);
  });
});

describe('property test: always-tunnel holds for every attack variant', () => {
  it('Infinet never sends plain traffic over a copy, and never carries the call over a Checking, Unreachable or Blocked network', () => {
    const rng = new Rng(77);
    for (let i = 0; i < 60; i++) {
      const variant = (['copy', 'perfect', 'downgrade'] as const)[i % 3];
      const sim = createSim('cafe-twin', 20_000 + i, {
        policies: ['infinet'],
        lab: { attackVariant: variant, attackerMode: rng.next() < 0.5 ? 'intercept' : 'relay', attackerOffsetDb: rng.uniform(0, 25), deauth: rng.next() < 0.7, cafeBlocksUdp: rng.next() < 0.3, mapStaleness: rng.uniform(0, 1) },
      });
      const r = sim.runToEnd()[0];
      expect(r.invariantViolations).toBe(0);
      expect(r.fakePlainFrames).toBe(0);
      if (variant === 'copy') expect(r.fakeAdmissionFrames).toBe(0);
    }
  });
});
