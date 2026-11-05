# Infinet Scanner (macOS)

Feeds the Wi-Fi around the booth laptop into the simulation (Security spec §6). Start a hotspot on your
phone named `Infinet-Demo-<anything>` and it appears in the 3D world beside the walker, where it was first
heard. Infinet screens it for real: red flags, look-alike names, downgrade. Its probe is simulated, because
the laptop never joins or sends anything to a real network.

## Build and run

```bash
tools/scanner-mac/build.sh
open "tools/scanner-mac/build/Infinet Scanner.app"
```

`build.sh` builds the site (`npm run build`), compiles the app with `swiftc` (Xcode command-line tools) and
signs it ad hoc. The app serves the bundled site on `127.0.0.1` at a random port and opens it in the browser
with a one-time token. The first launch asks for **Location**: macOS shows Wi-Fi names only to apps that have
it. If the page says "Location permission needed", allow it in System Settings › Privacy & Security ›
Location Services (the menu-bar item `Infinet ◦` has a shortcut), then reload.

The menu-bar item shows how many networks are nearby, how many are Infinet-Demo, and how many pages are
watching (`●` when one is connected).

**The booth moment:** start `Infinet-Demo-Hotspot` first and let the sim see it (a few seconds). Then start a
second hotspot with the same name, open (no password), on another phone. It is Blocked: same name, a
different device, no password. If both come up at the same moment, neither can be "the one we know" (trust
on first use), so both are Tunnel only.

Options: `--site <dir>`, `--port <n>`, `--no-open`, `--print-url`, `--dev-origin http://localhost:5173`
(to drive the Vite dev page: open `http://localhost:5173/?live=<port>&token=<token>`), and `--fake` (synthetic
networks, no Wi-Fi or Location needed; `--fake-copy-at <s>` sets when the fake copy appears).

## What leaves the app

Only networks whose name starts with `Infinet-Demo-` keep their name and BSSID. Every other network becomes
an anonymous dot: its name is dropped, and its BSSID is replaced by `anon-` plus 12 hex characters of an
HMAC-SHA256 under a salt made fresh at each launch and kept in memory only. This happens before anything is
sent. The page enforces the same rule a second time. Nothing is written to disk and nothing goes off the
laptop. The scan is the same one macOS runs for its own Wi-Fi menu.

The local server listens on the loopback interface only, answers only requests whose `Host` is
`127.0.0.1:<port>` (DNS rebinding), serves files only from the site folder (GET/HEAD, no `..`, symlinks
resolved), and upgrades `/scan` only with the launch token (constant-time compare) and the page's own
`Origin`. At most 4 pages at once. Anything a page sends on the WebSocket is discarded.

## Message format (for other scanners, e.g. Linux)

A WebSocket at `ws://127.0.0.1:<port>/scan?token=<token>` sends JSON text frames, at most 2 a second:

```json
{ "v": 1, "type": "scan", "entries": [
  { "bssid": "da:7e:00:00:00:01", "ssidHex": "496e66696e65742d44656d6f2d486f7473706f74",
    "security": "WPA2/3", "channel": 6, "band": "2.4", "rssiDbm": -47, "anon": false },
  { "bssid": "anon-72a6277eb153", "ssidHex": "", "security": "WPA2-PSK", "channel": 1, "band": "2.4",
    "rssiDbm": -62, "anon": true } ] }
```

```json
{ "v": 1, "type": "status", "state": "scanning" }
```

- `bssid`: lower-case MAC for `Infinet-Demo-` networks, `anon-<12 hex>` for everyone else.
- `ssidHex`: the raw SSID bytes in hex (at most 32 bytes); empty when anonymous. The page decodes it as strict
  UTF-8, strips control and format characters, and shows it as text, never HTML.
- `security`: `OPEN` · `WEP` · `WPA-TKIP` · `OWE` · `WPA2-PSK` · `WPA2/3` (WPA2/WPA3 transition) · `WPA2-ENT` ·
  `WPA3-SAE` · `WPA3-ENT`.
- `channel` 1–233, `band` `2.4` · `5` · `6`, `rssiDbm` −120 to 0.
- At most 256 entries. The page drops anything malformed.
- `status.state`: `scanning` · `no-location` · `no-wifi`.

For a Linux scanner: `iw dev <if> scan` (or `nmcli -f BSSID,SSID,CHAN,SIGNAL,SECURITY dev wifi`) gives the same
fields. Apply the same anonymisation before sending, and serve the page from the same origin, or pass
`?live=<port>` and allow that page's `Origin`.
