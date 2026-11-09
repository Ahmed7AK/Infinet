/**
 * Infinet Scanner (Linux), the pure part: turn `nmcli` output into the page's scan entries (Security spec §6).
 * No I/O here, so the tests can run it on recorded lines.
 *
 * Every byte from the air is hostile: names are kept as raw hex (never decoded here except to test the
 * Infinet-Demo- prefix on bytes), every field is range-checked, bad records are dropped, and anything that is
 * not one of our demo hotspots is anonymised before it can leave this process: name dropped, BSSID replaced by
 * a salted HMAC. The page checks all of this again (src/app/liveProtocol.ts).
 */
import { createHmac } from 'node:crypto';

export const DEMO_PREFIX = 'Infinet-Demo-';
export const MAX_ENTRIES = 256;
/** the fields we ask nmcli for, in this order (SSID-HEX: the raw bytes, so no escaping or decoding issues) */
export const NMCLI_FIELDS = 'BSSID,SSID-HEX,CHAN,FREQ,SIGNAL,SECURITY';

export type Security = 'OPEN' | 'WEP' | 'WPA-TKIP' | 'OWE' | 'WPA2-PSK' | 'WPA2/3' | 'WPA2-ENT' | 'WPA3-SAE' | 'WPA3-ENT';

export interface Entry {
  bssid: string; ssidHex: string; security: Security; channel: number; band: '2.4' | '5' | '6'; rssiDbm: number; anon: boolean;
}

const MAC = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;
const DEMO_HEX = Buffer.from(DEMO_PREFIX, 'utf8').toString('hex');

/** split one `nmcli -t` line on unescaped colons (nmcli writes a literal ':' as '\:' and '\' as '\\') */
export function splitTerse(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) { cur += line[++i]; continue; }
    if (ch === ':') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** nmcli's SECURITY column (e.g. "WPA2 WPA3", "WPA2 802.1X", "" for open) → the simulation's names.
 *  Transition and mixed modes first, as the macOS scanner does: they also "support" the stronger one. */
export function securityOf(s: string): Security {
  const t = new Set(s.toUpperCase().split(/\s+/).filter(Boolean));
  const ent = t.has('802.1X');
  if (t.has('WPA3') && ent) return 'WPA3-ENT';
  if (t.has('WPA3') && t.has('WPA2')) return 'WPA2/3';
  if (t.has('WPA3')) return 'WPA3-SAE';
  if (t.has('WPA1') && t.has('WPA2')) return 'WPA-TKIP';
  if (t.has('WPA2') && ent) return 'WPA2-ENT';
  if (t.has('WPA2')) return 'WPA2-PSK';
  if (t.has('WPA1')) return 'WPA-TKIP';
  if (t.has('WEP') || ent) return 'WEP';            // 802.1X with no WPA is dynamic WEP
  if (t.has('OWE') || t.has('OWE-TM')) return 'OWE';
  return 'OPEN';
}

/** NetworkManager's signal % back to dBm. NM maps −100…−40 dBm linearly onto 0…100 %, so this is its inverse. */
export function signalToDbm(pct: number): number {
  const q = Math.max(0, Math.min(100, pct));
  return Math.round(-40 - ((100 - q) * 60) / 100);
}

export function bandOf(freqMhz: number): '2.4' | '5' | '6' | null {
  if (freqMhz >= 2400 && freqMhz < 2500) return '2.4';
  if (freqMhz >= 4900 && freqMhz < 5925) return '5';
  if (freqMhz >= 5925 && freqMhz <= 7125) return '6';
  return null;
}

/** anonymous ID for someone else's network: HMAC-SHA256 under a per-launch salt, 12 hex characters */
export function anonId(bssid: string, salt: Buffer): string {
  return `anon-${createHmac('sha256', salt).update(bssid.toLowerCase()).digest('hex').slice(0, 12)}`;
}

/** is this raw name one of ours? Compared on the bytes, so a look-alike letter never counts as the prefix */
export function isDemo(ssidHex: string): boolean {
  return ssidHex.length <= 64 && ssidHex.startsWith(DEMO_HEX);
}

/** one nmcli line → one entry, or null when anything is off */
export function parseLine(line: string, salt: Buffer): Entry | null {
  const f = splitTerse(line);
  if (f.length !== 6) return null;
  const [bssidRaw, ssidHexRaw, chanRaw, freqRaw, sigRaw, sec] = f;
  const bssid = bssidRaw.trim().toLowerCase();
  if (!MAC.test(bssid)) return null;
  const ssidHex = ssidHexRaw.trim().toLowerCase();
  if (!/^[0-9a-f]*$/.test(ssidHex) || ssidHex.length % 2 || ssidHex.length > 64) return null;
  const channel = Number(chanRaw);
  if (!Number.isInteger(channel) || channel < 1 || channel > 233) return null;
  const band = bandOf(parseInt(freqRaw, 10));
  if (!band) return null;
  const sig = Number(sigRaw);
  if (!Number.isFinite(sig) || sig < 0 || sig > 100) return null;
  const security = securityOf(sec === '--' ? '' : sec);
  const rssiDbm = signalToDbm(sig);
  if (isDemo(ssidHex)) return { bssid, ssidHex, security, channel, band, rssiDbm, anon: false };
  return { bssid: anonId(bssid, salt), ssidHex: '', security, channel, band, rssiDbm, anon: true };
}

/** the whole nmcli output → at most 256 entries: our demo hotspots first (pinned, spec A5), then the loudest */
export function parseScan(text: string, salt: Buffer): Entry[] {
  const seen = new Set<string>();
  const all: Entry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const e = parseLine(line, salt);
    if (!e || seen.has(e.bssid)) continue;
    seen.add(e.bssid);
    all.push(e);
  }
  all.sort((a, b) => Number(a.anon) - Number(b.anon) || b.rssiDbm - a.rssiDbm);
  return all.slice(0, MAX_ENTRIES);
}

/** --fake: a demo hotspot, its open copy, and a few anonymous dots (no real networks involved), like the Mac app */
export function fakeEntries(elapsedS: number, copyAtS: number, salt: Buffer): Entry[] {
  const cycle = Math.max(60, copyAtS + 40);
  const s = elapsedS % cycle;
  const channels = [1, 6, 11, 36, 44, 149];
  const out: Entry[] = [];
  for (let i = 0; i < 6; i++) {
    out.push({
      bssid: anonId(`02:00:00:00:01:${i.toString(16).padStart(2, '0')}`, salt), ssidHex: '', security: i % 3 === 0 ? 'WPA3-SAE' : 'WPA2-PSK',
      channel: channels[i], band: i < 3 ? '2.4' : '5', rssiDbm: -62 - i * 5, anon: true,
    });
  }
  const name = Buffer.from(`${DEMO_PREFIX}Hotspot`, 'utf8').toString('hex');
  if (s > 3) out.push({ bssid: 'da:7e:00:00:00:01', ssidHex: name, security: 'WPA2/3', channel: 6, band: '2.4', rssiDbm: -47, anon: false });
  if (s > copyAtS && s < copyAtS + 30) out.push({ bssid: 'da:7e:00:00:00:66', ssidHex: name, security: 'OPEN', channel: 6, band: '2.4', rssiDbm: -36, anon: false });
  return out;
}
