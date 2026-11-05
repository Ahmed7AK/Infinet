/**
 * "How it works" (the Tunnel view). The phone pops up on this at the moments that matter and draws what
 * Infinet is doing right now, from the phone's own state (P5):
 *   you → the networks it can use → ONE encrypted tunnel → the anchor server → the other person.
 * Every byte of the call rides the tunnel on every network; a verdict only picks the road (Security spec §2).
 * A new network goes Appears → Screen → Quarantine → Verdict → Roam (§4) while the call stays where it is.
 * While switching, the call rides two tunnels at once, one per road, and the anchor drops the copies (D3).
 * If the anchor stops answering, Infinet fails closed: nothing leaves the tunnel, messages wait (§5, D2).
 */
import type { SimSnapshot, Tier, TrustView } from '../../engine/index';
import { badge, fmtMs, pathName, tech, ui } from '../tokens';

type RoadState = 'carrying' | 'standby' | 'checking' | 'blocked' | 'unreachable';
interface Road { id: string; label: string; kind: 'wifi' | 'cell' | 'sat'; tier: Tier; state: RoadState }

const KIND_WORD = { wifi: 'Wi-Fi', cell: '5G', sat: 'Satellite' } as const;
const STAGES = ['Appears', 'Screen', 'Quarantine', 'Verdict', 'Roam'] as const;

/** the box already says 5G / Wi-Fi, so the name drops it: "Cellular A", "Office Wi-Fi" */
const roadName = (p: string) => pathName(p).replace(/^5G \((.*)\)$/, '$1');

function kindOf(path: string): Road['kind'] {
  return path.startsWith('cell:') ? 'cell' : path === 'wifi:site-net' ? 'sat' : 'wifi';
}

/** the roads to draw (at most three), from the phone's own route, candidate, association and recent verdicts */
export function tunnelModel(s: SimSnapshot) {
  const pv = s.policies.infinet;
  const inf = s.infinet;
  const roads: Road[] = [];
  const have = new Set<string>();
  const trustOfPath = (p: string): TrustView | undefined => (p.startsWith('wifi') ? (pv?.wifiBssid ? inf.trust[pv.wifiBssid] : undefined) : inf.trust[p]);
  const add = (r: Road) => { if (!have.has(r.id) && roads.length < 3) { have.add(r.id); roads.push(r); } };
  const carrying = pv ? (pv.dupPaths.length ? pv.dupPaths : pv.activePath ? [pv.activePath] : []) : [];
  for (const p of carrying) add({ id: p, label: roadName(p), kind: kindOf(p), tier: trustOfPath(p)?.tier ?? 'trusted', state: 'carrying' });
  if (inf.candidate && !have.has(inf.candidate)) {
    const tv = inf.trust[inf.candidate];
    add({ id: inf.candidate, label: roadName(inf.candidate), kind: kindOf(inf.candidate), tier: tv?.tier ?? 'checking', state: inf.candidateState === 'ready' ? 'standby' : tv?.tier === 'unreachable' ? 'unreachable' : 'checking' });
  }
  // the Wi-Fi radio: a network in quarantine, or a checked one kept warm as a backup
  if (pv?.wifiAssoc && pv.wifiBssid && !carrying.some((p) => p.startsWith('wifi'))) {
    const tv = inf.trust[pv.wifiBssid];
    if (tv) add({ id: `wifi:${tv.bssid}`, label: tv.ssid, kind: tv.linkType === 'sat' ? 'sat' : 'wifi', tier: tv.tier, state: tv.tier === 'checking' ? 'checking' : tv.tier === 'trusted' || tv.tier === 'tunnel' ? 'standby' : tv.tier === 'blocked' ? 'blocked' : 'unreachable' });
  }
  // recent verdicts the walker should see: blocked copies first, then no-answer networks
  const recent = Object.values(inf.trust)
    .filter((tv) => tv.linkType !== '5g' && !tv.bssid.startsWith('cell:') && (tv.tier === 'blocked' || tv.tier === 'unreachable' || tv.tier === 'checking') && s.t - (tv.decidedT ?? tv.firstSeenT) < 12)
    .sort((a, b) => (a.tier === 'blocked' ? -1 : 0) - (b.tier === 'blocked' ? -1 : 0));
  for (const tv of recent) add({ id: `wifi:${tv.bssid}`, label: tv.ssid, kind: 'wifi', tier: tv.tier, state: tv.tier === 'blocked' ? 'blocked' : tv.tier === 'unreachable' ? 'unreachable' : 'checking' });

  // the newest check, for the stage bar
  const focus = Object.values(inf.trust)
    .filter((tv) => tv.firstSeenT > 0.5 || tv.tier === 'checking')
    .sort((a, b) => Math.max(b.firstSeenT, b.decidedT ?? 0) - Math.max(a.firstSeenT, a.decidedT ?? 0))[0];
  let stage = -1;
  if (focus) {
    const since = s.t - focus.firstSeenT;
    const onIt = carrying.some((p) => (p.startsWith('cell:') ? p === focus.bssid : pv?.wifiBssid === focus.bssid));
    if (focus.tier === 'checking') stage = since < 0.3 ? 0 : since < 0.8 ? 1 : 2;
    else if (focus.decidedT !== undefined && s.t - focus.decidedT < 8) stage = onIt && (focus.tier === 'trusted' || focus.tier === 'tunnel') ? 4 : 3;
  }

  const dup = (pv?.dupPaths.length ?? 0) > 1;
  let caption: { a: string; b: string; tone: 'ok' | 'warn' | 'bad' };
  const blockedNow = recent.find((tv) => tv.tier === 'blocked' && tv.decidedT !== undefined && s.t - tv.decidedT < 10);
  const checkingNow = Object.values(inf.trust).find((tv) => tv.tier === 'checking' && tv.stage === 'quarantine');
  const unreachNow = recent.find((tv) => tv.tier === 'unreachable');
  const via = pathName(pv?.activePath);
  if (inf.anchorLost) caption = { a: 'Our anchor server isn’t answering.', b: 'Infinet fails closed: nothing leaves the tunnel, so the call waits and important messages are held until the anchor is back.', tone: 'bad' };
  else if (inf.flood) caption = { a: 'Beacon flood nearby.', b: 'Many new names at once. Verdicts already made stand; no network is upgraded until it settles.', tone: 'warn' };
  else if (dup) caption = { a: 'Switching roads, no gap.', b: 'For 2 s the call rides two tunnels, one per road. The anchor keeps the first copy of each packet and drops the other.', tone: 'ok' };
  else if (blockedNow) caption = { a: blockedNow.reason, b: 'Nothing was sent to it. The call never left the tunnel.', tone: 'bad' };
  else if (pv?.activePath === 'wifi:site-net' && inf.satPatient) caption = inf.satPatient.normal
    ? { a: `Satellite Wi-Fi: ${fmtMs(inf.satPatient.rttMs)} round trip.`, b: 'Slow is normal for a satellite. Infinet stretches its timers to match instead of calling the link dead; the call stays in the tunnel.', tone: 'ok' }
    : { a: 'Satellite Wi-Fi: no answer right now.', b: `The last answer took ${fmtMs(inf.satPatient.rttMs)}. A satellite handover is a short gap, so Infinet waits it out before it gives up on this road.`, tone: 'warn' };
  else if (checkingNow) caption = { a: `Checking ${checkingNow.ssid}.`, b: `A separate probe key and canaries test it. The call stays on ${via} until there is a verdict.`, tone: 'warn' };
  else if (unreachNow) caption = { a: unreachNow.reason, b: 'No answer is not an attack: nothing goes through it, and we ask again shortly.', tone: 'warn' };
  else if (inf.candidate && inf.candidateState === 'ready') caption = { a: `${pathName(inf.candidate)} is checked and ready.`, b: 'Its tunnel is up before the Wi-Fi fades, so the switch costs no silence.', tone: 'ok' };
  else caption = { a: `Your call is inside one encrypted tunnel, via ${via}.`, b: 'The network only carries sealed packets to our anchor server. A verdict just picks the road; encryption never stops.', tone: 'ok' };
  return { roads, stage, focus, caption, anchorLost: inf.anchorLost, dup };
}

// ───────────── drawing ─────────────
const W = 320, H = 404;
const YOU = { x: 160, y: 372 }, ANCHOR = { x: 160, y: 112 }, OTHER = { x: 160, y: 26 }, NET_Y = 252;
const cols = (n: number) => (n <= 1 ? [160] : n === 2 ? [96, 224] : [58, 160, 262]);

function curve(a: { x: number; y: number }, b: { x: number; y: number }) {
  const my = (a.y + b.y) / 2;
  return `M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`;
}

function Lock({ x, y, c }: { x: number; y: number; c: string }) {
  return (
    <g transform={`translate(${x - 5},${y - 6})`}>
      <path d="M2,6 V4 a3,3 0 0 1 6,0 V6" fill="none" stroke={c} strokeWidth={1.6} />
      <rect x={0} y={6} width={10} height={7} rx={1.5} fill={c} />
    </g>
  );
}

function RoadView({ r, x, i, anchorLost }: { r: Road; x: number; i: number; anchorLost: boolean }) {
  const net = { x, y: NET_Y };
  const lower = curve({ x: YOU.x, y: YOU.y - 20 }, { x, y: NET_Y + 18 });
  const upper = curve({ x, y: NET_Y - 18 }, { x: ANCHOR.x, y: ANCHOR.y + 22 });
  const full = `${lower} ${upper.replace(/^M[^C]+/, `L${x},${NET_Y - 18} `)} L${OTHER.x},${OTHER.y + 18}`;
  const b = badge[r.tier];
  const dead = anchorLost;
  const tc = dead ? ui.dim : tech.tunnel;
  const kindC = r.kind === 'cell' ? tech.cell : r.kind === 'sat' ? tech.sat : tech.wifi;
  const pid = `road-${i}`;
  return (
    <g>
      {r.state === 'carrying' && (
        <>
          <path d={lower} stroke={tc} strokeOpacity={0.22} strokeWidth={11} fill="none" strokeLinecap="round" />
          <path d={upper} stroke={tc} strokeOpacity={0.22} strokeWidth={11} fill="none" strokeLinecap="round" />
          <path d={lower} stroke={tc} strokeWidth={2.4} fill="none" />
          <path d={upper} stroke={tc} strokeWidth={2.4} fill="none" />
          <path id={pid} d={full} fill="none" stroke="none" />
          {!dead && [0, 0.55, 1.1, 1.65].map((d) => (
            <circle key={d} r={3.6} fill={tech.tunnel}>
              <animateMotion dur="2.2s" repeatCount="indefinite" begin={`${d}s`} rotate="auto"><mpath href={`#${pid}`} /></animateMotion>
            </circle>
          ))}
          <Lock x={(x + ANCHOR.x) / 2 + (x === ANCHOR.x ? 12 : 0)} y={(NET_Y + ANCHOR.y) / 2} c={tc} />
        </>
      )}
      {r.state === 'standby' && (
        <>
          <path d={lower} stroke={tc} strokeWidth={1.6} strokeDasharray="5 5" fill="none" />
          <path d={upper} stroke={tc} strokeWidth={1.6} strokeDasharray="5 5" fill="none" />
          <text x={x} y={NET_Y - 34} fill={tc} fontSize={11} textAnchor="middle" fontFamily="JetBrains Mono">tunnel ready</text>
        </>
      )}
      {r.state === 'checking' && (
        <>
          <path d={lower} stroke={tech.check} strokeWidth={1.8} strokeDasharray="4 4" fill="none" />
          <path id={pid} d={`${lower} ${upper.replace(/^M[^C]+/, `L${x},${NET_Y - 18} `)}`} fill="none" stroke="none" />
          <path d={upper} stroke={tech.check} strokeOpacity={0.55} strokeWidth={1.2} strokeDasharray="2 5" fill="none" />
          {!dead && (
            <circle r={3.2} fill={tech.check}>
              <animateMotion dur="1.4s" repeatCount="indefinite"><mpath href={`#${pid}`} /></animateMotion>
            </circle>
          )}
          <text x={x} y={NET_Y - 34} fill={tech.check} fontSize={11} textAnchor="middle" fontFamily="JetBrains Mono">probe key</text>
        </>
      )}
      {r.state === 'blocked' && (
        <>
          <path d={lower} stroke={tech.threat} strokeOpacity={0.35} strokeWidth={1.4} strokeDasharray="3 4" fill="none" />
          <g transform={`translate(${(YOU.x + x) / 2},${(YOU.y - 20 + NET_Y + 18) / 2})`}>
            <circle r={11} fill="#1a0d0f" stroke={tech.threat} strokeWidth={1.6} />
            <path d="M-4.5,-4.5 L4.5,4.5 M4.5,-4.5 L-4.5,4.5" stroke={tech.threat} strokeWidth={2.2} strokeLinecap="round" />
          </g>
        </>
      )}
      {r.state === 'unreachable' && (
        <>
          <path d={lower} stroke={ui.mute} strokeWidth={1.4} strokeDasharray="3 5" fill="none" />
          <path d={upper} stroke={ui.dim} strokeWidth={1.2} strokeDasharray="2 6" fill="none" />
          <text x={(x + ANCHOR.x) / 2} y={(NET_Y + ANCHOR.y) / 2 + 4} fill={ui.mute} fontSize={15} textAnchor="middle" fontWeight={600}>?</text>
        </>
      )}
      {/* the network */}
      <g transform={`translate(${net.x},${net.y})`}>
        <rect x={-46} y={-18} width={92} height={36} rx={10} fill="#141922" stroke={r.state === 'blocked' ? tech.threat : kindC} strokeOpacity={r.state === 'blocked' ? 0.8 : 0.6} />
        <text y={-3} fill={kindC} fontSize={10.5} textAnchor="middle" fontFamily="JetBrains Mono" letterSpacing="0.06em">{KIND_WORD[r.kind].toUpperCase()}</text>
        <text y={11} fill={ui.text} fontSize={12} textAnchor="middle" fontWeight={600}>{r.label.length > 13 ? `${r.label.slice(0, 12)}…` : r.label}</text>
      </g>
      <g transform={`translate(${net.x},${net.y + 32})`}>
        <rect x={-44} y={-9} width={88} height={18} rx={9} fill="#0e1117" stroke={b.color} strokeWidth={1} />
        <text y={4} fill={b.color} fontSize={11} textAnchor="middle" fontWeight={600}>{b.icon} {b.word}</text>
      </g>
    </g>
  );
}

export function TunnelApp({ s }: { s: SimSnapshot }) {
  const m = tunnelModel(s);
  const xs = cols(m.roads.length);
  const ac = m.anchorLost ? tech.threat : tech.tunnel;
  const toneC = m.caption.tone === 'bad' ? tech.threat : m.caption.tone === 'warn' ? tech.check : tech.tunnel;
  return (
    <>
      <h4 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>How it works<span className="sub" style={{ fontSize: 13 }}>live, from this phone</span></h4>
      <svg width={W - 32} viewBox={`0 0 ${W} ${H}`} style={{ alignSelf: 'center', overflow: 'visible' }} role="img" aria-label="Diagram: your phone, the networks, the encrypted tunnel, the anchor server and the other person">
        {/* the other person and the normal call leg */}
        <line x1={OTHER.x} y1={OTHER.y + 16} x2={ANCHOR.x} y2={ANCHOR.y - 24} stroke={tech.wired} strokeOpacity={0.55} strokeWidth={1.6} />
        <circle cx={OTHER.x} cy={OTHER.y} r={15} fill="#141922" stroke={tech.wired} strokeOpacity={0.7} />
        <rect x={OTHER.x - 4.5} y={OTHER.y - 7.5} width={9} height={15} rx={2} fill="none" stroke={tech.wired} strokeWidth={1.4} />
        <text x={OTHER.x + 24} y={OTHER.y + 4} fill={ui.text} fontSize={13} fontWeight={600}>Hamad</text>
        <text x={OTHER.x + 24} y={OTHER.y + 18} fill={ui.mute} fontSize={11}>the other end of the call</text>
        {/* the anchor */}
        <g transform={`translate(${ANCHOR.x},${ANCHOR.y})`}>
          <polygon points="0,-22 19,-11 19,11 0,22 -19,11 -19,-11" fill={m.anchorLost ? '#1f0e10' : '#0f2229'} stroke={ac} strokeWidth={2} />
          {m.anchorLost
            ? <path d="M-6,-6 L6,6 M6,-6 L-6,6" stroke={tech.threat} strokeWidth={2.4} strokeLinecap="round" />
            : <Lock x={0} y={1} c={tech.tunnel} />}
        </g>
        <text x={ANCHOR.x + 28} y={ANCHOR.y - 2} fill={ui.text} fontSize={13} fontWeight={600}>Anchor server</text>
        <text x={ANCHOR.x + 28} y={ANCHOR.y + 12} fill={ui.mute} fontSize={11}>{m.anchorLost ? 'not answering · fail closed' : 'the tunnel ends here'}</text>
        {m.roads.map((r, i) => <RoadView key={r.id} r={r} x={xs[i]} i={i} anchorLost={m.anchorLost} />)}
        {/* you */}
        <circle cx={YOU.x} cy={YOU.y} r={18} fill="#141922" stroke={tech.tunnel} strokeWidth={1.6} />
        <rect x={YOU.x - 5.5} y={YOU.y - 9} width={11} height={18} rx={2.5} fill="none" stroke={tech.tunnel} strokeWidth={1.5} />
        <text x={YOU.x + 26} y={YOU.y + 5} fill={ui.text} fontSize={13} fontWeight={600}>You</text>
        {m.dup && <text x={YOU.x - 26} y={YOU.y + 5} fill={tech.tunnel} fontSize={11} textAnchor="end" fontFamily="JetBrains Mono">2 tunnels</text>}
      </svg>
      <div className="stages" aria-label="Where the check is">
        {STAGES.map((st, i) => <span key={st} className={i === m.stage ? 'on' : i < m.stage ? 'done' : ''}>{st}</span>)}
      </div>
      <div className="card" style={{ borderColor: `${toneC}66` }}>
        <div className="a" style={{ color: toneC }}>{m.caption.a}</div>
        <div className="b">{m.caption.b}</div>
      </div>
    </>
  );
}
