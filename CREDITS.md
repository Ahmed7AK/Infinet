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

All 27 GLBs in `public/models/` are built for this project by script in Blender 5.1 (`tools/blender/build_all.py`): access points, USB adapter, laptop, phone, 42U rack, 5G monopole, GEO dish, LEO terminal, site router, satellites, gateway, office and café furniture, car, palm, street lamp, bollard, bench, 20 ft container office, generator, rock and the placeholder mannequin. No third-party models. Generic shapes only, no real product or brand.

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
