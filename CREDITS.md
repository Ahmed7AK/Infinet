# Credits

Only CC0 / CC-BY / OFL / MIT-style licences. No real brand logos, operator names or game assets.

## Fonts (SIL Open Font License 1.1, bundled via Fontsource, no CDN)
- Chakra Petch — Cadson Demak
- IBM Plex Sans, IBM Plex Mono — IBM
- IBM Plex Sans Arabic — IBM (not bundled yet; Arabic text is not used on screen)

## Code libraries (MIT)
three.js, @react-three/fiber, @react-three/drei, React, zustand, Vite, Vitest, TypeScript, Playwright.

## 3D models, textures, HDRIs
None. The style guide's world is procedural: every wall, floor, tile and coverage cell is generated from `src/world/layout.json` and the radio model.

## Icons
Pixel icons are drawn in code on a 12-cell grid (`src/app/ui/icons.tsx`) after the style guide's icon set.

## Audio
- UI tones and the placeholder call voice are synthesised with WebAudio at runtime (no files).
- TODO: a teammate's own recorded voice (`public/audio/voice.ogg`), recorded by the team, so no third-party rights.

## Data and models (cited in Lab → Sim notes)
3GPP TR 38.901, ITU-T G.107 / G.113, IEEE 802.11, RFC 6298, RFC 2198, RFC 3550, published LEO/GEO latency measurements, and UMons app-reconnect measurements. See `src/engine/params.ts` for the source of every number.
