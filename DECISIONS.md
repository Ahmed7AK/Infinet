# Decisions

The plan (`INFINET_3D_SIM_PLAN.md`, §4.1) is the default. This file records what was decided and every override. Ahmed has the final say.

## Plan decisions as built

| # | Topic | As built | Notes |
|---|---|---|---|
| D1 | Phone UI | **Plan §8.4 as built.** The Infinet OS phone sits bottom-right and peeks 12 % above the edge when lowered (↑ or click raises it). Six apps: Infinet, Networks, Call, Map, Shield, Lab (+ Sim notes, Credits). Dark glass, lucide icons. | Raised it is 760 px high at 9 : 19.5 (70 % of the screen height, not the plan's ≈ 46 %), so its text stays ≥ 15 px at 1080p. Original look, no iOS/Android chrome. |
| D2 | Camera | **Third person, over the right shoulder (plan D2).** Follows the walking direction; drag to look (mouse look without a pointer-lock banner at the booth). The boom collides with walls and buildings; indoors it stays under the ceiling. In Network Vision it pulls back and up and the ceilings are cut away. Palm crowns and lamp posts hide when the camera passes through them. | Drag instead of pointer lock: a click-to-lock prompt confuses visitors and Esc is the phone's back key. |
| D3 | Realism | **Plan D3 grounded realism (Ahmed, 4 Nov: "discard the style guide … go with a more realistic vision").** Poly Haven HDR skies light the scene; the sun is found in each HDRI, clamped out of the image-based light and re-added as a shadow-casting directional light with the measured energy. PBR textures in real metre scale, Blender-built props, AgX tone mapping, N8AO ambient occlusion, bloom on emissive network objects only, SMAA. | The style guide stays the brand's (poster, slides); the simulation no longer follows it. See the override table. |
| D4 | Engine language | TypeScript, pure, DOM-free (ESLint rule + a Node test enforce it). Same engine in the browser and in `npm run batch`. | |
| D5 | World layout | One coordinate frame: office → street → café; desert site is a separate chunk at x ≈ 12 km reached by fast travel. **Highway cut** (optional moment, not built). | |
| D6 | Interaction | Free roam + Tour (T) + Attract (45 s idle). | |
| D7 | Comparison | One world, two policies on identical conditions (common random numbers). Comparison strip top-centre (two lanes over the last 30 s, frozen · voice lost · MOS, "edge seen" / "Wi-Fi dies" markers); C cycles B1/B2/B3. | |
| D8 | Renderer | three r186 via React Three Fiber 9, WebGL2. | |
| D9 | RF geometry | All walls come from `src/world/layout.json`; the renderer extrudes the same polylines the propagation model uses. | |
| D10 | Desert | Site router with LEO primary and GEO backup serving Site-Net Wi-Fi. | |
| D11 | Café attack | Real `Cafe_Guest` is open with a captive portal; the copy is an open copy with the same name, stronger, with optional forged disconnects. The copy has no portal (it wants traffic to flow). | |
| D12 | Audio | Synthetic placeholder voice (a WebAudio formant buzz shaped by the jitter-buffer output) until a teammate's recording is added at `public/audio/voice.ogg`. | See PROGRESS.md. |

## Overrides and judgement calls during the build

| Date | Decision | Why |
|---|---|---|
| 4 Nov | **Style guide look over the plan's realism** (Ahmed's choice). | The poster and style guide were already submitted with this look. Consistent brand at the booth. |
| 4 Nov | Repo root is `~/code/Infinet` (not `infinet-sim/`). | Ahmed asked for that folder. `package.json` name is `infinet-sim`. |
| 4 Nov | Dropped Rapier, postprocessing, N8AO. | No bloom/AO in the style guide; collisions are simple wall tests in 2D. |
| 4 Nov | Words: **"Tunnel only"**, not "Pipe only", on screen. Engine tier id stays `pipe`. | Style guide states. |
| 4 Nov | One 5G monopole (Cellular A, 3 sectors) and one rural RMa site for the desert. No rooftop small cell. | Enough to show the exit moment; fewer parameters to defend. |
| 4 Nov | 5G path loss uses 3GPP TR 38.901 **NLOS** (max with LOS) everywhere. | Conservative; a city street is mostly NLOS to a monopole 200 m away. |
| 4 Nov | LEO reconfiguration spike treated as an extra **one-way** delay of 30–80 ms. | Published measurements report RTT spikes; we split them to one direction to stay conservative. |
| 4 Nov | LEO learner uses per-frame **relative transit** (RFC 3550 style) instead of sparse probes. | 50 samples/s finds the 15 s period reliably (20/20 seeds); probes at 1 Hz did not. |
| 4 Nov | Desert LEO outage moved from t = 64 s to **t = 79 s** (duration 100 s). | Gives the learner time to show protected spikes before the failover. |
| 4 Nov | Phone position error is a sum of 3 slow sinusoids (σ ≈ 1.5 m, periods 20–45 s). | White noise made heading jumpy and produced a false edge warning at t = 0.2 s. |
| 4 Nov | Wi-Fi maps get a **wall-aware** 0.5 m diffraction blur. | Removes grid speckle without leaking signal through walls. |
| 4 Nov | No real logo file available: a text placeholder lockup is used. | The wordmark is artwork and must not be retyped in production. TODO in PROGRESS.md. |
| 4 Nov | RSSI **trend only counts within 10 dB of the threshold** (`trendMaxGapDb`). | Far from the edge the slope is just fading; extrapolating it fired a false "Wi-Fi edge" at t ≈ 1–11 s. Now seed 26 warns at 17.0 s and switches at 18.9 s. |
| 4 Nov | **Demo seeds** chosen near the batch median: exit 26, café 21, desert 16. | Seed 7 was atypical (Infinet froze on weak indoor 5G). The booth should show the typical run, not the best one. The batch reports all seeds. |
| 4 Nov | drei `<Html>` replaced by one DOM **label layer** projected per frame. | Per-label React roots threw `removeChild` on unmount under React 19, which would trigger the booth auto-reload. |
| 4 Nov | Trust cards are placed beside their network and **clamped** to the clear area between the panels. | Cards were clipped by the left panel or sat under the caption. |
| 4 Nov | HUD panels are opaque (`--night`). | World labels showed faintly through 92 % panels. |
| 4 Nov | **Minimap not built**; the phone's Map app shows the belief map instead. | Avoids a third map on screen; the HUD budget is already full at 1080p. |
| 4 Nov | Cinematic capture steps the driver by real 1/fps per frame (not sim time). | Slow-mo plays as slow-mo; output is deterministic for a given seed. No audio track. |
| 4 Nov | Satellite card and GEO label show the **latest measured** round trip, not SRTT; the "GEO-like" wording comes from the measured RTT (> 450 ms), not from the router's true uplink. | SRTT lagged the failover by many seconds (showed 241 ms on GEO). Reading `truth.uplink` broke P5. |
| 4 Nov | **Realistic look replaces the style-guide look for the simulation** (Ahmed: "The style guide was created for general brand image … the simulation must look realistic"). Reverses the earlier "Style guide look" choice. | The plan's D3 grounded realism, §7 Network Vision and §8 HUD are now the guide. |
| 4 Nov | Back to **"Pipe only"** on screen (plan §7.1 badges: ✓ Trusted / ~ Pipe only / ✕ Blocked). | "Tunnel only" was a style-guide word. |
| 4 Nov | **postprocessing + N8AO added back**; Rapier still not used. `@react-three/postprocessing` 3.2.1, not the plan's 3.2.2 (3.2.2 was under two weeks old). | Collisions remain simple 2D wall tests; no physics needed for a walk. |
| 4 Nov | **Props are Blender-scripted** (`tools/blender/build_all.py`, 27 GLBs, 1 MB), not downloaded. | Ahmed's choice. Reproducible, no licence questions, exact dimensions (AP sizes, 42U rack, 30 m monopole with −4° downtilt). |
| 4 Nov | **Placeholder mannequin** (Blender, rigid parts under named joints, walk/sit/phone poses in code). Mixamo character later. | Ahmed's choice. Checklist in PROGRESS.md. *Superseded 5 Nov (Rocketbox).* |
| 5 Nov | **People are Microsoft Rocketbox (MIT)**, not Mixamo: 14 people (Gulf dress, business and casual) and 17 clips. | Ahmed approved. No login, an open licence that fits the CC0/CC-BY/MIT rule, and the clips the plan lists (walk, run, texting, phone call, sitting) except typing. |
| 5 Nov | **Furniture and street clutter are Poly Haven models (CC0)**, 22 of them; network hardware, cars, palms, lamps, desks and the café counter stay Blender-scripted. | Ahmed approved. Downloaded hardware is almost always a real product with a logo (a LEO dish would look like a known brand). |
| 5 Nov | Each Rocketbox clip is its own GLB, exported from its own skeleton. | Each clip FBX stores its first pose as the rest pose and keys bones relative to it; moved onto one shared skeleton, the seated clip played as standing. |
| 5 Nov | The player holds the phone with an upper-body layer: at the ear on the call while the phone UI is down, texting while it is up or the call has dropped. | One walking clip + two arm/head layers instead of walk-while-texting clips the library does not have. |
| 5 Nov | Shipped assets 37 → 71 MB (Poly Haven models 19 MB, people 12 MB at 512 px textures, the player at 1024 px). | Still loads from disk in about a second; QA 14/14 at 61 fps headless. |
| 4 Nov | **Poly Haven CC0 downloads**: 2 HDRIs (clear midday for the city, low golden sun for the desert) and 7 texture sets: 35 MB shipped (a dusk sky and two unused texture sets were dropped). | Ahmed approved the downloads. A dusk sky was tried for the desert and dropped: almost no direct sun, so the scene went flat. |
| 4 Nov | Street sun at azimuth 150° (late morning), office 200°, desert 252°. | With a low western sun the café street sat entirely in the buildings' shadow. |
| 4 Nov | Network Vision grade keeps the network layer in colour with a **half-res mask pass** (world as depth only, then the network layer on its own three.js layer). | A plain luminance key also kept bright sky and white walls saturated; the mask keeps walls hiding the network. |
| 4 Nov | Vision heatmap: 128 m window at 1 m, a 5 × 5 blur before contouring, updated over 4 frames. Map-error view leaves < 2 dB neutral. | Shadow fading made the −67 / −75 dBm contours speckle. |
| 4 Nov | **Minimap built** (bottom-left, plan §8.3): belief map only, turns with the camera, dashed amber predicted edge, never the attacker. | Replaces the earlier "not built" decision now that the panels are gone. |
| 4 Nov | Satellite card and Map-freshness slider removed from the HUD. | Satellite numbers live in the phone's Infinet app; staleness is in Lab. |
| 4 Nov | The logo is no longer on the sim HUD. | The scene title takes the top-left; the brand stays on the booth's printed material. |
