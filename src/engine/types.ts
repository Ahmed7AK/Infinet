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

export type Security = 'OPEN' | 'OWE' | 'WPA2-PSK' | 'WPA3-SAE' | 'WPA3-ENT';
export type Tier = 'trusted' | 'pipe' | 'blocked' | 'checking' | 'unchecked';
export type HandshakeResult = 'pass' | 'fail' | 'timeout' | 'pending' | 'portal';
export type ZoneId = 'office' | 'street' | 'desert';
export type ScenarioId = 'building-exit' | 'cafe-twin' | 'desert-sat' | 'free';

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

export interface Flag { id: 'unknown-device' | 'downgrade' | 'signal-anomaly' | 'newcomer' | 'channel'; score: number; text: string; detail?: string }

export interface TrustView {
  bssid: string;
  ssid: string;
  net: string;
  tier: Tier;
  flags: Flag[];
  score: number;
  handshake?: HandshakeResult;
  firstSeenT: number;
  decidedT?: number;
  reason: string;
  mayCarry: string;
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
  channel: number; band: '2.4' | '5'; rssiDbm: number; live?: boolean;
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
  leoPattern?: { periodS: number; confidence: number; nextSpikeT?: number; protecting: boolean };
  pathRtts: Record<string, number[]>;  // recent RTT samples per path for the phone trace
  satPatient?: { rttMs: number; srttMs: number; rtoMs: number; normal: boolean };
}

export interface TruthView {
  attackerPos?: Vec2;
  attackerOn: boolean;
  attackerMode: 'intercept' | 'relay';
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
  | { t: number; type: 'trust.blocked' | 'trust.pipe' | 'trust.trusted' | 'trust.checking'; bssid: string; ssid: string; flags: Flag[]; reason: string; handshake?: HandshakeResult }
  | { t: number; type: 'sat.pattern'; periodS: number; confidence: number }
  | { t: number; type: 'sat.failover'; to: 'GEO' | 'LEO'; rttMs: number }
  | { t: number; type: 'sat.outage' }
  | { t: number; type: 'call.frozen' | 'call.resumed' | 'call.dropped'; policy: PolicyId; frozenMs?: number }
  | { t: number; type: 'attacker.start'; ssid: string; mode: string; offsetDb: number }
  | { t: number; type: 'region.enter' | 'region.exit'; region: string }
  | { t: number; type: 'falsedead'; policy: PolicyId; link: string }
  | { t: number; type: 'nocoverage'; aheadS: number };

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
  blockThreshold: number;
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
  blockThreshold: 4,
};
