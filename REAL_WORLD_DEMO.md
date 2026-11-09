# Showing it works in the real world

The question we will get most is "this is a simulation, does any of it work for real?" These are ways to answer it with something real at the stand, ranked by what each one proves for the effort. Venue data stays in `venue-private/`, as always.

## Tomorrow morning: the live hotspot test (go / no-go, 15 minutes)

The Mac scanner (`tools/scanner-mac`) feeds the real Wi-Fi around the laptop into the sim. Infinet screens a phone hotspot named `Infinet-Demo-…` for real; the probe is still simulated. This has only been tested with `--fake` so far.

1. Booth laptop, plugged in, with `venue-private/` present. Run `tools/scanner-mac/build.sh`, then `open "tools/scanner-mac/build/Infinet Scanner.app"`. Allow **Location** when asked; without it macOS hides every Wi-Fi name.
2. **Phone A:** turn on a hotspot named `Infinet-Demo-Hotspot` with a password. It should appear beside the walker within a few seconds and be checked.
3. **Phone B:** turn on a second hotspot with the **same name and no password**. Expected: **Blocked** ("same name, a different device, no password").
   - An iPhone hotspot always has a password and is named after the phone (Settings › General › About › Name). So the open copy has to come from an **Android** phone.
   - If the copy also has a password, expect **Tunnel only**, not Blocked: that is one red flag (new device). It takes a high flag such as the downgrade to block.
4. **Pass if** both hotspots show up within 10 s, the copy is Blocked within 10 s, no other network shows a name, and the frame rate (F10) stays above about 40.
5. **If any of that fails, drop it.** Don't open the scanner app; run the normal booth build (`npm run build`, `npm run preview`) and leave the live scan out of the pitch. The film and the four scenes don't depend on it.

## Ideas, ranked

| # | Idea | What it proves | Effort | Needs |
|---|---|---|---|---|
| 1 | **Replay our survey through the screening code.** Feed the 28 scans we recorded on set-up day into the same `redFlags()` and `screen()` the sim uses (`src/engine/trust/trust.ts`), and show what Infinet would have said about every network in the hall: the venue Wi-Fi goes to "sign-in page, checking", hotspots and devices are never joined. | The screening runs on real scan data, not only on our scripted attacker. | 1–2 h | Survey files (private), a small script |
| 2 | **Leave-one-out check of the hall map.** Refit the radio model 27 times, each time without one survey point, and predict the point left out. Quote the median error. | Answers "you fitted the map to the same points you show." | 1 h | Survey files |
| 3 | **Time a real call freeze.** Two phones on a WhatsApp call; walk one from the venue Wi-Fi out of range. Stopwatch the freeze and film it on a third phone. | A real number next to the simulated 6.6 s for today's phone. | 30 min | 3 phones |
| 4 | **Ping and loss, Wi-Fi vs 4G, at the stand.** `ping -c 100` from the laptop on the venue Wi-Fi and on a phone tether. | The latency and loss we simulate are in the right range for this building. | 10 min | Laptop, phone |
| 5 | **Time the venue Wi-Fi join.** From tapping the network to an address (DHCP) to the sign-in page. | The "sign-in page" moment in the hall scene, with a real number. | 10 min | A phone |
| 6 | **Re-survey with the crowd in** (the Android survey app, 10 points). Compare with set-up day: how many more hotspots per spot? | The sim's ~20 hotspots per spot, checked on show day. Rebuild with `tsx venue-private/hall/plan.mts` then `tsx tools/venue/build.ts`. | 30 min + rebuild | Android phone, the team code |
| 7 | **A real WireGuard handover.** A phone with WireGuard to a small cloud server; mid-call, turn Wi-Fi off. WireGuard carries on over 4G with no reconnect. | The tunnel half of Infinet is real, off-the-shelf technology. | 2 h | A cloud server. **Ask a mentor before sending UDP over the venue Wi-Fi.** |
| 8 | **Let a judge start the copy themselves** (only if the morning test passes). Hand them the Android phone with the open hotspot ready. | Not staged: the verdict comes from their phone. | 0 | Morning test passed |
| 9 | **Know our honesty number.** Of 163 settings in `params.ts`, 96 are marked ASSUMPTION and 14 are flagged "to verify"; all are listed in the phone's Sim notes. The hall's radio is fitted to our survey (5 GHz within 3.8 dB RMS). | We know exactly what is measured, cited or assumed. | 0 | — |

## Lines for the judges

- "The behaviour is simulated; the environment isn't. The hall's Wi-Fi is fitted to our own 27-point survey, and the screening is the same code that would run on a phone."
- "Every number in the film comes from 300 randomised runs per scene, the same walk and the same radio for every phone."
- "The tunnel (WireGuard-style) is existing technology. What we add is when to move, and which networks are allowed to carry the call."
