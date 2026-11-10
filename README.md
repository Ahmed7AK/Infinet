# Infinet · 3D simulation

A walkable, realistic 3D model of the three Infinet demo moments, built from `INFINET_3D_SIM_PLAN.md` (grounded realism, third-person camera, Network Vision):

1. **Leaving the building.** It sees the Wi-Fi edge on the map and checks 5G before the drop.
2. **The fake café Wi-Fi.** It screens and probes a network before it carries anything, and blocks the copy (Security spec v1.0).
3. **The desert site.** The satellite link is patient, not panicked: it learns the LEO pattern and falls back to GEO.

One world, two phones on the same walk and the same signal (common random numbers): **Today's phone** (a baseline policy, B1/B2/B3) and **Infinet**, compared in the strip at the top.
The engine (`src/engine`) is pure TypeScript and deterministic. Every number comes from `src/engine/params.ts`, either cited or labelled `ASSUMPTION`.

Everything runs offline: fonts are bundled, there is no CDN and no network calls.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Booth build (production, auto-reload on error):

```bash
npm run build
npm run preview      # http://localhost:4173
```

## Booth how-to

| Key | Does |
|---|---|
| **T** | Guided tour: office → café → desert (→ our hall on the booth build), then back to free roam |
| **W A S D** (Shift = run) | Walk. Any movement takes over from the tour |
| **drag** | Look around (the camera follows your walking direction again after a few seconds) |
| **1 · 2 · 3** (or the chips under the scene title) | Jump to a scene: office exit · café · desert site. **4** is our venue hall, only on a build that has `venue-private/` (the booth laptop) |
| **L** (or the card by the phone) | Sign in, when a Wi-Fi shows a sign-in page. Infinet checks it again, then moves the call onto it |
| **M** (or the chip) | Skip to the scene's key moment; again to replay it |
| **N** | Network Vision: the world goes grey and the networks, the tunnel and the packets light up |
| **Shift+N** | In Vision: Infinet's map → true signal → map error |
| **C** | Change the baseline (B1 switches after the drop · B2 joins the strongest signal · B3 tunnel, no check) |
| hold **B** | Hear the baseline's call instead of Infinet's |
| hold **Space** | Slow motion 0.25× |
| **↑** (or click it) | Raise the phone (Infinet OS). Arrows, Enter, ⌫ / Esc |
| **H** | Help |
| **F9** | Reset everything (also clears Lab changes) |
| **F10** | Performance overlay |

- After 45 s with no input it plays **attract mode** (the tour on a loop). Any key returns to free roam.
- The phone pops up on its **Tunnel** app ("How it works") at the moments that matter: you → the networks → one encrypted tunnel → the anchor server → Hamad, drawn live from the phone's own state, with the check's stages (Appears · Screen · Quarantine · Verdict · Roam). Switch the pop-ups off in Lab.
- The phone's **Lab** app holds demo controls (baseline, attacker on/off, café attack: open copy · perfect copy · downgrade, relays or tampers, power, forged disconnects, café blocks UDP, two DDoS (beacon flood · uplink flood), a fake Site-Net in the desert, anchor server up/down and an 8 s anchor-down moment, LEO outage, map staleness, walking speed, pop-ups, seed). It is badged "Demo controls, not part of the product".
- At the booth, run the preview build in Chrome full screen (`--kiosk`). Keep the Mac awake with `caffeinate -dims`. The page reloads itself after any uncaught error or a lost WebGL context.

## Live Wi-Fi scan (Security spec §6)

`tools/scanner-mac/build.sh` builds **Infinet Scanner.app**: it serves the simulation on 127.0.0.1 and feeds it the Wi-Fi around the laptop. Name a phone hotspot `Infinet-Demo-<anything>` and it appears beside the walker, where it was first heard, and is screened for real; a second hotspot with the same name and no password is Blocked. Everyone else's network is an anonymous dot (name dropped, BSSID replaced by a salted hash before it leaves the app). Nothing is stored or uploaded, and the laptop never transmits to any network. Details, security and the message format for other scanners: [tools/scanner-mac/README.md](tools/scanner-mac/README.md). On Linux, `npm run build && npm run scanner` does the same with `nmcli` ([tools/scanner-linux/README.md](tools/scanner-linux/README.md)). Without a scanner, `?live=replay` plays a synthetic example (labelled as such); the hosted site has no live scan.

## The film and the real-world demo

- **[media/infinet-film.mp4](media/infinet-film.mp4)**: the judges' film (about 75 s, no sound). The problem, the idea, the three scenes, the numbers from the batch, and what is built, simulated and next. The booth cut adds our hall and stays on the booth laptop.
- **[REAL_WORLD_DEMO.md](REAL_WORLD_DEMO.md)**: ways to show it working in the real world, and the morning go / no-go for the live hotspot test.

## Tools

```bash
npm test                                 # engine tests (vitest)
npm run typecheck && npm run lint
npm run batch -- --scenario all --runs 300 --seed 1 --property 5000 --out results/2026-11-10
npm run shots                            # 17 verification screenshots → results/shots (needs npm run dev)
npm run qa                               # booth checks against the preview build (needs npm run preview)
npm run cinematic                        # deterministic backup video → results/cinematic (needs npm run dev + ffmpeg)
npm run film -- --cut public             # the judges' film → media/infinet-film.mp4 (needs npm run dev + ffmpeg)
npm run film -- --cut booth              # the same with our hall → venue-private/media/ (booth laptop only, never pushed)
```

- Batch results are in `results/<date>/SUMMARY.md`: mean, median, p95 and bootstrap 95 % CI per scenario and policy, plus charts and the property test.
- URL hooks for recording: `?scene=cafe-twin&t=25&vision=1&view=truth&app=4&baseline=b2&stale=0.6&pause=1`.
- Attacks from the URL: `&attack=beacon,uplink,site` (beacon flood · uplink flood · fake Site-Net), e.g. `?scene=building-exit&attack=uplink&vision=1`.
- Assets (raw downloads go to `assets-src/downloads/`, not shipped):
  - `npx tsx tools/assets/fetch-polyhaven.ts` (CC0 skies, textures and models), then `Blender -b -P tools/blender/import_polyhaven.py` (models → `public/models/ph_*.glb`)
  - `npx tsx tools/assets/fetch-rocketbox.ts` (MIT people and clips), then `Blender -b -P tools/blender/import_rocketbox.py` (→ `public/models/people/`)
  - `Blender -b -P tools/blender/build_all.py` (scripted hardware and street props → `public/models`)
  - `Blender` is `/Applications/Blender.app/Contents/MacOS/Blender`.

## Where things are

- `src/engine/`: radio (TR 38.901, multi-wall Wi-Fi, correlated shadowing), belief vs truth maps, prediction, trust checks, links (LEO/GEO), voice (E-model), policies
- `src/scenarios/*.json`: the three scripted walks and their captions
- `src/world/layout.json`: one geometry for both the radio model and the renderer
- `src/app/`: renderer (`scene/`: sky, sun, post, camera, zones, people), Network Vision (`network/`), HUD, phone, driver, audio
- `DECISIONS.md`: design decisions and every override of the plan
- `PROGRESS.md`: status, open TODOs, items to verify
- `CREDITS.md`: licences

Everything on screen is **simulated**. Partner, venue and operator names never appear. Demo hotspots are generic, and other people's networks appear as anonymous dots.
