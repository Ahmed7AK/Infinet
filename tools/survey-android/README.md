# Infinet Survey (Android)

Maps the Wi-Fi and mobile signal of a venue for the simulation's venue replica. You tap where you stand on a
floor plan; the phone records every network it hears there (signal, channel, band, security), the mobile cell
(4G/5G strength and quality) and, where access points support it, the distance to them (802.11mc ranging).

A browser can't do this (no web API lists Wi-Fi networks), so it is a small native app: a WebView page
(`assets/index.html`) plus a Java bridge (`src/…/MainActivity.java`). It **only listens**: it never joins, probes or
sends anything to a network. The optional latency check uses whatever internet connection the phone already has.

## Build and install

```bash
tools/survey-android/build.sh            # → tools/survey-android/build/infinet-survey.apk (no Gradle needed)
tools/survey-android/build.sh install    # build, then install on every phone plugged in with USB debugging on
```

Without a cable: send `infinet-survey.apk` to the phone (Quick Share, WhatsApp to yourself, Drive) and open it;
allow "install unknown apps" for that app when asked.

## Privacy

What is saved never contains other people's network names or addresses. Each access point and network is saved
as a salted HMAC id (the salt is the **team code**: use the same one on both phones so ids match). A name is
kept only for networks you **★ as the venue's own** and for our `Infinet-Demo-…` hotspots. Device addresses that
are locally administered (phones, hotspots) are flagged, so the simulation can draw them as anonymous dots.

The venue plans from the organisers are marked confidential: keep plans, photos and survey files in
`venue-private/` (git-ignored), never in the public repo or the hosted site.

## Field guide: mapping the hall

### Before you leave (5 minutes, both phones)
1. Install the app. Open it and allow **Location** and **Nearby devices**.
2. **Developer options → Wi-Fi scan throttling → off.** (Developer options: Settings → About phone → tap
   Build number 7 times.) Without this Android allows 4 scans every 2 minutes and the app warns you.
3. Location **on**, Wi-Fi **on** (you don't need to connect to anything).
4. Setup → **Team code**: type the same code on both phones (e.g. `infinet31`) and tap Set.
5. Charge both phones; bring a cable for the laptop.

### Roles at the venue
| Who | Phone | Job |
|---|---|---|
| Surveyor | Nothing Phone 1 | Walks the grid and records points (the main map) |
| Reference | realme C53 | Sits at stand 31 on charge, **Stay** mode: a point every 20 s all evening |
| Photographer | anyone's phone | Photos for the 3D model (list below) |

The reference phone tells us what changes with **time** (people arriving, rehearsal starting) so we don't
mistake it for changes with **place**.

### Step 1 · The plan (10 minutes)
1. Find the **fire evacuation plan** on a hall wall. Photograph it straight on, filling the frame, sharp.
   That's the most accurate floor plan you'll get. Send the photo to the other phone.
2. Setup → Floor plan → choose that photo (on both phones). The organisers' stand map
   (`venue-private/atp-stand-map.png`) is a fallback for the ATP area; or use Blank hall with the hall's size.
3. Setup → Scale → **Tap two points**: two things far apart that you can find on the plan *and* in the hall
   (two hall corners, two pillars, both ends of a wall). Then enter their real distance in metres. Measure it
   by counting floor or carpet tiles (measure one tile first; carpet tiles are usually 50 cm) or by pacing a
   known pace. Longer is better: 2 % error is fine.

### Step 2 · Start both phones side by side (2 minutes)
Put both phones together at stand 31. On each: tap stand 31 on the plan → **Record here**. Do the same again at
the end of the evening. That pair tells us how differently the two phones' radios read the same spot.

Then the realme stays at stand 31: tap stand 31 → **Stay**, plug it in, leave the app open.

### Step 3 · Walk the grid (60 to 90 minutes, the surveyor)
- Walk in **lanes** (like mowing a lawn) and record a point every **4 to 5 m**: about 3 to 4 big steps.
  The ATP area, the aisles, the main stage, registration and the link area are the priorities.
- At each spot: tap where you are, **stand still**, phone at **chest height**, screen up, facing the **main
  stage** every time. Tap **Record here** and wait for "Saved" (4 to 12 s). Same posture every point.
- Watch the status line: scans/min should be 15 or more. If the yellow throttling bar shows, fix step 2 first.
- Add points **out through the main exit** to 30 to 50 m outside, where the Wi-Fi fades. That's the
  "leaving the hall" moment in the simulation.
- Dots colour by signal (green strong, red weak); tap a name in **Networks** to colour by one network.
- **Networks → ★** the venue's own Wi-Fi (the name on the venue's signs). Don't ★ other teams' hotspots.
- Seen an access point (white box or disc on the ceiling, a column or a wall)? Stand under it, tap the spot,
  **Pin AP**, and photograph it. That checks the positions we compute from the signal.
- **Latency** (Export → Run latency check) at 3 to 4 spots: once on the venue Wi-Fi if you're allowed to join
  its guest network, once on mobile data (disconnect Wi-Fi but leave it on).
- Undo removes the last point (tap twice).

### Step 4 · Photos for the 3D hall (in parallel)
- Wide shots from **each corner** and the middle, landscape, from head height, slowly turning (overlapping).
- The **ceiling**: trusses, lights, height reference (a person or the stand panel next to a wall).
- Every access point you can see, with something of known size nearby.
- **Our booth** from four sides, and the panel with 31 (the panel is 905 mm wide, 2.4 m high: that's our
  scale reference).
- Entrances, registration, the main stage, floor and wall colours.
- A slow, steady video walk along the main aisles helps too.
- **No faces** where you can avoid it, and no other teams' screens (media consent rules in the notes).

### Step 5 · Before you leave (7:45 PM)
On both phones: **Export → Save and share** (files go to `Download/Infinet`). Then plug both phones into the
laptop: the files and photos get pulled into `venue-private/` and processed tonight.

```bash
adb pull /sdcard/Download/Infinet venue-private/survey
```

## What the file contains
`infinet-survey-<id>-<phone>-<n>pts.json`: the plan size and scale (metres per pixel), the team-code ids, names of
★ networks, and per point: position (`px, py` on the plan; `xM, yM` in metres from the plan's top-left), time,
crowd level, phone height, the median/min/max signal of every access point heard (id, group, network id,
band, channel, width, security, PMF, Wi-Fi standard, locally-administered flag, vendor prefix for
infrastructure APs), the mobile cells (LTE/NR, PCI, ARFCN, band, RSRP, RSRQ, SINR), any 802.11mc distances, plus
the pinned access points and latency checks. `planImage` (optional) is the plan as a data URL.
