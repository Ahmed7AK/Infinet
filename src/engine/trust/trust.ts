/**
 * Feature 2: Checks before it trusts (plan §9.7).
 * Red flags raise suspicion; the handshake decides. Device IDs are easy to fake, so no flag decides alone
 * (except that several at once, score ≥ threshold, block).
 */
import { v } from '../params';
import type { Flag, HandshakeResult, ScanEntry, Security, Tier, TrustView, Vec2 } from '../types';
import { LAYOUT, type Transmitter } from '../world/layout';
import type { MapSet } from '../maps/rfmaps';

const SEC_RANK: Record<Security, number> = { OPEN: 0, OWE: 1, 'WPA2-PSK': 2, 'WPA3-SAE': 3, 'WPA3-ENT': 4 };
const SEC_LABEL: Record<Security, string> = { OPEN: 'no password', OWE: 'OWE', 'WPA2-PSK': 'WPA2', 'WPA3-SAE': 'WPA3', 'WPA3-ENT': 'WPA3-Enterprise' };

/** Networks enrolled as Trusted on this device (organisation profile). */
export const ENROLLED: Record<string, { ssid: string; security: Security }> = {
  'office-corp': { ssid: 'Office-Corp', security: 'WPA3-ENT' },
  'site-net': { ssid: 'Site-Net', security: 'WPA3-SAE' },
};

/** Access points Infinet's coverage map knows about (from the survey): everything except the attacker. */
export function knownApsFor(ssid: string, near: Vec2, radiusM = 150): Transmitter[] {
  return LAYOUT.transmitters.filter((t) => t.kind === 'wifi' && !t.attacker && t.ssid === ssid &&
    Math.hypot(t.pos[0] - near[0], t.pos[1] - near[1]) < radiusM);
}

export function isEnrolled(net: string, e: ScanEntry): boolean {
  const p = ENROLLED[net];
  if (!p || p.ssid !== e.ssid || p.security !== e.security) return false;
  return knownApsFor(e.ssid, [0, 0], 1e9).some((k) => k.bssid === e.bssid);
}

export function redFlags(e: ScanEntry, pos: Vec2, maps: MapSet, firstSeen: Map<string, number>, scan: ScanEntry[]): Flag[] {
  const flags: Flag[] = [];
  const known = knownApsFor(e.ssid, pos);
  const isKnownDevice = known.some((k) => k.bssid === e.bssid);
  if (known.length > 0 && !isKnownDevice) {
    flags.push({ id: 'unknown-device', score: v('flagUnknownDevice'), text: 'Same name, different device', detail: `"${e.ssid}" is known here from another transmitter` });
  }
  if (known.length > 0) {
    const expected = Math.max(...known.map((k) => SEC_RANK[k.security!]));
    const enrolled = Object.values(ENROLLED).find((p) => p.ssid === e.ssid);
    const exp = enrolled ? Math.max(expected, SEC_RANK[enrolled.security]) : expected;
    if (SEC_RANK[e.security] < exp) {
      const was = (Object.keys(SEC_RANK) as Security[]).find((s) => SEC_RANK[s] === exp)!;
      flags.push({ id: 'downgrade', score: v('flagDowngrade'), text: `Weaker security (${SEC_LABEL[e.security]}, was ${SEC_LABEL[was]})` });
    }
  }
  if (known.length > 0 && !isKnownDevice) {
    // what the coverage map predicts for this name at this spot
    let predicted = -Infinity;
    for (const k of known) {
      const m = maps.byTx.get(k.id);
      if (m?.belief) predicted = Math.max(predicted, m.belief.sample(pos) + (k.eirpDbm ?? 20));
    }
    const excess = e.rssiDbm - predicted;
    if (predicted > -150 && excess > v('anomalyDb')) {
      flags.push({ id: 'signal-anomaly', score: v('flagSignalAnomaly'), text: 'Stronger than our map says', detail: `${fmtDbm(e.rssiDbm)} where the map says ${fmtDbm(predicted)} (+${Math.round(excess)} dB)` });
    }
  }
  if (!isKnownDevice) {
    const mine = firstSeen.get(e.bssid) ?? Infinity;
    const older = scan.some((o) => o.ssid === e.ssid && (o.bssid !== e.bssid || o.security !== e.security) && (firstSeen.get(o.bssid) ?? Infinity) + 0.5 < mine);
    if (older) flags.push({ id: 'newcomer', score: v('flagNewcomer'), text: `Sudden second "${e.ssid}"` });
  }
  if (known.length > 0 && !isKnownDevice) {
    const sameCh = known.some((k) => k.channel === e.channel && k.band === e.band);
    if (!sameCh) flags.push({ id: 'channel', score: v('flagChannel'), text: 'Channel differs from the known access point' });
  }
  return flags;
}

export function fmtDbm(x: number): string {
  return `${x < 0 ? '−' : ''}${Math.abs(Math.round(x))} dBm`;
}

export function decideTier(args: { enrolled: boolean; open: boolean; score: number; handshake: HandshakeResult; threshold: number }): { tier: Tier; usable: boolean } {
  const { enrolled, open, score, handshake, threshold } = args;
  if (handshake === 'fail' || handshake === 'timeout') return { tier: 'blocked', usable: false };
  if (score >= threshold) return { tier: 'blocked', usable: false };
  if (handshake === 'portal') return { tier: 'pipe', usable: false };
  if (handshake !== 'pass') return { tier: 'checking', usable: false };
  if (enrolled && !open && score === 0) return { tier: 'trusted', usable: true };
  return { tier: 'pipe', usable: true };
}

export function verdictText(tv: TrustView): { reason: string; mayCarry: string } {
  const flagWords = tv.flags.map((f) => f.text.toLowerCase().replace(/^same name, /, ''));
  switch (tv.tier) {
    case 'blocked': {
      const hs = tv.handshake === 'fail' ? 'the handshake failed' : tv.handshake === 'timeout' ? 'the handshake timed out' : tv.handshake === 'pass' ? 'the handshake passed, but there were too many red flags' : '';
      const parts = [...flagWords, hs].filter(Boolean);
      return { reason: `Blocked ${tv.ssid}: ${parts.join(', ')}.`, mayCarry: 'Nothing' };
    }
    case 'pipe':
      if (tv.handshake === 'portal') return { reason: `${tv.ssid} is new to us and shows a login page. Not usable until it is accepted.`, mayCarry: 'Only our encrypted tunnel, once the login page is accepted' };
      return { reason: `${tv.ssid} is new to us. The handshake passed, so only our encrypted tunnel goes through it.`, mayCarry: 'Only our encrypted tunnel' };
    case 'trusted':
      return { reason: `${tv.ssid}, as expected. Handshake passed.`, mayCarry: 'Everything' };
    default:
      return { reason: `Checking ${tv.ssid}…`, mayCarry: 'Nothing yet' };
  }
}
