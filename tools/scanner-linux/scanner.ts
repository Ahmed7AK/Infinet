/**
 * Infinet Scanner (Linux): listens to the Wi-Fi around this laptop and feeds it to the booth simulation
 * (Security spec §6). Same behaviour and message format as tools/scanner-mac, built on `nmcli`.
 *
 *  • Listen only. It runs `nmcli dev wifi list` / `rescan` as your normal user: no root, it never joins,
 *    changes or sends anything to a network. Every nmcli call has a timeout.
 *  • Only networks named Infinet-Demo-… keep their name and BSSID. Everyone else becomes an anonymous dot
 *    (name dropped, BSSID → salted HMAC; the salt is new at each launch and lives in memory only). Nothing is
 *    written to disk and nothing leaves the laptop.
 *  • Serves the built simulation (dist/) on 127.0.0.1 only, at a random port. Every request must carry
 *    Host 127.0.0.1:<port> (stops DNS rebinding); files only from the site folder (GET/HEAD, no "..",
 *    symlinks resolved). The WebSocket /scan needs the launch token (constant-time compare) and the page's own
 *    Origin, at most 4 pages, and is one way: anything a page sends is thrown away.
 *
 * Run:   npm run build && npm run scanner
 * Opts:  --site <dir> · --port <n> · --no-open · --print-url · --dev-origin http://localhost:5173 (also accept the
 *        Vite dev page: open http://localhost:5173/?live=<port>&token=<token>) · --fake (synthetic networks)
 *        · --fake-copy-at <s> · --iface <wlan0>
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createServer, type IncomingMessage } from 'node:http';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Duplex } from 'node:stream';
import { fakeEntries, NMCLI_FIELDS, parseScan, type Entry } from './nmcli';

// ───────────── options ─────────────
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const opts = { site: join(ROOT, 'dist'), port: 0, open: true, printUrl: false, devOrigins: [] as string[], fake: false, fakeCopyAt: 15, iface: '' };
{
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const next = () => a[++i] ?? '';
    switch (a[i]) {
      case '--site': opts.site = resolve(next()); break;
      case '--port': opts.port = Number(next()); break;
      case '--no-open': opts.open = false; break;
      case '--print-url': opts.printUrl = true; break;
      case '--dev-origin': opts.devOrigins.push(next()); break;
      case '--fake': opts.fake = true; break;
      case '--fake-copy-at': opts.fakeCopyAt = Number(next()); break;
      case '--iface': opts.iface = next(); break;
      case '-h': case '--help':
        console.log('npm run scanner -- [--site dir] [--port n] [--no-open] [--print-url] [--dev-origin url] [--fake] [--fake-copy-at s] [--iface wlan0]');
        process.exit(0);
        break;
      default: log(`unknown option ${a[i]}`); process.exit(2);
    }
  }
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) { log('bad --port'); process.exit(2); }
  if (!/^[A-Za-z0-9_.-]{0,15}$/.test(opts.iface)) { log('bad --iface'); process.exit(2); }
}

const TOKEN = randomBytes(24).toString('hex');   // 48 hex characters, new at each launch, only in the URL we open
const SALT = randomBytes(32);                    // for the anonymous IDs; never leaves memory
const SEND_EVERY_MS = 1000;                      // the page applies at most 2 a second; one a second is plenty
const LIST_EVERY_MS = 2000;                      // read NetworkManager's scan list
const RESCAN_EVERY_MS = 10_000;                  // ask for a fresh scan (NetworkManager refuses rapid rescans)
const NMCLI_TIMEOUT_MS = 5000;
const MAX_CLIENTS = 4;
const STARTED = Date.now();

function log(s: string) { process.stderr.write(`Infinet Scanner: ${s}\n`); }

// ───────────── scanning ─────────────
let entries: Entry[] = [];
let wifiOn = true;
let failures = 0;

function nmcli(args: string[]): Promise<string> {
  return new Promise((ok, fail) => {
    execFile('nmcli', args, { timeout: NMCLI_TIMEOUT_MS, maxBuffer: 1 << 20, env: { ...process.env, LC_ALL: 'C' } }, (err, out) => (err ? fail(err) : ok(out)));
  });
}
const ifaceArgs = () => (opts.iface ? ['ifname', opts.iface] : []);

async function readList() {
  try {
    wifiOn = (await nmcli(['-t', 'radio', 'wifi'])).trim() === 'enabled';
    if (!wifiOn) { entries = []; return; }
    const out = await nmcli(['-t', '-f', NMCLI_FIELDS, 'dev', 'wifi', 'list', ...ifaceArgs(), '--rescan', 'no']);
    entries = parseScan(out, SALT);
    failures = 0;
  } catch (e) {
    // fail closed: keep nothing stale for long, and say so
    if (++failures === 3) log(`nmcli keeps failing (${(e as Error).message.split('\n')[0]}); is NetworkManager running?`);
    if (failures >= 3) entries = [];
  }
}
function rescan() {
  if (wifiOn) nmcli(['dev', 'wifi', 'rescan', ...ifaceArgs()]).catch(() => { /* "scanning not allowed" right after another scan: fine */ });
}

function message(): string {
  if (opts.fake) return JSON.stringify({ v: 1, type: 'scan', entries: fakeEntries((Date.now() - STARTED) / 1000, opts.fakeCopyAt, SALT) });
  if (!wifiOn) return JSON.stringify({ v: 1, type: 'status', state: 'no-wifi' });
  return JSON.stringify({ v: 1, type: 'scan', entries });
}

// ───────────── HTTP + WebSocket on 127.0.0.1 ─────────────
const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', ktx2: 'image/ktx2', ico: 'image/x-icon',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream', hdr: 'application/octet-stream',
  exr: 'application/octet-stream', wasm: 'application/wasm', woff2: 'font/woff2', woff: 'font/woff',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
};

if (!existsSync(join(opts.site, 'index.html'))) {
  log(`no built simulation in ${opts.site}; run "npm run build" first, or pass --site <dist folder>`);
  process.exit(2);
}
const SITE = realpathSync(opts.site);
let port = 0;

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function hostOk(req: IncomingMessage) {
  const h = req.headers.host ?? '';
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}
function pathOf(req: IncomingMessage): { path: string; query: URLSearchParams } | null {
  try {
    const u = new URL(req.url ?? '/', 'http://h');
    return { path: decodeURIComponent(u.pathname), query: u.searchParams };
  } catch { return null; }
}

const server = createServer((req, res) => {
  const plain = (code: number, text: string) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); };
  // DNS rebinding: a web page that points its own name at 127.0.0.1 still sends its own Host
  if (!hostOk(req)) return plain(421, 'Misdirected Request');
  if (req.method !== 'GET' && req.method !== 'HEAD') return plain(405, 'Method Not Allowed');
  const u = pathOf(req);
  if (!u) return plain(400, 'Bad Request');
  let p = u.path;
  if (p.endsWith('/')) p += 'index.html';
  if (!p.startsWith('/') || p.includes('..') || p.includes('\0')) return plain(400, 'Bad Request');
  let file: string;
  try { file = realpathSync(join(SITE, p.slice(1))); } catch { return plain(404, 'Not Found'); }
  if (!file.startsWith(SITE + sep)) return plain(404, 'Not Found');
  let data: Buffer;
  try { if (!statSync(file).isFile()) return plain(404, 'Not Found'); data = readFileSync(file); } catch { return plain(404, 'Not Found'); }
  const ext = extname(file).slice(1).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Content-Length': data.length,
    'Cache-Control': ext === 'html' ? 'no-store' : 'max-age=3600',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
});

// ── WebSocket (RFC 6455), server → page only ──
const clients = new Set<Duplex>();

function wsFrame(payload: Buffer, opcode = 0x1): Buffer {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n])
    : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 0xff])
      : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, payload]);
}
function reject(sock: Duplex, code: number, text: string) {
  sock.end(`HTTP/1.1 ${code} ${text}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
}
function drop(sock: Duplex) { clients.delete(sock); sock.destroy(); }

server.on('upgrade', (req, sock: Duplex) => {
  sock.on('error', () => drop(sock));
  const u = pathOf(req);
  if (!hostOk(req)) return reject(sock, 421, 'Misdirected Request');
  if (!u || u.path !== '/scan') return reject(sock, 404, 'Not Found');
  const origin = req.headers.origin ?? '';
  const okOrigin = origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}` || opts.devOrigins.includes(origin);
  if (!sameText(u.query.get('token') ?? '', TOKEN) || !okOrigin) return reject(sock, 403, 'Forbidden');
  const key = req.headers['sec-websocket-key'];
  if ((req.headers.upgrade ?? '').toLowerCase() !== 'websocket' || req.headers['sec-websocket-version'] !== '13' || typeof key !== 'string' || !key) {
    return reject(sock, 400, 'Bad Request');
  }
  if (clients.size >= MAX_CLIENTS) return reject(sock, 503, 'Too Many Viewers');
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  clients.add(sock);
  sock.write(wsFrame(Buffer.from(message())));
  // the page may only close or ping; anything else it sends is read and thrown away (this channel is one way)
  let buf = Buffer.alloc(0);
  sock.on('data', (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    if (buf.length > 65536) return drop(sock);
    while (buf.length >= 2) {
      const op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, at = 2;
      if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); at = 4; } else if (len === 127) return drop(sock);
      const need = at + (masked ? 4 : 0) + len;
      if (buf.length < need) break;
      if (op === 0x8) { clients.delete(sock); sock.end(wsFrame(Buffer.alloc(0), 0x8)); return; }
      if (op === 0x9) sock.write(wsFrame(Buffer.alloc(0), 0xa));
      buf = buf.subarray(need);
    }
  });
  sock.on('close', () => clients.delete(sock));
});

server.listen(opts.port, '127.0.0.1', () => {
  const a = server.address();
  port = typeof a === 'object' && a ? a.port : 0;
  const url = `http://127.0.0.1:${port}/?live=1&token=${TOKEN}`;
  log(`serving the simulation on http://127.0.0.1:${port} (loopback only)${opts.fake ? ' · FAKE networks' : ''}`);
  if (opts.devOrigins.length) log(`dev page: ${opts.devOrigins[0]}/?live=${port}&token=${TOKEN}`);
  if (opts.printUrl) console.log(url);
  if (opts.open) {
    const child = spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
    child.on('error', () => log(`open this in a browser: ${url}`));
    child.unref();
  }
});

// ───────────── loops ─────────────
if (!opts.fake) {
  void readList();
  rescan();
  setInterval(() => void readList(), LIST_EVERY_MS);
  setInterval(rescan, RESCAN_EVERY_MS);
}
setInterval(() => {
  if (!clients.size) return;
  const f = wsFrame(Buffer.from(message()));
  for (const c of clients) c.write(f);
}, SEND_EVERY_MS);
setInterval(() => {
  const named = entries.filter((e) => !e.anon).length;
  if (!opts.fake) log(`${wifiOn ? `${entries.length} networks nearby · ${named} Infinet-Demo` : 'Wi-Fi is off'} · ${clients.size} viewer${clients.size === 1 ? '' : 's'}`);
}, 15_000);
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => { for (const c of clients) c.destroy(); process.exit(0); });
