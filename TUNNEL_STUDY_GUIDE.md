# Infinet tunnel and protocols: study guide

How Infinet keeps a call alive and safe while the phone moves between networks: the tunnel, the trust check, and how it picks a network. Read it before the booth so we all give the same answers.

> **Where this comes from.** These are the choices as built in the simulation (`src/engine/`), recorded in `DECISIONS.md` and the Security spec v1.0. Numbers come from `src/engine/params.ts`. Many are marked `ASSUMPTION` there, and this guide says so where it matters.

---

## 1. The big picture in one sentence

**Your phone → whichever networks are around (Wi-Fi, 5G/4G, satellite) → one encrypted tunnel → our anchor server → the person you're calling (Hamad in the demo).**

The networks only ever carry sealed packets to our anchor. A trust verdict only picks which network to use; encryption never stops.

The pitch line:

> "The tunnel (WireGuard-style) is existing technology. What we add is **when to move**, and **which networks are allowed to carry the call**."

Infinet has three parts:

| Part | What it does | Where in code |
|---|---|---|
| **Always-on tunnel** | Keeps the call the same call when the network changes, and hides it from the network | `policies/agent.ts` (`ensureTunnel`, `handshakeOutcome`) |
| **Trust gate** | Checks a network before it may carry the call | `trust/trust.ts`, `policies/infinet.ts` |
| **Prediction** | Sees the Wi-Fi edge coming on the coverage map and prepares the next network | `predict/predict.ts`, `predict/leoPattern.ts` |

---

## 2. The tunnel

### 2.1 What protocol, and why

We use a **WireGuard-style** tunnel. Background on WireGuard (general facts, not Infinet-specific):

- A modern VPN protocol built on the **Noise protocol framework**. Each side has a public/private key pair, and the handshake proves both sides hold their keys.
- Runs over **UDP**.
- The handshake takes **one round trip**: an initiation and a response.
- Packets that fail authentication are **dropped silently**: no error, no reply.
- It **roams** naturally: the session is tied to keys, not to an IP address. When the phone's address changes, the next authenticated packet tells the server where it is now.

That last point is the main reason for a tunnel. Without one, a new IP address breaks the call and the app has to reconnect. That's what today's phone does: about **1.6 s median**, and **~30 % of switches take over 10 s** (fitted to UMons iPhone MPTCP handover measurements). With the tunnel, the call doesn't notice the address changed.

### 2.2 Design choices for the tunnel

| Choice | What it means | Why |
|---|---|---|
| **Always in the tunnel** | Every voice frame goes through the tunnel on every network, even a Trusted one | A verdict can be wrong, for example the "perfect copy" attack. If everything is sealed, a wrong verdict still leaks nothing |
| **One tunnel per network** | Wi-Fi, 5G and satellite each get their own tunnel, each with its own handshake, all ending at the anchor | Lets us keep a backup ready, and send on two networks at once during a switch |
| **Pinned anchor key** | The phone knows the anchor's public key in advance | A network in the middle can't impersonate the anchor, so the handshake can't be faked |
| **Handshake = 1 round trip + ~15 ms** | 15 ms covers compute and a policy margin (`handshakeExtraMs`, ASSUMPTION) | Fast enough to do before the old network dies |
| **Anchor detour ~4 ms one-way** | The extra delay from routing through our anchor in an in-country cloud region (`anchorDetourMs`, ASSUMPTION) | The cost of the tunnel, and it's small |
| **Make-before-break** | The next network's tunnel is up *before* the current Wi-Fi fades | The switch costs no silence |
| **Fail closed** (Ahmed's call) | If the anchor is down, nothing leaves the tunnel. The call waits and drops after 8 s | We never fall back to sending the call in the clear |

### 2.3 Duplication during a switch

- For **2 s around a switch** (`dupHoldS`), the call is sent on **two tunnels at once**, one per network.
- Every packet has a **sequence number**. The receiving side keeps the first copy that arrives and drops the other.
- A network only joins if its delay fits the **playout deadline**, the time by which the voice has to be played (minus a 10 ms margin). A copy that would arrive too late is pointless.

On the phone's Tunnel app: *"For 2 s the call rides two tunnels, one per road. The anchor keeps the first copy of each packet and drops the other."*

### 2.4 Knowing when a network is dead (liveness)

- Each live network is checked **every 200 ms**, piggybacked on voice packets in practice (`keepaliveMs`).
- The timeout follows **RFC 6298**, the standard TCP retransmission timer: it tracks the smoothed round-trip time and its variance, and backs off exponentially.
  - Minimum 200 ms (RFC 6298 says 1 s; our ASSUMPTION for voice), maximum 3 s.
  - 3 expiries in a row → the network counts as dead.
- Compare **B3**, the "tunnel but no check" baseline, which works like today's commercial bonding tools: a **fixed** 300 ms timeout, and 3 misses means dead. On a satellite link, that calls a slow but healthy network dead.

### 2.5 Satellite: patient, not panicked

- On satellite, round-trip time is sampled **every 100 ms** from the tunnel's acknowledgements on voice packets.
- **LEO** (low orbit) has a known **15 s reconfiguration cycle** with short spikes of delay and loss (Mohan et al., WWW 2024). Infinet **learns the pattern** after at least 40 s of history and protects the call from about **300 ms before each predicted spike**, by deepening the jitter buffer for a moment.
- **GEO** (geostationary) is slow by physics: about 600–700 ms round trip. Timers stretch to match instead of calling the link dead.
- If LEO fails, the site router falls back to GEO. Infinet only decides the anchor is down when the network answers but a fresh anchor handshake doesn't, so a satellite failover is never mistaken for an anchor outage.

### 2.6 What the tunnel does *not* do (be honest)

- **It needs UDP.** If a network blocks UDP (many hotels and offices do), the probe gets no answer and the network is **Unreachable**: the call stays on 5G/4G. A TCP fallback is **not modelled** in the sim.
- The tunnel is **simulated**. Real-world proof would be idea #7 in `REAL_WORLD_DEMO.md`: a phone with WireGuard to a cloud server, Wi-Fi switched off mid-call.

---

## 3. The trust gate (before a network carries the call)

### 3.1 Stages

**Appears → Screen → Quarantine → Verdict → Roam**

1. **Appears:** the network shows up in a scan.
2. **Screen:** red flags are checked from the scan alone, before anything is sent.
3. **Quarantine:** a probe and canaries run through the network with a **separate probe key**, not the call's key.
4. **Verdict:** one of the five below.
5. **Roam:** if the verdict allows it, the call may move onto the network.

### 3.2 Verdicts

| Verdict | Meaning | May carry the call? |
|---|---|---|
| **Checking** | Still being checked, or it shows a sign-in page | No |
| **Trusted** | Known, expected network; handshake passed | Yes |
| **Tunnel only** | Passed the check but we can't vouch for it (e.g. a public café Wi-Fi) | Yes, if the probe passed and it has **no** red flags. With a flag: backup only |
| **Unreachable** | No answer (e.g. UDP blocked). Not treated as an attack | No; retried after 15 s |
| **Blocked** | It's a copy, or it tampered with traffic | Never |

Anonymous dots (other people's networks) are **Not checked** and never joined.

### 3.3 Red flags

| Flag | Level | What it catches |
|---|---|---|
| New device | medium | A known name on a device (address) we've never seen |
| Downgrade | **high** | A known name with weaker security than before, e.g. WPA2 → open |
| Weak encryption | medium | WEP, TKIP, WPA2/3 transition mode |
| Too strong | medium | Signal more than 12 dB above what our coverage map predicts for that spot |
| Look-alike name | **high** | e.g. `Cafe_Guest` vs `Cafe_Gue5t`, using the Unicode **UTS #39 skeleton** check for confusable characters |
| DNS canary | **high** | DNS answers through this network differ from the real ones |

**How flags combine:**
- **One flag** of any level → capped at **Tunnel only**.
- **Two high flags, or one high and one medium** → **Blocked before anything is sent**.

### 3.4 The probe and the canaries

- **Probe:** a handshake with the anchor (1 round trip) using a **separate probe key**.
  - **One or more packets that arrive but fail authentication → Blocked.** WireGuard drops these silently; our probe counts them. That's how we spot a network that tampers with traffic.
  - No answer → **Unreachable**, retried after 15 s (2 s for 5G).
- **Canaries**, run **in parallel** with the probe:
  - **TLS canary:** the certificate must match the one we pinned. A mismatch means someone in the middle → **Blocked**.
  - **DNS canary:** the answers must match.
  - **Sign-in page canary:** does the network show a sign-in page?
  - The TLS and sign-in page canaries need TCP + TLS 1.3 = **2 round trips**, so the slowest canary sets the check time.
- **Timeouts:** `max(1 s, 3 × typical round trip)`.
  - The 1 s floor comes from RFC 6298's initial timeout.
  - Typical round trip: **50 ms** for Wi-Fi and 5G, **650 ms** for satellite. Satellite gets more patience.

### 3.5 Sign-in pages (captive portals)

- The network stays at **Checking**. Only the sign-in page may open, sandboxed. The call stays on 5G/4G.
- A **Sign in** card appears (key **L** in the demo). Signing in is the user's own act, since the app can't accept the venue's terms for them. Infinet then **checks the network again at once**, and the call moves onto it if it passes.
- If the user doesn't sign in, it re-checks every 120 s.

### 3.6 Floods and other attacks

- **Beacon flood:** 8 or more new names within 5 s raises an alert. **No network is upgraded** until it settles; verdicts already made stand.
- **Forged disconnects (deauth):** possible on WPA2 without PMF (Protected Management Frames). When the café connection is knocked off, Infinet moves straight to any 5G network whose tunnel is already up, even a weak one.

### 3.7 The three café attacks (Lab)

The real `Cafe_Guest` is WPA2 with the password on the wall.

| Variant | What the attacker does | Result |
|---|---|---|
| **Open copy** (default) | Same name, new device, no password | New device + downgrade (no password) → **Blocked** in one scan |
| **Downgrade** | The café's own address, no password | One high flag → capped at Tunnel only; the probe decides |
| **Perfect copy** | The café's address *and* WPA2, possible because the password is public | Passes the screen and gets the café's Tunnel only verdict. **It only ever sees ciphertext.** Counted as `fakeAccepted` |

The perfect copy is why "always in the tunnel" matters: no check can tell it apart from the real café, but it still learns nothing.

---

## 4. Which network carries the call

- **Wi-Fi first, 5G as the backup** (team request, 10 Nov). A Wi-Fi network can carry the call if it's Trusted, or if it's Tunnel only with a passed probe and no flags. A flagged Wi-Fi network is backup only. The 5G tunnel stays up the whole time as the backup.
  - Why: 5G is weak indoors, and many people don't have unlimited data. The check and the tunnel are what keep the call safe, not the choice of network.
- **Flap damping** (modelled on RFC 2439, ASSUMPTION): after the call has to leave a Wi-Fi network, it waits **4 s** before going back, doubling each time up to **60 s**. 30 s of good service resets the wait.
  - Without it, the café ping-ponged 17 times in one run; with it, 6.
- **Prediction:** Infinet starts checking the next network when the Wi-Fi edge is **≤ 5 s** away on the map, and switches when the time left is **< 1.5 s**.
- **Enterprise Wi-Fi:** moving between access points of the same network uses **802.11r fast transition** (under 50 ms), so it isn't a "switch".
- **In the hall,** the mobile network is called **4G**, not 5G: our survey phones only ever saw LTE there.

---

## 5. The baselines we compare against ("Today's phone")

| Baseline | Behaviour |
|---|---|
| **B1** | Switches only after the Wi-Fi drops |
| **B2** | Joins the strongest signal with a saved name |
| **B3** | Tunnel, no check: keeps the call through a tunnel, fixed-timeout liveness, trusts every network |

B3 is the answer to "why not just use a VPN?": it *is* the VPN-only approach, and Infinet beats it on timing and on safety.

---

## 6. Questions judges might ask

**"Isn't this just a VPN?"**
The tunnel part is VPN-like, and that's deliberate: it's proven technology. A VPN alone doesn't know the Wi-Fi is about to die, doesn't check whether a network is a copy, and doesn't send the call on two networks during a switch. That's baseline B3.

**"What can a fake Wi-Fi see?"**
Only encrypted packets going to our anchor. Even the perfect copy, which passes every check, sees nothing.

**"What if the network blocks UDP?"**
The probe gets no answer, so the network is Unreachable and the call stays on mobile. The sim doesn't model a fallback over TCP.

**"What if your server goes down?"**
We fail closed. Nothing leaves the tunnel, the call waits, and it drops after 8 s. We don't fall back to sending in the clear.

**"Doesn't routing through your server add delay?"**
About 4 ms one-way in our model, assuming an in-country cloud region. That's an ASSUMPTION.

**"How fast is the check?"**
The probe takes one round trip and the canaries take two, run in parallel. That's tens of milliseconds on Wi-Fi or 5G, longer on satellite.

**"Is any of this real?"**
"The behaviour is simulated; the environment isn't." The hall's Wi-Fi is fitted to our own 27-point survey. The screening is the same code that would run on a phone. The live scanner screens real hotspots, though the probe is still simulated. Of 163 settings, 96 are marked ASSUMPTION and all are listed in the phone's Sim notes.

---

## 7. Glossary

| Term | Meaning |
|---|---|
| **Anchor server** | Our server where every tunnel ends; it forwards the call to the other person |
| **Tunnel** | An encrypted connection from the phone to the anchor over one network |
| **WireGuard** | A modern VPN protocol: UDP, public keys, a 1-round-trip handshake, silently drops bad packets |
| **Noise** | The framework of cryptographic handshakes that WireGuard is built on |
| **Pinned key / certificate** | We know the right key or certificate in advance, so a fake one is caught |
| **Probe** | A test handshake through a candidate network, using a separate key |
| **Canary** | A small known request (TLS, DNS, sign-in page) whose answer we already know; a different answer means tampering |
| **Make-before-break** | Bring up the new connection before dropping the old one |
| **Duplication** | Sending each voice packet on two networks; the first copy wins |
| **Playout deadline** | The latest a voice packet can arrive and still be played |
| **Jitter buffer** | A short wait on the receiving side that smooths uneven packet arrival |
| **RTT** | Round-trip time |
| **RTO** | Retransmission timeout: how long to wait before deciding a packet is lost (RFC 6298) |
| **Fail closed** | When something breaks, stop rather than send unprotected |
| **Captive portal** | A Wi-Fi sign-in page |
| **Deauth** | A forged "disconnect" frame; possible on WPA2 without PMF |
| **PMF** | Protected Management Frames: stops forged disconnects |
| **802.11r** | Fast handover between access points of the same Wi-Fi network |
| **UTS #39 skeleton** | A Unicode method that maps look-alike characters together to catch fake names |
| **Flap damping** | Waiting longer before going back to a network that keeps failing (from RFC 2439, BGP) |
| **LEO / GEO** | Low-orbit satellites (fast, with regular short spikes) / geostationary satellites (slow, ~600 ms+) |
| **Beacon flood** | An attacker broadcasting many fake network names at once |
