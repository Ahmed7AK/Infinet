# Credits

Only CC0 / CC-BY / OFL / MIT / ISC-style licences. No real brand logos, operator names or game assets.

## Skies and textures (Poly Haven, CC0)

Downloaded by `tools/assets/fetch-polyhaven.ts` (raw files in `assets-src/downloads/`, not shipped).

| File | Source | Licence | URL |
|---|---|---|---|
| public/hdri/midday.hdr | Poly Haven `kloofendal_43d_clear_puresky` (2k) | CC0 | https://polyhaven.com/a/kloofendal_43d_clear_puresky |
| public/hdri/golden.hdr | Poly Haven `qwantani_late_afternoon_puresky` (2k) | CC0 | https://polyhaven.com/a/qwantani_late_afternoon_puresky |
| public/textures/asphalt/ | Poly Haven `asphalt_02` (2k) | CC0 | https://polyhaven.com/a/asphalt_02 |
| public/textures/paving/ | Poly Haven `rectangular_paving` (1k) | CC0 | https://polyhaven.com/a/rectangular_paving |
| public/textures/terrazzo/ | Poly Haven `terrazzo_tiles` (1k) | CC0 | https://polyhaven.com/a/terrazzo_tiles |
| public/textures/wood/ | Poly Haven `wood_floor` (1k) | CC0 | https://polyhaven.com/a/wood_floor |
| public/textures/sand/ | Poly Haven `coast_sand_01` (2k) | CC0 | https://polyhaven.com/a/coast_sand_01 |
| public/textures/paint/ | Poly Haven `painted_plaster_wall` (1k) | CC0 | https://polyhaven.com/a/painted_plaster_wall |
| public/textures/concrete/ | Poly Haven `concrete_floor_02` (1k) | CC0 | https://polyhaven.com/a/concrete_floor_02 |

## 3D models

### Poly Haven models (CC0)

Downloaded as 1k glTF by `tools/assets/fetch-polyhaven.ts`, then decimated to a triangle budget and re-encoded (WebP where it converts cleanly) by `tools/blender/import_polyhaven.py`.

| File | Source | Licence | URL |
|---|---|---|---|
| public/models/ph_bistro_set.glb | Poly Haven `outdoor_table_chair_set_01` | CC0 | https://polyhaven.com/a/outdoor_table_chair_set_01 |
| public/models/ph_stool.glb | Poly Haven `metal_stool_01` | CC0 | https://polyhaven.com/a/metal_stool_01 |
| public/models/ph_pendant.glb | Poly Haven `modern_ceiling_lamp_01` | CC0 | https://polyhaven.com/a/modern_ceiling_lamp_01 |
| public/models/ph_vase.glb | Poly Haven `ceramic_vase_02` | CC0 | https://polyhaven.com/a/ceramic_vase_02 |
| public/models/ph_planter.glb | Poly Haven `planter_box_01` | CC0 | https://polyhaven.com/a/planter_box_01 |
| public/models/ph_plant_tall.glb | Poly Haven `potted_plant_01` | CC0 | https://polyhaven.com/a/potted_plant_01 |
| public/models/ph_plant_wide.glb | Poly Haven `potted_plant_02` | CC0 | https://polyhaven.com/a/potted_plant_02 |
| public/models/ph_sofa.glb | Poly Haven `sofa_02` | CC0 | https://polyhaven.com/a/sofa_02 |
| public/models/ph_coffee_table.glb | Poly Haven `modern_coffee_table_01` | CC0 | https://polyhaven.com/a/modern_coffee_table_01 |
| public/models/ph_armchair.glb | Poly Haven `modern_arm_chair_01` | CC0 | https://polyhaven.com/a/modern_arm_chair_01 |
| public/models/ph_shelves.glb | Poly Haven `steel_frame_shelves_01` (rescaled to 1.8 m) | CC0 | https://polyhaven.com/a/steel_frame_shelves_01 |
| public/models/ph_cabinet.glb | Poly Haven `modern_wooden_cabinet` | CC0 | https://polyhaven.com/a/modern_wooden_cabinet |
| public/models/ph_hydrant.glb | Poly Haven `fire_hydrant` (clean copy only) | CC0 | https://polyhaven.com/a/fire_hydrant |
| public/models/ph_utility_box.glb | Poly Haven `utility_box_01` | CC0 | https://polyhaven.com/a/utility_box_01 |
| public/models/ph_manhole.glb | Poly Haven `water_manhole_cover` | CC0 | https://polyhaven.com/a/water_manhole_cover |
| public/models/ph_aircon.glb | Poly Haven `exterior_aircon_unit` (clean copy only) | CC0 | https://polyhaven.com/a/exterior_aircon_unit |
| public/models/ph_barrier.glb | Poly Haven `concrete_road_barrier_02` | CC0 | https://polyhaven.com/a/concrete_road_barrier_02 |
| public/models/ph_jerrycan.glb | Poly Haven `metal_jerrycan` | CC0 | https://polyhaven.com/a/metal_jerrycan |
| public/models/ph_crate.glb | Poly Haven `wooden_crate_01` | CC0 | https://polyhaven.com/a/wooden_crate_01 |
| public/models/ph_box.glb | Poly Haven `cardboard_box_01` | CC0 | https://polyhaven.com/a/cardboard_box_01 |
| public/models/ph_power_cabinet.glb | Poly Haven `utility_box_02` | CC0 | https://polyhaven.com/a/utility_box_02 |
| public/models/ph_rocks.glb | Poly Haven `namaqualand_rocks_01` (scaled up in the scene) | CC0 | https://polyhaven.com/a/namaqualand_rocks_01 |

### People and animation (Microsoft Rocketbox, MIT)

Microsoft Rocketbox Avatar Library, © 2020 Microsoft, MIT licence (full text shipped at `public/models/people/LICENSE-Rocketbox.md`). https://github.com/microsoft/Microsoft-Rocketbox

Fetched by `tools/assets/fetch-rocketbox.ts` (only the files used), converted by `tools/blender/import_rocketbox.py` (textures resized, hair texture edges filled, clips trimmed and slimmed).

| File | Rocketbox source |
|---|---|
| people/player.glb | Male_Adult_08 |
| people/office_f1, office_m1, office_m2, office_f2, office_m3 | Business_Female_01, Business_Male_06, Male_Adult_21, Female_Adult_09, Business_Male_02 |
| people/street_m1, street_f1, barista | Male_Adult_19, Female_Adult_10, Male_Adult_09 |
| people/cafe_f1, cafe_m1, cafe_f2, cafe_m2 | Female_Adult_14, Male_Adult_02, Female_Adult_08, Male_Adult_11 |
| people/site_m1 | Male_Adult_05 |
| people/anim_{m,f}_*.glb | `all_animations_max_motextr_static` and `_xy`: idle_neutral_01, idle_look_around_01, gestic_talk_neutral_01, cell_phone_textmessage, cell_phone_talk_01 (male only), sit_chair_idle_neutral_01, sit_table_idle_neutral_01, walk_neutral_01, run_neutral_01 |

### Blender-scripted (this project)

The other 23 GLBs in `public/models/` are built for this project by script in Blender 5.1 (`tools/blender/build_all.py`): access points, USB adapter, laptop, phone, 42U rack, 5G monopole, GEO dish, LEO terminal, site router, satellites, gateway, desks, meeting table, café counter, car, palm, street lamp, bollard, bench, 20 ft container office and generator. Generic shapes only, no real product or brand. The network hardware stays scripted on purpose: downloadable models of these are almost always real products with logos.

## Fonts (SIL Open Font License 1.1, bundled via Fontsource, no CDN)
- Inter — Rasmus Andersson
- JetBrains Mono — JetBrains

## Icons
- Lucide (ISC licence), via `lucide-react`.

## Code libraries (MIT unless noted)
three.js, @react-three/fiber, @react-three/drei, @react-three/postprocessing, postprocessing (Zlib), N8AO (ISC), React, zustand, Vite, Vitest, TypeScript, Playwright (Apache-2.0).

## Audio
- UI tones and the placeholder call voice are synthesised with WebAudio at runtime (no files).
- TODO: a teammate's own recorded voice (`public/audio/voice.ogg`), recorded by the team, so no third-party rights.

## Data and models (cited in the phone's Lab → Sim notes)
3GPP TR 38.901, ITU-T G.107 / G.113, IEEE 802.11, RFC 6298, RFC 2198, RFC 3550, published LEO/GEO latency measurements, and UMons app-reconnect measurements. See `src/engine/params.ts` for the source of every number.
