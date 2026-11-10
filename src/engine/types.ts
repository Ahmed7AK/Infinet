/** Shared engine types (rendering contract, plan Appendix A). */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export type PolicyId = 'b1' | 'b2' | 'b3' | 'infinet' | 'infinet-noPredict' | 'infinet-noTrust';
export const LIVE_POLICIES: PolicyId[] = ['b1', 'b2', 'b3', 'infinet'];
export const ALL_POLICIES: PolicyId[] = ['b1', 'b2', 'b3', 'infinet', 'infinet-noPredict', 'infinet-noTrust'];

export const POLICY_LABEL: Record<PolicyId, string> = {
  b1: "Today's phone",
  b2: 'Strongest signal',
  b3: 'Tunnel, no check',
  infinet: 'Infinet',
  'infinet-noPredict': 'Infinet without prediction',
  'infinet-noTrust': 'Infinet without trust check',
};
export const POLICY_DESC: Record<PolicyId, string> = {
  b1: 'Switches after the drop. No tunnel: a new network means the app reconnects.',
  b2: 'Joins whatever is loudest: roams to the strongest access point with the same name.',
  b3: 'Keeps the call through a tunnel, but switches only after a fixed timeout fails, and trusts every network.',
  infinet: 'Coverage map + tunnel + trust check.',
  'infinet-noPredict': 'Ablation: Infinet with prediction switched off (reacts like B3, keeps the trust check).',
  'infinet-noTrust': 'Ablation: Infinet with the trust check switched off.',
};

/** Security as advertised in the beacon (RSN/WPA elements). 'WPA2/3' = WPA3 transition mode (downgradable). */
export type Security = 'OPEN' | 'WEP' | 'WPA-TKIP' | 'OWE' | 'WPA2-PSK' | 'WPA2/3' | 'WPA2-ENT' | 'WPA3-SAE' | 'WPA3-ENT';
/**
 * Trust verdicts (Security spec §2, amends GP p.4). All traffic stays in the tunnel on every network;
 * verdicts only choose the path: trusted = primary path for the tunnel, tunnel = backup path, unreachable and
 * blocked = never. 'unreachable' (no answer yet, retried) keeps caution from counting as an attack.
 * 'unchecked' = seen, never joined: other people's networks, shown as anonymous dots.
 */
export type Tier = 'trusted' | 'tunnel' | 'unreachable' | 'blocked' | 'checking' | 'unchecked';
/** probe handshake through the candidate network: 'authfail' = packets arrived but failed authentication */
export type HandshakeResult = 'pass' | 'authfail' | 'timeout' | 'pending' | 'portal';
/** the café attack variants (spec §4): open copy (default), perfect copy (password and BSSID copied), downgrade */
export type AttackVariant = 'copy' | 'perfect' | 'downgrade';
export type LinkType = 'wifi' | '5g' | 'sat';
export type ZoneId = 'office' | 'street' | 'desert' | 'hall';
/** 'venue-hall' exists only where the private venue file is present (src/engine/world/venue.ts) */
export type ScenarioId = 'building-exit' | 'cafe-twin' | 'desert-sat' | 'venue-hall' | 'free';

export interface PlayerInput {
  pos: Vec2;
  vel: Vec2;
  headingDeg: number;
  zone?: ZoneId;
  docked?: boolean;
}

export interface Hop { name: string; owdMs: number }

export interface LinkView {
  id: string;              // path id: wifi:<net> | cell:<net>
  kind: 'wifi' | 'cell' | 'sat' | 'wired';
  label: string;
  up: boolean;
  rssiDbm?: number;
  rsrpDbm?: number;
  sinrDb?: number;
  snrDb?: number;
  rttMs: number;
  lossPct: number;
  jitterMs: number;
  hops: Hop[];
  uplink?: 'LEO' | 'GEO' | 'none';
}

export type LaneState = 'live' | 'weak' | 'checking' | 'handover' | 'frozen' | 'dropped' | 'idle';
export interface LaneSegment { t0: number; t1: number; state: LaneState; net: string; checked: boolean }

export interface LiveMetrics {
  frozenS: number;
  longestFrozenS: number;
  frozenCount: number;
  voiceLostPct: number;
  mos: number;           // 5 s window
  mosMean: number;
  callDropped: boolean;
  fakeAdmissions: number;   // frames of user voice sent over a fake network
  dupExtraPct: number;
}

/** Red flags (spec §4 table). No flag decides alone: any one caps a network at Tunnel only; two high, or one
 *  high and one medium, give Blocked. */
export type FlagId = 'new-device' | 'downgrade' | 'weak-crypto' | 'too-strong' | 'look-alike' | 'dns';
export interface Flag { id: FlagId; weight: 'high' | 'medium'; text: string; detail?: string }
export type CanaryState = 'wait' | 'ok' | 'bad' | 'skip';

export interface TrustView {
  bssid: string;
  ssid: string;
  net: string;
  tier: Tier;
  flags: Flag[];
  /** security seen when the screen ran (a change re-opens the check) */
  security?: Security;
  handshake?: HandshakeResult;
  /** probe packets that arrived but failed authentication (WireGuard drops these silently; the probe counts them) */
  authFailed?: number;
  canaries?: { tls: CanaryState; dns: CanaryState; portal: CanaryState };
  linkType: LinkType;
  /** from the live hotspot scanner: the screen is real, the probe simulated */
  live?: boolean;
  firstSeenT: number;
  decidedT?: number;
  /** unreachable: when the check is tried again */
  retryAt?: number;
  /** where the check is (spec §4): appears → screen → quarantine → verdict → roam */
  stage: 'screen' | 'quarantine' | 'verdict';
  reason: string;
  mayCarry: string;
  /** another access point of the same surveyed network: shares this BSSID's verdict instead of a check of its own */
  follows?: string;
  steps: Array<{ text: string; ok: boolean | null; t: number }>;
}

export interface PolicyView {
  id: PolicyId;
  activePath: string | null;
  activeLabel: string;
  checked: boolean;
  mode: 'single' | 'duplicate';
  frozen: boolean;
  callState: 'live' | 'handover' | 'frozen' | 'dropped';
  metrics: LiveMetrics;
  laneSegments: LaneSegment[];
  wifiAssoc: string | null;
  /** BSSID the phone is associated with (renderer draws the line to that access point) */
  wifiBssid: string | null;
  /** both paths while duplicating voice */
  dupPaths: string[];
  joinPhase: string;
  tunnel: boolean;
  playoutMs: number;
  mouthToEarMs: number;
  falseDead: number;
}

export interface PacketVis {
  id: number;
  policy: PolicyId;
  path: string;
  t0: number;          // sim send time
  t1: number;          // sim arrival time (or loss time)
  lost: boolean;
  late: boolean;
  dup: boolean;
  sealed: boolean;     // inside the tunnel
}

export interface ScanEntry {
  bssid: string; ssid: string; net: string; security: Security; pmf: 'none' | 'optional' | 'required';
  channel: number; band: '2.4' | '5'; rssiDbm: number;
  /** raw SSID bytes as hex: equality and red flags use these, never the display string (spec §6) */
  ssidHex: string;
  /** from the live hotspot scanner (spec §6), placed where it was first detected */
  live?: boolean;
  /** someone else's network: no name kept, BSSID replaced by a salted hash; drawn as a dot */
  anon?: boolean;
  /** live entries: where the walker was when it was first detected (engine frame, m) */
  pos?: Vec2;
  /** anonymous entries whose name is known only as an opaque id (a venue AP's other networks): the flood alert
   *  counts distinct names, so several access points of one network count once */
  nameKey?: string;
  /** what an anonymous entry is, when the model knows (the venue hall): a phone hotspot or a fixed device */
  kindHint?: 'hotspot' | 'device';
  /** Wi-Fi generation (Android code: 4 = 802.11n, 5 = ac, 6 = ax, 8 = be) and channel width (MHz), when known */
  std?: number; bwMHz?: number;
}

export interface InfinetView {
  ttlS?: number;
  ttlMapS?: number;
  ttlTrendS?: number;
  ttlConfidence?: number;
  edgePoint?: Vec2;
  forecast: Vec2[];
  candidate?: string;
  candidateState?: 'idle' | 'checking' | 'ready';
  trust: Record<string, TrustView>;
  /** the phone's own conclusion from liveness on every path: the anchor server is not answering (fail closed) */
  anchorLost: boolean;
  /** beacon-flood alert: many new names per scan; trust upgrades are frozen while it lasts */
  flood: boolean;
  leoPattern?: { periodS: number; confidence: number; nextSpikeT?: number; protecting: boolean };
  pathRtts: Record<string, number[]>;  // recent RTT samples per path for the phone trace
  satPatient?: { rttMs: number; srttMs: number; rtoMs: number; normal: boolean };
}

export interface TruthView {
  attackerPos?: Vec2;
  attackerOn: boolean;
  attackerMode: 'intercept' | 'relay';
  attackVariant: AttackVariant;
  /** the BSSID the copy advertises (the café's own in the copied-BSSID variants) */
  attackerBssid?: string;
  /** the fake Site-Net is on the air (desert) */
  siteTwinOn: boolean;
  /** where the beacon-flood device is, while it runs */
  floodPos?: Vec2;
  uplink: 'LEO' | 'GEO' | 'none';
  leoOutage: boolean;
  routerFailoverAt?: number;
  leoBoundaryPhase: number;
  leoSpikeActive: boolean;
  leoSatIndex: number;
}

export interface SimSnapshot {
  t: number;
  seed: number;
  scenario: ScenarioId;
  zone: ZoneId;
  player: { pos: Vec2; vel: Vec2; headingDeg: number };
  links: LinkView[];
  scan: ScanEntry[];
  policies: Record<string, PolicyView>;
  infinet: InfinetView;
  packets: PacketVis[];
  truth: TruthView;
  lab: LabState;
  region: string | null;
}

export type SimEvent =
  | { t: number; type: 'predict.edge'; link: string; ttlS: number; label: string }
  | { t: number; type: 'check.start' | 'check.pass' | 'check.fail'; link: string; label: string }
  | { t: number; type: 'switch'; from: string; to: string; fromLabel: string; toLabel: string; frozenMs: number; policy: PolicyId }
  | { t: number; type: 'switch.done'; to: string; toLabel: string; frozenMs: number; policy: PolicyId }
  | { t: number; type: 'trust.blocked' | 'trust.tunnel' | 'trust.trusted' | 'trust.unreachable' | 'trust.checking'; bssid: string; ssid: string; flags: Flag[]; reason: string; handshake?: HandshakeResult; verdictMs?: number }
  | { t: number; type: 'anchor.lost' | 'anchor.back' }
  | { t: number; type: 'flood.on' | 'flood.off'; newNames: number }
  | { t: number; type: 'sat.pattern'; periodS: number; confidence: number }
  | { t: number; type: 'sat.failover'; to: 'GEO' | 'LEO'; rttMs: number }
  | { t: number; type: 'sat.outage' }
  | { t: number; type: 'call.frozen' | 'call.resumed' | 'call.dropped'; policy: PolicyId; frozenMs?: number }
  | { t: number; type: 'attacker.start'; ssid: string; mode: string; offsetDb: number; variant: AttackVariant }
  | { t: number; type: 'region.enter' | 'region.exit'; region: string }
  | { t: number; type: 'falsedead'; policy: PolicyId; link: string }
  | { t: number; type: 'nocoverage'; aheadS: number }
  /** Lab attacks switched on/off: beacon flood (DDoS on network choice), uplink flood (DDoS on a Wi-Fi's internet), fake Site-Net */
  | { t: number; type: 'attack.on' | 'attack.off'; attack: LabAttack }
  /** the user completed a network's sign-in page (only the sandboxed page was reachable until then) */
  | { t: number; type: 'portal.signin'; net: string; label: string }
  /** Infinet left a Wi-Fi whose signal is strong but whose packets are lost or late (its own probes saw it) */
  | { t: number; type: 'path.congested'; link: string; label: string; lossPct: number; rttMs: number };

export type LabAttack = 'beacon-flood' | 'uplink-flood' | 'site-copy';

export interface LabState {
  attackerEnabled: boolean;
  attackerMode: 'intercept' | 'relay';
  attackerOffsetDb: number;
  deauth: boolean;
  satPrimary: 'LEO' | 'GEO';
  leoOutage: boolean;
  mapStaleness: number;     // 0..1
  walkSpeed: number;        // m/s for routes
  baseline: 'b1' | 'b2' | 'b3';
  attackVariant: AttackVariant;
  /** the anchor server stops answering (spec §5 "anchor down" moment) */
  anchorDown: boolean;
  /** the real café Wi-Fi blocks UDP, as many hotels and offices do: the probe gets no answer */
  cafeBlocksUdp: boolean;
  /** DDoS on network choice: a cheap device near the walker floods beacons (dozens of new names a second, plus
   *  copies of the nearby network's name). Beacons only: nothing answers behind them. */
  beaconFlood: boolean;
  /** DDoS on the internet behind every Wi-Fi: the signal stays strong, packets are lost and late */
  uplinkFlood: boolean;
  /** desert: a fake "Site-Net" (open, new BSSID) from a vehicle outside the fence */
  siteTwin: boolean;
  /** networks whose sign-in page the user has completed (the phone's Sign in button): no sign-in page from now on */
  signedIn: string[];
}

export const DEFAULT_LAB: LabState = {
  attackerEnabled: true,
  attackerMode: 'intercept',
  attackerOffsetDb: 18,
  deauth: true,
  satPrimary: 'LEO',
  leoOutage: false,
  mapStaleness: 0,
  walkSpeed: 1.3,
  baseline: 'b1',
  attackVariant: 'copy',
  anchorDown: false,
  cafeBlocksUdp: false,
  beaconFlood: false,
  uplinkFlood: false,
  siteTwin: false,
  signedIn: [],
};
