# Progress · 4 Nov 2026

## Status

| Area | State |
|---|---|
| Engine: radio, maps, prediction, trust, LEO/GEO, voice, policies B1/B2/B3/Infinet + ablations | Done · 22 tests pass |
| Scenarios: leaving the building, fake café Wi-Fi, desert site | Done · demo seeds 26 / 21 / 16 (near median) |
| 3D world in the style-guide look (grid ground, 1.5 m cut-away walls, dBm cells, pixel tiles, violet tunnel) | Done |
| HUD: top bar, two policy panels, timeline with EDGE SEEN / WI-FI ACTUALLY DIES markers, captions, notes | Done |
| Phone (Infinet OS): Infinet, Networks, Call, Map, Shield, Lab, Sim notes, Credits | Done |
| Modes: free roam, tour (T), attract (45 s idle), slow-mo, truth/error views, fast travel | Done |
| Booth hardening: offline, auto-reload on error / WebGL loss, F9 reset | Done · `npm run qa` 10/10 PASS |
| Batch: 300 runs × 3 scenarios + property test | Done → `results/2026-11-04/SUMMARY.md` |
| Screenshots (14 beats) | Done → `results/shots/` |
| Cinematic recorder | Done (`npm run cinematic`); full video not yet rendered |

## Batch headline (results/2026-11-04, 300 runs per scenario, simulated)

| Scenario | Today's phone (B1) frozen, mean · p95 | Infinet frozen, mean · p95 | Calls survived B1 → Infinet |
|---|---|---|---|
| Leaving the building | 6.56 s · 18.96 s | 0.00 s · 0.00 s | 202 → 300 / 300 |
| Fake café Wi-Fi | 6.48 s · 18.90 s | 0.16 s · 0.00 s | 200 → 299 / 300 |
| Desert site | 12.68 s · 20.94 s | 5.15 s · 6.48 s | 60 → 300 / 300 |

- Property test: across 5,000 randomised runs, Infinet sent 0 voice frames over a fake, unchecked or Blocked network.
- Prediction switched a mean of 3.39 s before the Wi-Fi crossed −75 dBm (median 2.90 s).

**Read before quoting:**
- In the building exit, *Infinet without prediction* also freezes 0.00 s. What saves the call is checking before use plus duplicating over both paths. Prediction adds lead time (3.4 s) and a slightly lower voice loss (0.31 % vs 0.34 %), at the cost of more duplication (4.4 % extra data vs 2.4 % without it). Don't claim that prediction alone prevents the freeze.
- In the desert, Infinet still freezes about 5 s during the LEO outage (router failover 2–5 s). The win is that it never declares the link dead (0 false verdicts against B3's 10) and keeps the call. B3's longest freeze (5.6 s) is close to Infinet's (4.9 s).
- *Infinet without trust check* wrongly blocks the real café network (0.99 per run) and sends 395 frames to the copy. That's the ablation showing the trust check matters.

## TODO (needs a person or an asset)

- [ ] **Logo.** Replace the placeholder lockup in `src/app/ui/Hud.tsx` (`TODO(logo)`) with the master SVG in `public/brand/`. The wordmark is artwork, so don't retype it.
- [ ] **Voice.** A teammate records about 20 s of speech, saved as `public/audio/voice.ogg` (CC0 or our own). The WebAudio placeholder is used until then.
- [ ] Render the full backup video (`npm run cinematic`, about 15 min) and copy it to the booth laptop.
- [ ] Booth rehearsal on the actual laptop and display: check the fps overlay (F10) and the text size from 2 m.
- [ ] Optional: a live bridge to the real Infinet prototype (Rashid). Not built.

## Not built (by choice, see DECISIONS.md)

- Highway moment (D5, cut).
- Minimap (the phone's Map app shows the belief map instead).
- Physics engine / post-processing (style guide: no bloom, no glow).

## Items to verify before quoting numbers on stage

- 3GPP TR 38.901 UMa/RMa path-loss coefficients and the element pattern (Table 7.3-1), as used in `params.ts`.
- ITU-T G.107 E-model values (Ie, Bpl for the codec), and G.114 for the 150 ms / 400 ms mouth-to-ear guidance.
- Indoor wall losses (ITU-R P.2040 / P.1238 style values) for glass, concrete and metal.
- LEO reconfiguration period (15 s) and spike size: we use published measurements, rounded. Check the citation in `params.ts`.
- GEO round trip 600–700 ms (`geoRttMinMs`/`geoRttMaxMs`, IIUM 2026 field study). The screen shows about 710 ms including the site Wi-Fi hop.
- iOS and Android auto-join and "poor Wi-Fi" give-up behaviour behind B1 (the timers are `ASSUMPTION`s).
- Every `ASSUMPTION` param is listed in the phone's **Sim notes** app. Review that list once.

## Known quirks

- The HUD publishes at 10 Hz, so the timeline can lag the panels by up to 100 ms.
