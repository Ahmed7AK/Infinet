/**
 * Feature 2: checks before it trusts (Security spec v1.0 §2, §4, §6).
 *   Appears → Screen (passive red flags, nothing sent) → Quarantine (probe identity + canaries, the call stays
 *   where it is) → Verdict → Roam (the real session moves, no new handshake).
 * Verdicts only route: every byte of user traffic stays in the encrypted tunnel on every network, Trusted
 * included. Trusted = may carry the tunnel · Tunnel only = may carry the tunnel, ahead of 5G only without a red flag
 * (Wi-Fi first) · Unreachable / Blocked = never.
 * Red flags never decide alone: any one caps a network at Tunnel only; two high, or one high and one medium,
 * give Blocked. Equality and red flags use the raw SSID bytes, never a display string (spec §6, I4).
 */
import { v } from '../params';
import type { CanaryState, Flag, HandshakeResult, ScanEntry, Security, Tier, TrustView, Vec2 } from '../types';
import { LAYOUT, type Transmitter } from '../world/layout';
import { mobileWord } from '../policies/agent';
import type { MapSet } from '../maps/rfmaps';

export const SEC_RANK: Record<Security, number> = {
  OPEN: 0, WEP: 1, 'WPA-TKIP': 1, OWE: 2, 'WPA2-PSK': 3, 'WPA2/3': 3, 'WPA2-ENT': 4, 'WPA3-SAE': 4, 'WPA3-ENT': 5,
};
export const SEC_LABEL: Record<Security, string> = {
  OPEN: 'no password', WEP: 'WEP', 'WPA-TKIP': 'WPA with TKIP', OWE: 'Enhanced Open', 'WPA2-PSK': 'WPA2', 'WPA2/3': 'WPA2/WPA3 transition',
  'WPA2-ENT': 'WPA2-Enterprise', 'WPA3-SAE': 'WPA3', 'WPA3-ENT': 'WPA3-Enterprise',
};
/** spec §4 "weak crypto": TKIP or WEP, or WPA2/WPA3 transition mode (downgradable) */
const WEAK = new Set<Security>(['WEP', 'WPA-TKIP', 'WPA2/3']);

/** Networks enrolled as Trusted on this device (organisation profile, installed by MDM). */
export const ENROLLED: Record<string, { ssid: string; security: Security }> = {
  'office-corp': { ssid: 'Office-Corp', security: 'WPA3-ENT' },
  'site-net': { ssid: 'Site-Net', security: 'WPA3-SAE' },
};
// … and any network the layout marks `enrolled` (a Passpoint profile from the operator: Downtown's promenade Wi-Fi)
for (const t of LAYOUT.transmitters) if (t.enrolled && !t.attacker && t.ssid && t.security) ENROLLED[t.net] = { ssid: t.ssid, security: t.security };

/** what the phone calls networks it knows by name (its own saved list, not the simulation's ids) */
const FRIENDLY: Record<string, { label: string; noun: string }> = {
  'Office-Corp': { label: 'Office Wi-Fi', noun: 'the office' },
  Cafe_Guest: { label: 'Café Wi-Fi', noun: 'the café' },
  'Site-Net': { label: 'Site Wi-Fi', noun: 'the site' },
  Park_Free_WiFi: { label: 'Park Wi-Fi', noun: 'the park' },
  Boulevard_WiFi: { label: 'Promenade Wi-Fi', noun: 'the promenade' },
  Metro_Free_WiFi: { label: 'Station Wi-Fi', noun: 'the station' },
  Spice_Shop: { label: 'Spice shop Wi-Fi', noun: 'the spice shop' },
  Textile_House: { label: 'Textile shop Wi-Fi', noun: 'the textile shop' },
  Souk_Guest: { label: 'Souk guest Wi-Fi', noun: 'the souk' },
  Souk_Free_WiFi: { label: 'Souk Wi-Fi', noun: 'the souk' },
};

// ───────────── raw names (spec §6: two forms of every name) ─────────────
export function utf8Hex(s: string): string {
  return [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}
/** The display form: decoded as strict UTF-8, control and invisible characters removed, capped at 32 characters.
 *  Hidden names show as "hidden", names that are not valid UTF-8 as hex. Always rendered as text, never HTML. */
export function displayName(ssidHex: string): string {
  if (!/^[0-9a-f]*$/i.test(ssidHex) || ssidHex.length > 64 || ssidHex.length % 2) return 'invalid name';
  const bytes = hexBytes(ssidHex);
  if (!bytes.length || bytes.every((b) => b === 0)) return 'hidden';
  let s: string;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return `hex ${ssidHex.slice(0, 24)}${ssidHex.length > 24 ? '…' : ''}`; }
  s = s.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '').trim();
  if (!s) return 'hidden';
  const chars = [...s];
  return chars.length > 32 ? `${chars.slice(0, 31).join('')}…` : s;
}

/**
 * Unicode TS #39 skeleton, for look-alike names: NFKC (folds full-width and compatibility forms), drop default-
 * ignorable characters, map confusables to their prototype, NFD. The table is the subset of confusables.txt that
 * covers Latin look-alikes from Cyrillic, Greek, digits, dashes and the "rn" → "m" ligature trick; the full table
 * would ship with the Go scanner.
 */
const CONFUSABLE: Record<string, string> = {
  // Cyrillic
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ӏ: 'l', һ: 'h', ԛ: 'q', ԝ: 'w', ү: 'y',
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', І: 'l', Ј: 'J', Ѕ: 'S',
  // Greek
  ο: 'o', α: 'a', ν: 'v', ρ: 'p', ι: 'i', κ: 'k', τ: 't', υ: 'u', Ο: 'O', Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'l', Κ: 'K', Μ: 'M', Ν: 'N', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
  // Latin and digits (confusables.txt prototypes)
  '0': 'O', '1': 'l', I: 'l', '|': 'l', ı: 'l', ɑ: 'a', ɡ: 'g',
  // dashes and low lines
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '−': '-',
};
export function skeleton(s: string): string {
  let x = s.normalize('NFKC').replace(/[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯︀-️﻿]/g, '');
  x = [...x].map((c) => CONFUSABLE[c] ?? c).join('');
  x = x.replace(/rn/g, 'm').replace(/vv/g, 'w');
  return x.normalize('NFD');
}

// ───────────── what the phone knows ─────────────
/** Access points Infinet's coverage map knows about (the survey's learned BSSID sets): never the attacker. */
export function knownApsFor(ssidHex: string, near: Vec2, radiusM = 150): Transmitter[] {
  return LAYOUT.transmitters.filter((t) => t.kind === 'wifi' && !t.attacker && t.ssid !== undefined && utf8Hex(t.ssid) === ssidHex &&
    Math.hypot(t.pos[0] - near[0], t.pos[1] - near[1]) < radiusM);
}
/** names the phone knows: its map, its enrolled profile, and (live) the team's own pinned demo hotspots */
export function knownNames(extra: string[] = []): string[] {
  const s = new Set<string>(extra);
  for (const t of LAYOUT.transmitters) if (t.kind === 'wifi' && !t.attacker && t.ssid) s.add(t.ssid);
  for (const p of Object.values(ENROLLED)) s.add(p.ssid);
  return [...s];
}

export function isEnrolled(net: string, e: ScanEntry): boolean {
  const p = ENROLLED[net];
  if (!p || utf8Hex(p.ssid) !== e.ssidHex || p.security !== e.security) return false;
  return knownApsFor(e.ssidHex, [0, 0], 1e9).some((k) => k.bssid === e.bssid);
}

export function friendly(ssid: string): string { return FRIENDLY[ssid]?.label ?? ssid; }

// ───────────── screen: passive red flags (nothing sent) ─────────────
export interface ScreenMemory {
  /** live scan: networks the phone has checked before, by raw name: their learned BSSID set and security */
  learned?: Map<string, { bssids: Set<string>; security: Security; name: string }>;
}

export function redFlags(e: ScanEntry, pos: Vec2, maps: MapSet | null, mem: ScreenMemory = {}): Flag[] {
  const flags: Flag[] = [];
  const known = knownApsFor(e.ssidHex, pos);
  const name = displayName(e.ssidHex);
  const learned = mem.learned?.get(e.ssidHex);
  const isKnownDevice = known.some((k) => k.bssid === e.bssid) || !!learned?.bssids.has(e.bssid);
  // 1 · same name, new device (medium): meshes and hotels use many BSSIDs, and BSSIDs are easy to copy
  if ((known.length > 0 || learned) && !isKnownDevice) {
    flags.push({ id: 'new-device', weight: 'medium', text: 'Same name, new device', detail: `"${name}" is known here from another access point` });
  }
  // 2 · security downgrade (high): weaker than remembered, e.g. open where WPA2 was
  // what this name is remembered with: the strongest of the map's APs, the enrolled profile and the learned network
  const enr = Object.values(ENROLLED).find((p) => utf8Hex(p.ssid) === e.ssidHex);
  const rememberedAs: Security[] = [...known.map((k) => k.security!), ...(enr ? [enr.security] : []), ...(learned ? [learned.security] : [])];
  const was = rememberedAs.sort((a, b) => SEC_RANK[b] - SEC_RANK[a])[0];
  if (was !== undefined && SEC_RANK[e.security] < SEC_RANK[was]) {
    flags.push({ id: 'downgrade', weight: 'high', text: e.security === 'OPEN' ? `Security downgrade: no password (was ${SEC_LABEL[was]})` : `Security downgrade: ${SEC_LABEL[e.security]} (was ${SEC_LABEL[was]})` });
  }
  // 3 · weak crypto (medium): TKIP, WEP, or transition mode
  if (WEAK.has(e.security)) flags.push({ id: 'weak-crypto', weight: 'medium', text: `Weak crypto (${SEC_LABEL[e.security]})` });
  // 4 · too strong here (medium): stronger than the map's error allows for this name at this spot
  if (known.length > 0 && maps) {
    let predicted = -Infinity;
    for (const k of known) {
      const m = maps.byTx.get(k.id);
      if (m?.belief?.contains(pos)) predicted = Math.max(predicted, m.belief.sample(pos) + (k.eirpDbm ?? 20));
    }
    const excess = e.rssiDbm - predicted;
    if (predicted > -150 && excess > v('anomalyDb')) {
      flags.push({ id: 'too-strong', weight: 'medium', text: 'Too strong here', detail: `${fmtDbm(e.rssiDbm)} where our map says ${fmtDbm(predicted)} (+${Math.round(excess)} dB)` });
    }
  }
  // 5 · look-alike name (high): TS #39 skeleton matches a known network, raw bytes differ
  if (known.length === 0 && !learned) {
    let raw = '';
    try { raw = new TextDecoder('utf-8', { fatal: true }).decode(hexBytes(e.ssidHex)); } catch { raw = ''; }
    if (raw) {
      const sk = skeleton(raw);
      const twin = knownNames([...(mem.learned?.values() ?? [])].map((l) => l.name)).find((k) => utf8Hex(k) !== e.ssidHex && skeleton(k) === sk);
      if (twin) flags.push({ id: 'look-alike', weight: 'high', text: `Look-alike of "${twin}"`, detail: 'Same letters to the eye, different bytes (Unicode TS #39)' });
    }
  }
  return flags;
}

export function fmtDbm(x: number): string {
  return `${x < 0 ? '−' : ''}${Math.abs(Math.round(x))} dBm`;
}

/** spec §4 rule: any single flag caps at Tunnel only; two high, or one high and one medium, give Blocked */
export function screen(flags: Flag[]): 'clear' | 'cap' | 'block' {
  const hi = flags.filter((f) => f.weight === 'high').length;
  if (hi >= 2 || (hi >= 1 && flags.length >= 2)) return 'block';
  return flags.length ? 'cap' : 'clear';
}

/** The verdict (spec §2 amended table). */
export function decideTier(a: { known: boolean; flags: Flag[]; handshake: HandshakeResult; authFailed: number; tls: CanaryState; flood: boolean }): Tier {
  if (screen(a.flags) === 'block') return 'blocked';
  if (a.authFailed >= v('authFailPackets')) return 'blocked';  // evidence of tampering
  if (a.tls === 'bad') return 'blocked';                       // TLS interception or SSL stripping
  if (a.handshake === 'timeout') return 'unreachable';         // silence is not evidence: retry later
  if (a.handshake === 'portal' || a.handshake === 'pending') return 'checking';
  if (a.flood) return 'checking';                              // a beacon flood freezes trust upgrades
  return a.known && a.flags.length === 0 ? 'trusted' : 'tunnel';
}

/** "may carry", spec §2 table */
export const MAY_CARRY: Record<Tier, string> = {
  checking: 'Nothing yet',
  trusted: 'Primary path for our tunnel',
  tunnel: 'Only our encrypted tunnel',
  unreachable: 'Nothing; we retry shortly',
  blocked: 'Nothing',
  unchecked: 'Nothing',
};

const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`);

function flagPhrase(f: Flag, e?: { security?: Security }): string {
  switch (f.id) {
    case 'new-device': return 'a different device';
    case 'downgrade': return e?.security === 'OPEN' ? 'no password' : 'weaker security than before';
    case 'weak-crypto': return 'old, breakable security';
    case 'too-strong': return 'far stronger than our map says';
    case 'look-alike': return f.text.replace(/^Look-alike of /, 'a look-alike of ');
    case 'dns': return 'DNS answers that differ from ours';
  }
}

/** What the screen says (spec §2 table, "What the screen says"). */
export function verdictText(tv: TrustView, stayingOn = mobileWord()): { reason: string; mayCarry: string } {
  const name = tv.ssid;
  const mayCarry = MAY_CARRY[tv.tier];
  switch (tv.tier) {
    case 'blocked': {
      const sameName = tv.flags.some((f) => f.id === 'new-device' || f.id === 'downgrade' || f.id === 'too-strong');
      const parts = tv.flags.map((f) => flagPhrase(f, tv));
      if ((tv.authFailed ?? 0) > 0) parts.push(`${tv.authFailed === 1 ? 'a check packet' : `${tv.authFailed} check packets`} failed authentication`);
      if (tv.canaries?.tls === 'bad') parts.push("its TLS certificate didn't match our anchor's");
      const lead = sameName ? [`same name as ${FRIENDLY[name]?.noun ?? 'a network we know'}`] : [];
      return { reason: `Blocked ${name}: ${listJoin([...lead, ...parts])}.`, mayCarry };
    }
    case 'tunnel': {
      if (tv.flags.length) return { reason: `${friendly(name)}: ${listJoin(tv.flags.map((f) => flagPhrase(f, tv)))}. Only our encrypted tunnel goes through it, and only as a backup to ${mobileWord()}.`, mayCarry };
      return { reason: `${friendly(name)} is new to us. Only our encrypted tunnel goes through it; Wi-Fi first, ${mobileWord()} stays ready.`, mayCarry };
    }
    case 'trusted':
      return { reason: `${friendly(name)}, as expected. Handshake passed.`, mayCarry };
    case 'unreachable':
      return { reason: `${friendly(name)} isn't answering our check yet. Staying on ${stayingOn}.`, mayCarry };
    case 'checking':
      if (tv.handshake === 'portal') return { reason: `${friendly(name)} shows a sign-in page. Sign in from the sandboxed page; nothing else leaves the tunnel.`, mayCarry: 'Only the sign-in page, in a sandbox' };
      return { reason: `Checking ${name}.`, mayCarry };
    default:
      return { reason: '', mayCarry };
  }
}
