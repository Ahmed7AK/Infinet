/**
 * Live hotspot input (Security spec §6). The Infinet Scanner app on the laptop listens to the Wi-Fi around it and
 * pushes what it hears to this page over a WebSocket on 127.0.0.1. It is one way: the page never sends scan
 * data back, and the laptop only listens; it never transmits attack traffic. A network heard for the first time
 * appears in the world beside the walker, where it was first heard, and Infinet screens it for real (red flags,
 * look-alike names, downgrade). Its probe is simulated, because nothing is ever sent to a real network.
 *
 * Privacy: only names that start with "Infinet-Demo-" are ever shown. Everyone else's network is an anonymous
 * dot: the scanner swaps its BSSID for a salted hash and drops its name before anything leaves the app, and this
 * page enforces the same rule again (defence in depth). Nothing is written to disk or uploaded. Names are
 * rendered as React text (textContent), never as HTML.
 *
 * Messages (scanner → page), JSON text frames, at most 2 a second, at most 256 entries each:
 *   { "v": 1, "type": "scan", "entries": [ { "bssid": "aa:bb:cc:dd:ee:ff" | "anon-<12 hex>",
 *       "ssidHex": "<hex of the raw SSID bytes, '' when anonymous>", "security": "WPA2-PSK", "channel": 6,
 *       "band": "2.4" | "5" | "6", "rssiDbm": -54, "anon": false } ] }
 *   { "v": 1, "type": "status", "state": "scanning" | "no-location" | "no-wifi" }
 * Security is one of OPEN · WEP · WPA-TKIP · OWE · WPA2-PSK · WPA2/3 · WPA2-ENT · WPA3-SAE · WPA3-ENT.
 * The Linux scanner (tools/scanner-linux) sends exactly the same messages.
 *
 * URL: ?live=1&token=… (the page is served by the scanner), ?live=<port>&token=… (the scanner on another
 * port, for development; start it with --dev-origin), or ?live=replay (a synthetic example, labelled as such).
 */
import type { LiveEntry, Security } from '../engine/index';
import { driver, useUi } from './driver';
import { cleanBatch, DEMO_PREFIX } from './liveProtocol';

const MIN_GAP_MS = 500; // 2 Hz

let last: LiveEntry[] = [];
let lastAt = 0;
function apply(entries: LiveEntry[]) {
  last = entries;
  const now = performance.now();
  if (now - lastAt < MIN_GAP_MS) return;
  lastAt = now;
  driver.sim.setLiveScan(entries);
  useUi.setState({ liveCount: entries.length });
}

function connect(url: string) {
  let wait = 1000;
  const open = () => {
    useUi.setState((u) => ({ scanner: u.scanner === 'live' ? 'lost' : u.scanner === 'off' ? 'connecting' : u.scanner }));
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { setTimeout(open, wait); return; }
    ws.onopen = () => { wait = 1000; useUi.setState({ scanner: 'live', scannerNote: '' }); };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string' || ev.data.length > 200_000) return;
      let msg: unknown;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const m = msg as { type?: string; state?: string };
      if (m?.type === 'status') {
        const note = m.state === 'no-location' ? 'Location permission needed: macOS hides network names without it'
          : m.state === 'no-wifi' ? 'Wi-Fi is off on this laptop' : '';
        useUi.setState({ scannerNote: note });
        return;
      }
      const batch = cleanBatch(msg);
      if (batch) apply(batch);
    };
    ws.onclose = () => {
      useUi.setState((u) => ({ scanner: u.scanner === 'live' || u.scanner === 'lost' ? 'lost' : 'connecting' }));
      setTimeout(open, wait);
      wait = Math.min(10_000, wait * 2);
    };
  };
  open();
  // a new scene is a new simulation: give it what is around right now (it counts as the baseline, not a flood)
  let sim = driver.sim;
  setInterval(() => { if (driver.sim !== sim) { sim = driver.sim; lastAt = 0; apply(last); } }, 250);
}

// ───────────── replay: a synthetic example (no real networks), for the hosted site and rehearsals ─────────────
function replay() {
  useUi.setState({ scanner: 'replay', scannerNote: 'Synthetic example: not a real scan' });
  const hex = (s: string) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');
  const t0 = performance.now();
  const dots: LiveEntry[] = Array.from({ length: 11 }, (_, i) => ({
    bssid: `anon-${(0x5a17c0de0000 + i * 7919).toString(16).padStart(12, '0')}`, ssidHex: '', ssid: '', security: (i % 4 ? 'WPA2-PSK' : 'WPA3-SAE') as Security,
    channel: [1, 6, 11, 36, 44, 149][i % 6], band: i % 6 < 3 ? '2.4' as const : '5' as const, rssiDbm: -62 - ((i * 37) % 28), anon: true,
  }));
  const hotspot: LiveEntry = { bssid: 'da:7e:00:00:00:01', ssidHex: hex(`${DEMO_PREFIX}Hotspot`), ssid: `${DEMO_PREFIX}Hotspot`, security: 'WPA2/3', channel: 6, band: '2.4', rssiDbm: -47, anon: false };
  const copy: LiveEntry = { ...hotspot, bssid: 'da:7e:00:00:00:66', security: 'OPEN', rssiDbm: -36 };
  let sim = driver.sim;
  setInterval(() => {
    if (driver.sim !== sim) sim = driver.sim;
    const s = (performance.now() - t0) / 1000 % 60;
    const wobble = (e: LiveEntry, k: number) => ({ ...e, rssiDbm: Math.round(e.rssiDbm + 2 * Math.sin(s * 0.9 + k)) });
    const list = dots.map(wobble);
    if (s > 4) list.push(wobble(hotspot, 1));
    if (s > 16 && s < 50) list.push(wobble(copy, 2));
    lastAt = 0;
    apply(list);
  }, 500);
}

/** start from the page URL; strips the token from the address bar once read, so it never shows on screen */
export function startLive(q: URLSearchParams) {
  const live = q.get('live');
  if (!live) return;
  if (live === 'replay') { replay(); return; }
  const token = q.get('token') ?? '';
  if (!/^[0-9a-f]{32,64}$/.test(token)) { useUi.setState({ scanner: 'lost', scannerNote: 'Open the simulation from the Infinet Scanner app' }); return; }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  if (!local) { useUi.setState({ scanner: 'lost', scannerNote: 'Live scan works only on this laptop (127.0.0.1)' }); return; }
  const port = /^\d{2,5}$/.test(live) ? live : location.port;
  const url = `ws://127.0.0.1:${port}/scan?token=${token}`;
  q.delete('token');
  history.replaceState(null, '', `${location.pathname}?${q.toString()}${location.hash}`);
  connect(url);
}
