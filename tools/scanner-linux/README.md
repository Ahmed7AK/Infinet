# Infinet Scanner (Linux)

The Linux version of [tools/scanner-mac](../scanner-mac/README.md), built on `nmcli` (Security spec §6). It feeds
the Wi-Fi around the booth laptop into the simulation. Start a hotspot on your phone named
`Infinet-Demo-<anything>` and it appears in the 3D world beside the walker, where it was first heard. Infinet
screens it for real: red flags, look-alike names, downgrade. Its probe is simulated, because the laptop never
joins or sends anything to a real network.

## Run

```bash
npm run build      # once, and after any change to the simulation
npm run scanner    # serves dist/ on 127.0.0.1 and opens the browser with a one-time token
```

Needs NetworkManager (`nmcli`) and Wi-Fi switched on. No root and no extra packages.

Options (after `--`, e.g. `npm run scanner -- --fake`):

| Option | Does |
|---|---|
| `--fake` | Synthetic networks, no Wi-Fi needed: a demo hotspot after 3 s, its open copy at 15 s for 30 s |
| `--fake-copy-at <s>` | When the fake copy appears |
| `--dev-origin http://localhost:5173` | Also accept the Vite dev page. It prints the URL to open (`?live=<port>&token=…`) |
| `--no-open` · `--print-url` | Don't open a browser · print the page URL on stdout |
| `--port <n>` · `--site <dir>` · `--iface <wlan0>` | Fixed port · another build folder · one Wi-Fi adapter |

**The booth moment:** start `Infinet-Demo-Hotspot` on one phone and let the sim see it (a few seconds;
NetworkManager rescans about every 10 s). Then start a second hotspot with the same name, open (no password), on
another phone. It is Blocked: same name, a different device, no password.

## What leaves the scanner

Only networks whose raw name starts with the bytes of `Infinet-Demo-` keep their name and BSSID (a look-alike
letter does not count). Every other network becomes an anonymous dot: its name is dropped, and its BSSID is
replaced by `anon-` plus 12 hex characters of an HMAC-SHA256 under a salt made fresh at each launch and kept in
memory only. This happens before anything is sent; the page enforces the same rule a second time. Our hotspots
are pinned and the list is capped at 256 (beacon floods). Nothing is written to disk and nothing leaves the
laptop.

It only reads NetworkManager's scan list (`nmcli dev wifi list`) and asks for a rescan; it never connects,
changes a connection or transmits. Every `nmcli` call has a 5 s timeout. After 3 failures in a row the list is
emptied (fail closed).

The local server listens on `127.0.0.1` only, answers only requests whose `Host` is `127.0.0.1:<port>` (DNS
rebinding), serves files only from the site folder (GET/HEAD, no `..`, symlinks resolved), and upgrades `/scan`
only with the launch token (constant-time compare) and the page's own `Origin`. At most 4 pages at once.
Anything a page sends on the WebSocket is discarded. The message format is the one in the macOS README.

## Not done yet (spec §6)

- The spec names a **Go** binary; this one is Node/TypeScript so it runs with the project's own tooling.
- The **systemd sandbox** (dedicated `infinet-scan` user, AppArmor allowing only `/usr/bin/nmcli`, polkit scan
  action only, `IPAddressDeny=any`) is not set up. Today it runs as your user.
