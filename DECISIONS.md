# Decisions

The plan (`INFINET_3D_SIM_PLAN.md`, §4.1) is the default. This file records what was decided and every override. Ahmed has the final say.

## Plan decisions as built

| # | Topic | As built | Notes |
|---|---|---|---|
| D1 | Phone UI | **Kept, as an extra overlay.** The style guide's demo screen puts two 420 px phone *panels* (Today's phone / Infinet) on the left and right. The Infinet OS phone with 6 apps opens from the Infinet panel (↑), so the panels stay the main read and the phone is for "why?". | Original visuals, edge-cut corners, no iOS/Android/Rockstar look. |
| D2 | Camera | **Three-quarter view about 35° down, following with soft damping** (style guide p. 21). Not over-the-shoulder. | The style guide overrides the plan here. No first person. |
| D3 | Realism | **Overridden by the style guide (Ahmed chose "Style guide look", 4 Nov).** Night ground with a 1 m survey grid, extruded floor plans with 1.5 m cut-away walls, flat coverage cells in fixed dBm bins, pixel-icon tiles on poles, one fixed light, flat shading, no bloom/glow/fog, `NoToneMapping`, HTML labels. | So no HDRIs, no PBR, no postprocessing. Network Vision becomes "Simulation view": what changes is *which map* is shown (belief vs truth vs error), not the grade. |
| D4 | Engine language | TypeScript, pure, DOM-free (ESLint rule + a Node test enforce it). Same engine in the browser and in `npm run batch`. | |
| D5 | World layout | One coordinate frame: office → street → café; desert site is a separate chunk at x ≈ 12 km reached by fast travel. **Highway cut** (optional moment, not built). | |
| D6 | Interaction | Free roam + Tour (T) + Attract (45 s idle). | |
| D7 | Comparison | One world, two policies on identical conditions (common random numbers). Bottom handover timeline (140 px), C cycles B1/B2/B3. | |
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
