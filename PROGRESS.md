# Progress · 10 Nov 2026

## Status

| Area | State |
|---|---|
| Engine: radio, maps, prediction, trust, LEO/GEO, voice, policies B1/B2/B3/Infinet + ablations | Done · 68 tests pass (10 Nov) |
| Security spec v1.0: six verdicts (Checking · Trusted · Tunnel · Unreachable · Blocked · Unchecked), weighted red flags (one flag caps at Tunnel; two high, or high + medium, blocks), probe with max(1 s, 3 × RTT) timeouts, anchor down fails closed, beacon-flood freeze, deauth falls back to the warm 5G tunnel at once | Done · `tests/security.test.ts`; table in DECISIONS.md |
| Scenarios: leaving the building, fake café Wi-Fi, desert site | Done · demo seeds 26 / 21 / 16 (near median) |
| **Scene 4: our venue hall** (private data, booth laptop only): the hall rebuilt from the organisers' plans and styled from our set-up-day photos (65 stand pairs with ring number signs, posters, cabinets and stools; lavender carpet, pixel hoardings, black drapes; stage with truss, framed LED wall and round LEDs; 937 shell chairs, 178 people, ceiling trusses and cluster lights), radio fitted to our 9 Nov survey (27 venue APs; 64 phone hotspots and 35 fixed devices placed one by one, ~20 and ~11 heard per spot as measured; one LTE cell, so the hall says **4G**), stand 31 labelled, survey points shown in Vision. The walk starts inside the hall and ends at our stand; on the booth build the tour (T, attract) visits it fourth and taps Sign in. Anonymous networks show their kind, band, channel, security and Wi-Fi generation, never a name. Key 4 or the "Our hall" chip | Done · `tests/venue.test.ts` (7 tests, run only where `venue-private/` exists); other scenes bit-identical with or without it |
| 3D world, realistic (plan D3): HDR skies with a measured, shadow-casting sun, an indoor ceiling light, PBR textures, 33 Blender-built and 67 Poly Haven props, 37 Rocketbox people, third-person camera with collision | Done |
| Life in the scene (scene-only, the engine never sees it): moving traffic (IDM) that stops at the zebra and for people, 22 parked cars, walkers on both pavements, a crosser, people at the bus stop, café, meeting room and site; swaying palms, café fans, a windsock | Done |
| Network Vision (N), restyled 5 Nov: navy grade that leaves network objects in colour, dot-grid heatmap with −67 / −75 / −100 dBm contours, beacons coloured by verdict, belief · truth · error (Shift+N), tunnel tube, packets on every hop, sectors, beacons, backhaul, anchor, satellites, trust holograms, edge countdown | Done |
| HUD (plan §8): scene title, comparison strip with edge-seen / Wi-Fi-dies markers, Vision tag + legend, hints, notifications, rotating minimap, captions | Done |
| Phone (Infinet OS), peeking bottom-right: Infinet, Networks, Call, Map, Shield, **Tunnel** (live diagram: Hamad → anchor → road → you, five stages, a caption that pops up when something happens), Lab (café attack variants, attacker mode, café blocks UDP, anchor server, anchor-down moment), Sim notes, Credits | Done |
| Modes: free roam, tour (T), attract (45 s idle), slow-mo, fast travel; scene jump (1 · 2 · 3, and 4 where the venue file is present, or the chips under the title) and M to skip to the moment | Done |
| Live Wi-Fi scan (spec §6): `tools/scanner-mac` (Swift menu-bar app, loopback-only server, token + Origin + Host checks), anonymises every non-`Infinet-Demo-` network before it leaves the app; the page checks again, places a new hotspot where the walker first heard it and screens it for real (probe simulated). `?live=replay` is a synthetic example for the hosted site | Done · tested with `--fake`; a real phone hotspot not yet tried at the booth |
| Booth hardening: offline, auto-reload on error / WebGL loss, F9 reset | Done · `npm run qa` 14/14 PASS again on 9 Nov with the venue build (fps that day was low on battery with another browser busy: café 46, hall 55; after the view culling, on battery headless: hall 60, hall Vision 43–60, café Vision 44) |
| Batch: 300 runs × 3 scenarios + property test | Done → `results/2026-11-10/SUMMARY.md` (rerun after Wi-Fi first; 2026-11-04 and 11-05 kept for comparison). Metrics that don't apply to a policy show n/a; new row: network switches per call |
| **Wi-Fi first** (10 Nov): a checked, unflagged Wi-Fi carries the call ahead of 5G, with flap damping; a **Sign in** card (and key L) the first time a network shows a sign-in page; the hall shows it | Done · `tests/venue.test.ts` sign-in test; batch rerun on 10 Nov (café: Infinet switches 2.75 per call, the unchecked tunnel 8.29) |
| Screenshots (17 beats, Reality and Vision) | Done → `results/shots/` (old style-guide shots kept in `results/shots-styleguide/`) |
| Hosting for feedback: public repo github.com/Ahmed7AK/Infinet, live at https://infinet-sim.vercel.app (redeploys on every push to main), first-load progress screen | Done |
| Cinematic recorder | Done (`npm run cinematic`); full video not yet rendered |
| **The judges' film** (10 Nov): title, the idea as a diagram, the three scenes (and the hall on the booth cut) with lower thirds and Vision fades, an animated results card from the batch, built · simulated · next, end card. `npm run film -- --cut public` → `media/infinet-film.mp4` (~75 s); `--cut booth` → `venue-private/media/infinet-film-booth.mp4` (~88 s, never pushed) | Done |
| Real-world demo ideas and the morning hotspot go / no-go → `REAL_WORLD_DEMO.md` | Written; nothing in it tried yet |

## Batch headline (results/2026-11-10, 300 runs per scenario, simulated)

| Scenario | Today's phone (B1) frozen, mean · p95 | Infinet frozen, mean · p95 | Calls survived B1 → Infinet |
|---|---|---|---|
| Leaving the building | 6.56 s · 18.96 s | 0.00 s · 0.00 s | 202 → 300 / 300 |
| Fake café Wi-Fi | 11.45 s · 24.92 s | 0.13 s · 0.00 s | 165 → 300 / 300 |
| Desert site | 12.68 s · 20.94 s | 4.96 s · 6.44 s | 60 → 300 / 300 |

- Property test: across 5,000 randomised runs (including the attacker's relay mode and deauth on/off), Infinet sent 0 voice frames over a fake, unchecked or Blocked network.
- Compared with 2026-11-05 (before Wi-Fi first): café Infinet 0.16 → 0.13 s frozen and 299 → 300 survived; exit unchanged; desert Infinet 5.15 → 4.96 s. Café switches per call: Infinet 2.75, the unchecked tunnel (B3) 8.29.
- Prediction switched a mean of 3.41 s before the Wi-Fi crossed −75 dBm (median 2.90 s).

**Read before quoting:**
- In the building exit, *Infinet without prediction* also freezes 0.00 s. What saves the call is checking before use plus duplicating over both paths. Prediction adds lead time (3.4 s) and a slightly lower voice loss (0.31 % vs 0.34 %), at the cost of more duplication (4.4 % extra data vs 2.4 % without it). Don't claim that prediction alone prevents the freeze.
- In the desert, Infinet still freezes about 5 s during the LEO outage (router failover 2–5 s). The win is that it never declares the link dead (0 false verdicts against B3's 10.4) and keeps the call. B3's longest freeze (5.6 s) is close to Infinet's (4.9 s).
- *Infinet without trust check* sends 295 voice frames per run to the copy (ciphertext only, inside the tunnel) and accepts the fake network in about half the runs (0.48). That's the ablation showing the trust check matters.
- Time to verdict: 5G 60 ms average (80 ms worst) leaving the building; café Wi-Fi 906 ms average but **23.7 s worst**. The worst case is likely a real network that stayed Unreachable through repeated retries; not yet investigated, so don't quote a café worst-case verdict time.

## TODO (needs a person or an asset)

- [x] **People.** Done with Microsoft Rocketbox (MIT, no login) instead of Mixamo: 14 rigged people and 17 clips (idle, look around, talk, texting, phone call, sitting at a chair, sitting at a table, walk, run). The Blender mannequin is gone.
- [ ] Optional: a typing-at-a-keyboard clip (Rocketbox has none; the office workers use "sitting at a table"). Mixamo's "Typing" is the fallback; it needs an Adobe login and its licence recorded in CREDITS.md.
- [x] Poly Haven furniture and street clutter (38 CC0 models: bistro sets, round tables, dining chairs, bar stools, plants, desk lamps, sofa, lounge chair, shelves, drawers, hydrants, utility boxes, AC units, barriers, generator, drums, monobloc chairs, picnic table, scrub, rocks …).
- [x] Indoor shadows (ceiling light under a roof), contact shadows under people, 4096 px sun shadows; framed, reflective windows, shopfronts and floor bands on the buildings.
- [x] More furniture and life (third pass): remodelled saloon, SUV and pickup; moving traffic; 23 more people and 10 more clips; 29 more Poly Haven models; office chairs, bus shelter, bins, crossing signs, water cooler, printer, whiteboard, display, windsock; lit monitors. `?cam=x,y,h,lookX,lookY,lookH` fixes the camera for checking a spot.
- [ ] Optional: Sketchfab CC-BY models for what Poly Haven lacks (cars, date palms, office chairs, monitors). Needs a Sketchfab account and API token in `.env.local` (add it to `.gitignore` first). Check every model for brand badges.
- [ ] **Logo.** No longer on the simulation HUD (scene title top-left instead). If it is wanted on the attract screen, use the master SVG; the wordmark is artwork, so don't retype it.
- [ ] **Voice.** A teammate records about 20 s of speech, saved as `public/audio/voice.ogg` (CC0 or our own). The WebAudio placeholder is used until then.
- [x] The judges' film is rendered (public and booth cuts, see above). The long backup video (`npm run cinematic`, about 15 min) is still optional.
- [ ] **Tomorrow morning: the live hotspot test** (`REAL_WORLD_DEMO.md`, top). If it fails, drop the live scan from the pitch.
- [ ] Booth rehearsal on the actual laptop and display: check the fps overlay (F10) and the text size from 2 m.
- [ ] **The booth build must include the hall.** Build on the laptop that has `venue-private/` (`npm run build`, then `npm run preview`): the hosted site and any other checkout have three scenes only. Check scene 4 (key 4) and Vision in the hall on the booth laptop, plugged in.
- [ ] Optional: re-survey on show day with the crowd in (the Android survey app), rebuild with `tsx venue-private/hall/plan.mts` then `tsx tools/venue/build.ts`.
- [ ] Optional: a live bridge to the real Infinet prototype (Rashid). Not built.
- [ ] **Live scan at the booth.** Build the scanner (`tools/scanner-mac/build.sh`), allow Location, and rehearse with two real phone hotspots named `Infinet-Demo-Hotspot` (start the WPA2/3 one first, then an open one with the same name). Only tested with `--fake` so far.
- [ ] Optional: Rashid's Linux scanner sends the same WebSocket messages (format in `tools/scanner-mac/README.md`).

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

- The hall's 2.4 GHz radio positions fit worse (10.3 dB RMS) than 5 GHz (3.8 dB): few points heard them. Survey points were tapped by hand and can be metres off.

- The HUD publishes at 10 Hz, so the timeline can lag the panels by up to 100 ms.
- The minimap repaints its 240 m belief map each time you move 20 m (about 15k map samples, a few ms).
- Rocketbox people are 2020 game-quality characters: fine at play distance, plain close up. Hair cards get a little self-illumination so they don't go black under AO.
- There is no female phone-call clip in Rocketbox; only the (male) player and NPCs who text use the phone.
- three.js logs "PCFSoftShadowMap has been removed" (it falls back to PCF) and a deprecation for `THREE.Clock` from R3F; both are harmless.
