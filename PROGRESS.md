# Progress · 5 Nov 2026

## Status

| Area | State |
|---|---|
| Engine: radio, maps, prediction, trust, LEO/GEO, voice, policies B1/B2/B3/Infinet + ablations | Done · 22 tests pass |
| Scenarios: leaving the building, fake café Wi-Fi, desert site | Done · demo seeds 26 / 21 / 16 (near median) |
| 3D world, realistic (plan D3): HDR skies with a measured, shadow-casting sun, an indoor ceiling light, PBR textures, 33 Blender-built and 67 Poly Haven props, 37 Rocketbox people, third-person camera with collision | Done |
| Life in the scene (scene-only, the engine never sees it): moving traffic (IDM) that stops at the zebra and for people, 22 parked cars, walkers on both pavements, a crosser, people at the bus stop, café, meeting room and site; swaying palms, café fans, a windsock | Done |
| Network Vision (N): grade, 1 m heatmap with −67 / −75 / −100 dBm contours, belief · truth · error (Shift+N), tunnel tube, packets on every hop, sectors, beacons, backhaul, anchor, satellites, trust holograms, edge countdown | Done |
| HUD (plan §8): scene title, comparison strip with edge-seen / Wi-Fi-dies markers, Vision tag + legend, hints, notifications, rotating minimap, captions | Done |
| Phone (Infinet OS), peeking bottom-right: Infinet, Networks, Call, Map, Shield, Lab, Sim notes, Credits | Done |
| Modes: free roam, tour (T), attract (45 s idle), slow-mo, fast travel | Done |
| Booth hardening: offline, auto-reload on error / WebGL loss, F9 reset | Done · `npm run qa` 14/14 PASS (61 fps headless; 60 fps in every zone) |
| Batch: 300 runs × 3 scenarios + property test | Done → `results/2026-11-04/SUMMARY.md` |
| Screenshots (17 beats, Reality and Vision) | Done → `results/shots/` (old style-guide shots kept in `results/shots-styleguide/`) |
| Hosting for feedback: public repo github.com/Ahmed7AK/Infinet, live at https://infinet-sim.vercel.app (redeploys on every push to main), first-load progress screen | Done |
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

- [x] **People.** Done with Microsoft Rocketbox (MIT, no login) instead of Mixamo: 14 rigged people and 17 clips (idle, look around, talk, texting, phone call, sitting at a chair, sitting at a table, walk, run). The Blender mannequin is gone.
- [ ] Optional: a typing-at-a-keyboard clip (Rocketbox has none; the office workers use "sitting at a table"). Mixamo's "Typing" is the fallback; it needs an Adobe login and its licence recorded in CREDITS.md.
- [x] Poly Haven furniture and street clutter (38 CC0 models: bistro sets, round tables, dining chairs, bar stools, plants, desk lamps, sofa, lounge chair, shelves, drawers, hydrants, utility boxes, AC units, barriers, generator, drums, monobloc chairs, picnic table, scrub, rocks …).
- [x] Indoor shadows (ceiling light under a roof), contact shadows under people, 4096 px sun shadows; framed, reflective windows, shopfronts and floor bands on the buildings.
- [x] More furniture and life (third pass): remodelled saloon, SUV and pickup; moving traffic; 23 more people and 10 more clips; 29 more Poly Haven models; office chairs, bus shelter, bins, crossing signs, water cooler, printer, whiteboard, display, windsock; lit monitors. `?cam=x,y,h,lookX,lookY,lookH` fixes the camera for checking a spot.
- [ ] Optional: Sketchfab CC-BY models for what Poly Haven lacks (cars, date palms, office chairs, monitors). Needs a Sketchfab account and API token in `.env.local` (add it to `.gitignore` first). Check every model for brand badges.
- [ ] **Logo.** No longer on the simulation HUD (scene title top-left instead). If it is wanted on the attract screen, use the master SVG; the wordmark is artwork, so don't retype it.
- [ ] **Voice.** A teammate records about 20 s of speech, saved as `public/audio/voice.ogg` (CC0 or our own). The WebAudio placeholder is used until then.
- [ ] Render the full backup video (`npm run cinematic`, about 15 min) and copy it to the booth laptop.
- [ ] Booth rehearsal on the actual laptop and display: check the fps overlay (F10) and the text size from 2 m.
- [ ] Optional: a live bridge to the real Infinet prototype (Rashid). Not built.

## Not built (by choice, see DECISIONS.md)

- Highway moment (D5, cut).
- Physics engine (Rapier): the walk needs only 2D wall tests.

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
- The minimap repaints its 240 m belief map each time you move 20 m (about 15k map samples, a few ms).
- Rocketbox people are 2020 game-quality characters: fine at play distance, plain close up. Hair cards get a little self-illumination so they don't go black under AO.
- There is no female phone-call clip in Rocketbox; only the (male) player and NPCs who text use the phone.
- three.js logs "PCFSoftShadowMap has been removed" (it falls back to PCF) and a deprecation for `THREE.Clock` from R3F; both are harmless.
