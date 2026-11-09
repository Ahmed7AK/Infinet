/**
 * In-world labels (plan §7.2, §7.4). Built from the snapshot at the HUD rate and drawn by scene/labels.tsx.
 *  Both views: the trust hologram over an access point while it is being checked or just decided (Feature 2),
 *              and the countdown at the predicted edge (Feature 1).
 *  Vision only: network tags ("Cafe_Guest · ch 36 · −52 dBm · Open"), towers, anchor, Internet, satellites.
 *  Simulation truth (view ≠ belief) only: what the copy sees. The phone could not know this (P5).
 */
import { LAYOUT, type SimSnapshot, type TrustView } from '../../engine/index';
import { badge, fmtDb, fmtMs, fmtS, NET_NAME, type Tier } from '../tokens';
import type { LabelItem, V3 } from '../scene/labels';
import { driver } from '../driver';
import { anchorPos, copyOn, geoSat, isOnWifi, leoSat, realNet, visibleTx } from './NetworkLayer';

const w3 = (x: number, y: number, h = 0): V3 => [x, h, -y];
const TX = LAYOUT.transmitters;
const SEC: Record<string, string> = { OPEN: 'Open', WEP: 'WEP', 'WPA-TKIP': 'WPA/TKIP', OWE: 'Enhanced Open', 'WPA2-PSK': 'WPA2', 'WPA2/3': 'WPA2/3', 'WPA2-ENT': 'WPA2-Enterprise', 'WPA3-SAE': 'WPA3', 'WPA3-ENT': 'WPA3-Enterprise' };
const ANON_DOTS = 48; // nearest anonymous networks drawn as dots (Vision); the rest are only counted

function trustFor(s: SimSnapshot, t: (typeof TX)[number]): TrustView | undefined {
  if (t.kind === 'cell') return s.infinet.trust[`cell:${t.net}`];
  return t.bssid ? s.infinet.trust[t.bssid] : undefined;
}

function Badge({ tier }: { tier: Tier }) {
  const b = badge[tier];
  return <span className="badge" style={{ color: b.color, borderColor: b.color }}><b>{b.icon}</b> {b.word}</span>;
}

function holo(tv: TrustView, name: string) {
  return (
    <div className={`holo ${tv.tier}`}>
      <div className="hd"><span className="n">{name}</span><Badge tier={tv.tier} /></div>
      <ul>
        {tv.steps.map((st, i) => (
          <li key={i} className={st.ok === null ? 'wait' : st.ok ? 'good' : 'bad'}>
            <span className="m">{st.ok === null ? '…' : st.ok ? '✓' : '✕'}</span><span>{st.text}</span>
          </li>
        ))}
      </ul>
      <div className="carry">May carry: {tv.mayCarry}</div>
    </div>
  );
}

export function worldLabels(s: SimSnapshot, view: string, vision: boolean): LabelItem[] {
  const out: LabelItem[] = [];
  const scan = new Map(s.scan.map((e) => [e.bssid, e]));
  const desert = s.zone === 'desert';

  if (vision) {
    for (const t of visibleTx(s)) {
      const tv = trustFor(s, t);
      if (t.kind === 'cell') {
        const link = s.links.find((l) => l.id === `cell:${t.net}`);
        out.push({
          key: `tag:${t.id}`, pos: w3(t.pos[0], t.pos[1], t.pos[2] + 2.5), z: 1,
          node: <div className="ntag cell"><span className="dot" /><span className="n">{NET_NAME[t.net] ?? t.net}</span><span className="d">{fmtDb(link?.rsrpDbm)}</span>{tv && <Badge tier={tv.tier} />}</div>,
        });
        continue;
      }
      const e = t.bssid ? scan.get(t.bssid) : undefined;
      // the copy uses the café's name: that is the attack. Only the truth view says which is which.
      const ssid = t.attacker && view === 'belief' ? NET_NAME[realNet(t.net)] : NET_NAME[t.net] ?? t.ssid ?? t.net;
      out.push({
        key: `tag:${t.id}`, pos: w3(t.pos[0], t.pos[1], t.pos[2] + 0.45), z: 1,
        node: (
          <div className={`ntag wifi ${t.attacker && view !== 'belief' ? 'threat' : ''}`}>
            <span className="dot" /><span className="n">{ssid}</span>
            <span className="d">ch {e?.channel ?? t.channel ?? '—'} · {fmtDb(e?.rssiDbm)} · {SEC[e?.security ?? t.security ?? ''] ?? '—'}</span>
            {tv && <Badge tier={tv.tier} />}
          </div>
        ),
      });
    }
    out.push({ key: 'anchor', pos: anchorPos(desert), z: 1, node: <div className="ntag tunnel"><span className="dot" /><span className="n">Anchor server</span><span className="d">the tunnel ends here</span></div> });
    if (!desert) {
      const a = LAYOUT.visual.internet.pos;
      out.push({ key: 'inet', pos: w3(a[0], a[1], 26), z: 1, node: <div className="ntag wired"><span className="dot" /><span className="n">Internet</span></div> });
    } else {
      const leoUp = s.truth.uplink === 'LEO' && !s.truth.leoOutage, geoUp = s.truth.uplink === 'GEO';
      const pat = s.infinet.satPatient;
      const gw = LAYOUT.visual.gateway.pos;
      out.push({ key: 'leo', pos: leoSat(s), z: 1, node: <div className={`ntag sat ${leoUp ? '' : 'off'}`}><span className="dot" /><span className="n">LEO satellite</span><span className="d">{s.truth.leoOutage ? 'sky blocked' : '~550 km'} · not to scale{s.truth.leoSpikeActive ? ' · re-pointing' : ''}</span></div> });
      out.push({ key: 'geo', pos: geoSat(), z: 1, node: <div className={`ntag sat ${geoUp ? '' : 'off'}`}><span className="dot" /><span className="n">GEO satellite</span><span className="d">35,786 km · not to scale{geoUp && pat ? ` · ${fmtMs(pat.rttMs)} round trip` : ''}</span></div> });
      out.push({ key: 'gw', pos: w3(gw[0], gw[1], 12), z: 1, node: <div className="ntag wired"><span className="dot" /><span className="n">Satellite gateway</span><span className="d">hundreds of km away · not to scale</span></div> });
    }
  }

  // live networks from the laptop's scanner (spec §6), placed where they were first heard. Demo hotspots
  // (Infinet-Demo-…) are named, in both views; everyone else is an anonymous dot, in Vision only.
  const [wx, wy] = s.player.pos;
  const anon = s.scan.filter((e) => e.pos && ((e.live && e.anon) || e.net === 'flood'))
    .sort((a, b) => Math.hypot(a.pos![0] - wx, a.pos![1] - wy) - Math.hypot(b.pos![0] - wx, b.pos![1] - wy)).slice(0, ANON_DOTS);
  if (vision) {
    for (const e of anon) {
      const flood = e.net === 'flood';
      out.push({ key: `anon:${e.bssid}`, pos: w3(e.pos![0], e.pos![1], 1.0), z: 0, node: <div className={`adot ${flood ? 'flood' : ''}`} title={flood ? 'Fake beacon from the flood (simulation): never joined' : "Someone else's network: anonymous, never joined"} /> });
    }
    const fp = s.truth.floodPos;
    if (fp && view !== 'belief') out.push({ key: 'flooder', pos: w3(fp[0], fp[1], 2.0), z: 2, node: <div className="ntag wifi threat"><span className="dot" /><span className="n">Beacon flooder</span><span className="d">simulation view · dozens of fake names</span></div> });
  }
  for (const e of s.scan) {
    if (!e.live || e.anon || !e.pos) continue;
    const tv = s.infinet.trust[e.bssid];
    out.push({
      key: `live:${e.bssid}`, pos: w3(e.pos[0], e.pos[1], 1.5), z: 2,
      node: (
        <div className={`ntag wifi live ${tv?.tier === 'blocked' ? 'threat' : ''}`}>
          <span className="dot" /><span className="livetag">LIVE</span><span className="n">{e.ssid}</span>
          <span className="d">ch {e.channel} · {fmtDb(e.rssiDbm)} · {SEC[e.security] ?? e.security}</span>
          {tv && <Badge tier={tv.tier} />}
        </div>
      ),
    });
  }

  // trust hologram (both views)
  for (const tv of Object.values(s.infinet.trust)) {
    if (tv.net.startsWith('cell') || !tv.steps.length) continue;
    const recent = tv.decidedT !== undefined && s.t - tv.decidedT < 12 && (tv.firstSeenT > 0.5 || !!tv.live);
    if (!(tv.tier === 'checking' || tv.tier === 'blocked' || recent)) continue;
    if (tv.live) {
      const e = scan.get(tv.bssid);
      if (!e?.pos || e.anon) continue;
      out.push({ key: `trust:${tv.bssid}`, pos: w3(e.pos[0], e.pos[1], 2.1), z: 3, card: 'above', node: holo(tv, e.ssid) });
      continue;
    }
    // the copy can wear the café's own BSSID (spec variants), so place it by what it is, not by its address
    if (tv.net === 'flood') continue;                                 // the flood's copies: dots, no hologram each
    const t = tv.net === 'twin' || tv.net === 'site-twin' ? TX.find((x) => x.net === tv.net) : TX.find((x) => x.bssid === tv.bssid);
    if (!t || (t.attacker && !copyOn(s, t))) continue;
    const name = t.attacker ? NET_NAME[realNet(t.net)] : NET_NAME[t.net] ?? tv.ssid;
    out.push({ key: `trust:${tv.bssid}`, pos: w3(t.pos[0], t.pos[1], t.pos[2] + 0.5), z: 3, card: 'above', node: holo(tv, name) });
  }

  // what the copy gets from the comparison phone (truth only)
  const base = s.policies[s.lab.baseline];
  const onCopy = base?.activePath === 'wifi:twin' || base?.activePath === 'wifi:site-twin' ? TX.find((x) => `wifi:${x.net}` === base.activePath) : undefined;
  if (view !== 'belief' && onCopy && copyOn(s, onCopy)) {
    const t = onCopy;
    out.push({
      key: 'attacker', pos: w3(t.pos[0], t.pos[1], 1.1), z: 3, card: 'below',
      node: (
        <div className="holo blocked">
          <div className="hd"><span className="n">Simulation view · the copy sees</span></div>
          <ul>
            <li className="bad"><span className="m">•</span><span>{base.tunnel ? 'Only tunnel ciphertext' : 'DNS lookups and sites visited'}</span></li>
            {!base.tunnel && <li className="bad"><span className="m">•</span><span>Can show a fake login page</span></li>}
            <li className="bad"><span className="m">•</span><span>Can delay or drop your traffic</span></li>
          </ul>
        </div>
      ),
    });
  }

  // predicted edge (both views)
  const inf = s.infinet;
  if (isOnWifi(s.policies.infinet) && !!s.policies.infinet?.wifiAssoc && inf.ttlS !== undefined && inf.ttlS < 10 && inf.edgePoint) {
    out.push({ key: 'edge', pos: w3(inf.edgePoint[0], inf.edgePoint[1], 0.6), z: 2, node: <div className="edgetag">Wi-Fi edge ahead · <b>{fmtS(inf.ttlS)}</b></div> });
  }

  // you (Vision only: the world is busy, so say where you are)
  if (vision) {
    const st = s.policies.infinet?.callState ?? 'live';
    const word = st === 'frozen' ? 'call frozen' : st === 'dropped' ? 'call dropped' : st === 'handover' ? 'handing over' : 'call live';
    out.push({ key: 'you', pos: () => w3(driver.snap.player.pos[0], driver.snap.player.pos[1], 2.15), z: 4, node: <div className={`youtag ${st === 'frozen' || st === 'dropped' ? 'bad' : ''}`}>You · {word}</div> });
  }
  return out;
}
