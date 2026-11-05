/**
 * The live-scan message checks (Security spec §6), kept free of the app so tests can run them in Node.
 * Anything malformed is dropped; any name that does not start with "Infinet-Demo-" is made anonymous here again,
 * whatever the scanner said (defence in depth).
 */
import { displayName, type LiveEntry, type Security } from '../engine/index';

export const DEMO_PREFIX = 'Infinet-Demo-';
const SECURITIES = new Set<Security>(['OPEN', 'WEP', 'WPA-TKIP', 'OWE', 'WPA2-PSK', 'WPA2/3', 'WPA2-ENT', 'WPA3-SAE', 'WPA3-ENT']);
const MAC = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const ANON = /^anon-[0-9a-f]{12}$/;
const MAX_ENTRIES = 256;

/** per-page salt for the second anonymisation (never stored) */
const SALT = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
function anonId(mac: string): string {
  // FNV-1a 64 over salt + MAC: enough to tell dots apart in memory, never reversible to a stored list
  let h = 0xcbf29ce484222325n;
  for (const ch of SALT + mac.toLowerCase()) { h ^= BigInt(ch.charCodeAt(0)); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return `anon-${h.toString(16).padStart(16, '0').slice(0, 12)}`;
}

/** check one entry from the scanner; anything malformed is dropped, any non-demo name is made anonymous */
export function cleanEntry(x: unknown): LiveEntry | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const bssid = typeof o.bssid === 'string' ? o.bssid : '';
  const ssidHex = typeof o.ssidHex === 'string' ? o.ssidHex.toLowerCase() : '';
  const security = o.security as Security;
  const channel = Number(o.channel), rssiDbm = Number(o.rssiDbm);
  if (!(MAC.test(bssid) || ANON.test(bssid))) return null;
  if (!/^[0-9a-f]*$/.test(ssidHex) || ssidHex.length > 64 || ssidHex.length % 2) return null;
  if (!SECURITIES.has(security)) return null;
  if (!Number.isInteger(channel) || channel < 1 || channel > 233) return null;
  if (!Number.isFinite(rssiDbm) || rssiDbm < -120 || rssiDbm > 0) return null;
  const band: LiveEntry['band'] = o.band === '2.4' ? '2.4' : '5'; // 6 GHz is drawn with 5 GHz: same short range
  const name = ssidHex ? displayName(ssidHex) : '';
  const demo = !o.anon && name.startsWith(DEMO_PREFIX);
  if (!demo) return { bssid: ANON.test(bssid) ? bssid : anonId(bssid), ssidHex: '', ssid: '', security, channel, band, rssiDbm, anon: true };
  return { bssid: bssid.toLowerCase(), ssidHex, ssid: name, security, channel, band, rssiDbm, anon: false };
}

export function cleanBatch(msg: unknown): LiveEntry[] | null {
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as Record<string, unknown>;
  if (m.v !== 1 || m.type !== 'scan' || !Array.isArray(m.entries)) return null;
  const out: LiveEntry[] = [];
  const seen = new Set<string>();
  for (const x of m.entries.slice(0, MAX_ENTRIES)) {
    const e = cleanEntry(x);
    if (e && !seen.has(e.bssid)) { seen.add(e.bssid); out.push(e); }
  }
  return out;
}
