import { describe, expect, it } from 'vitest';
import { anonId, bandOf, fakeEntries, parseLine, parseScan, securityOf, signalToDbm, splitTerse } from '../tools/scanner-linux/nmcli';
import { cleanBatch } from '../src/app/liveProtocol';

const SALT = Buffer.alloc(32, 7);
const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex').toUpperCase(); // nmcli prints SSID-HEX in upper case
const line = (bssid: string, name: string, chan: number, freq: number, sig: number, sec: string) =>
  `${bssid.toUpperCase().replace(/:/g, '\\:')}:${hex(name)}:${chan}:${freq} MHz:${sig}:${sec}`;

describe('Linux scanner: nmcli parsing (Security spec §6)', () => {
  it('splits on unescaped colons only', () => {
    expect(splitTerse('AA\\:BB:x\\\\y:3')).toEqual(['AA:BB', 'x\\y', '3']);
  });

  it('maps nmcli security to the simulation names', () => {
    expect(securityOf('')).toBe('OPEN');
    expect(securityOf('WEP')).toBe('WEP');
    expect(securityOf('WPA1')).toBe('WPA-TKIP');
    expect(securityOf('WPA1 WPA2')).toBe('WPA-TKIP');
    expect(securityOf('WPA2')).toBe('WPA2-PSK');
    expect(securityOf('WPA2 802.1X')).toBe('WPA2-ENT');
    expect(securityOf('WPA2 WPA3')).toBe('WPA2/3');
    expect(securityOf('WPA3')).toBe('WPA3-SAE');
    expect(securityOf('WPA3 802.1X')).toBe('WPA3-ENT');
    expect(securityOf('OWE')).toBe('OWE');
  });

  it('signal % and frequency', () => {
    expect(signalToDbm(100)).toBe(-40);
    expect(signalToDbm(0)).toBe(-100);
    expect(signalToDbm(50)).toBe(-70);
    expect(bandOf(2437)).toBe('2.4');
    expect(bandOf(5180)).toBe('5');
    expect(bandOf(5955)).toBe('6');
    expect(bandOf(900)).toBeNull();
  });

  it('keeps the name and BSSID of an Infinet-Demo hotspot', () => {
    const e = parseLine(line('da:7e:00:00:00:01', 'Infinet-Demo-Hotspot', 6, 2437, 80, 'WPA2 WPA3'), SALT)!;
    expect(e).toEqual({ bssid: 'da:7e:00:00:00:01', ssidHex: hex('Infinet-Demo-Hotspot').toLowerCase(), security: 'WPA2/3', channel: 6, band: '2.4', rssiDbm: -52, anon: false });
  });

  it('anonymises everyone else before anything leaves the scanner', () => {
    const e = parseLine(line('11:22:33:44:55:66', 'Neighbour Home', 36, 5180, 60, 'WPA2'), SALT)!;
    expect(e.anon).toBe(true);
    expect(e.ssidHex).toBe('');
    expect(e.bssid).toMatch(/^anon-[0-9a-f]{12}$/);
    expect(e.bssid).toBe(anonId('11:22:33:44:55:66', SALT));
    expect(e.bssid).not.toBe(anonId('11:22:33:44:55:66', Buffer.alloc(32, 8))); // a new salt each launch
  });

  it('a look-alike prefix (Cyrillic "е") is not one of ours', () => {
    const e = parseLine(line('da:7e:00:00:00:02', 'Infinеt-Demo-X', 6, 2437, 80, 'WPA2'), SALT)!;
    expect(e.anon).toBe(true);
  });

  it('drops malformed records', () => {
    expect(parseLine('garbage', SALT)).toBeNull();
    expect(parseLine(line('zz:7e:00:00:00:01', 'x', 6, 2437, 80, ''), SALT)).toBeNull();
    expect(parseLine(line('da:7e:00:00:00:01', 'x', 0, 2437, 80, ''), SALT)).toBeNull();
    expect(parseLine(line('da:7e:00:00:00:01', 'x', 6, 2437, 101, ''), SALT)).toBeNull();
    expect(parseLine(line('da:7e:00:00:00:01', 'x'.repeat(33), 6, 2437, 50, ''), SALT)).toBeNull();
    expect(parseLine('DA\\:7E\\:00\\:00\\:00\\:01:ZZ:6:2437 MHz:50:', SALT)).toBeNull();
  });

  it('pins our hotspots and caps the list at 256 (beacon flood)', () => {
    const flood = Array.from({ length: 400 }, (_, i) => line(`02:00:00:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`, `spam${i}`, 1, 2412, 90, ''));
    const ours = line('da:7e:00:00:00:01', 'Infinet-Demo-Hotspot', 6, 2437, 10, 'WPA2');
    const out = parseScan([...flood, ours, ours].join('\n'), SALT);
    expect(out).toHaveLength(256);
    expect(out[0].anon).toBe(false);
    expect(out.filter((e) => !e.anon)).toHaveLength(1);
  });

  it('what it sends passes the page\'s own checks unchanged', () => {
    const text = [
      line('da:7e:00:00:00:01', 'Infinet-Demo-Hotspot', 6, 2437, 80, 'WPA2 WPA3'),
      line('da:7e:00:00:00:66', 'Infinet-Demo-Hotspot', 6, 2437, 95, ''),
      line('11:22:33:44:55:66', 'Neighbour', 36, 5180, 40, 'WPA2'),
    ].join('\n');
    const entries = parseScan(text, SALT);
    const page = cleanBatch({ v: 1, type: 'scan', entries })!;
    expect(page).toHaveLength(3);
    expect(page.map((e) => e.bssid)).toEqual(entries.map((e) => e.bssid));
    expect(page.filter((e) => !e.anon).map((e) => [e.ssid, e.security])).toEqual([['Infinet-Demo-Hotspot', 'OPEN'], ['Infinet-Demo-Hotspot', 'WPA2/3']]);
    expect(cleanBatch({ v: 1, type: 'scan', entries: fakeEntries(20, 15, SALT) })).toHaveLength(8);
  });
});
