/**
 * ALL model constants live here (plan rule 2: "every number has a source").
 *
 * Each constant carries `src`: a published source, "COMPUTED", or "ASSUMPTION" (our own choice,
 * listed on screen in Lab → Sim notes). `verify` marks values that still need checking against
 * the primary text before booth day.
 */

export type ParamSource = { src: string; verify?: boolean };
export type P<T> = { v: T } & ParamSource;
const p = <T>(v: T, src: string, verify = false): P<T> => ({ v, src, verify });

export const PARAMS = {
  // ───────────── Simulation clock ─────────────
  stepS: p(0.005, 'ASSUMPTION: 5 ms fixed engine step (plan §9.1)'),
  frameS: p(0.02, 'ITU-T G.711 over RTP, 20 ms packetisation (common VoIP default)'),
  radioTickS: p(0.1, 'ASSUMPTION: phone samples RSSI/RSRP at 10 Hz'),

  // ───────────── Thresholds (decision lines drawn on the ground) ─────────────
  wifiVoiceDbm: p(-67, 'Rule of thumb: common enterprise voice-grade Wi-Fi design target (vendor design guides)'),
  wifiDataDbm: p(-75, 'Rule of thumb: data-usable Wi-Fi; Infinet prediction threshold for voice-usable'),
  nrEdgeRsrpDbm: p(-100, 'Rule of thumb: common 5G RSRP cell-edge figure'),
  nrUsableRsrpDbm: p(-110, 'Rule of thumb: below this the link is treated as unusable'),
  nrUsableSinrDb: p(0, 'Rule of thumb: SINR 0 dB unusable'),

  // ───────────── Wi-Fi propagation (log-distance + multi-wall, ITU-R P.1238 style) ─────────────
  wifiEirpDbm: p(20, 'ASSUMPTION: typical enterprise AP EIRP at 5 GHz'),
  wifiPl1m5GHz: p(46.8, 'COMPUTED: free-space path loss at 1 m, 5.2 GHz (20·log10(4π·1/λ))'),
  wifiPl1m2GHz: p(40.1, 'COMPUTED: free-space path loss at 1 m, 2.4 GHz'),
  wifiPathLossExp: p(3.2, 'ITU-R P.1238 office range n≈3.0–3.5 (rule of thumb, mixed indoor/outdoor)', true),
  wifiShadowSigmaDb: p(5, 'ASSUMPTION: indoor shadowing σ 4–6 dB (plan §9.2)'),
  wifiShadowCorrM: p(4, 'ASSUMPTION: indoor decorrelation 3–5 m; Gudmundson exponential model'),
  outdoorShadowCorrM: p(40, 'ASSUMPTION: outdoor decorrelation 30–50 m; Gudmundson exponential model'),
  wifiNoiseFloorDbm: p(-95, 'ASSUMPTION: 20 MHz noise + interference floor at 5 GHz'),
  /** Wall losses at 5 GHz, per material (dB). Rule of thumb; replace with ITU-R P.2040 values. */
  wallLossDb: p<Record<string, number>>({
    drywall: 3.5, clear_glass: 3, lowE_glass: 25, brick: 10, concrete: 15, metal: 28, wood_door: 4,
  }, 'Rule of thumb at 5 GHz (drywall 3–4, glass 2–4, low-E 20–30, brick 8–12, concrete 12–20, metal 25+); replace with ITU-R P.2040', true),
  wifiFastFadeSigmaDb: p(2, 'ASSUMPTION: small-scale fluctuation on each 10 Hz RSSI sample (AR(1), ρ=0.7)'),
  beaconIntervalMs: p(102.4, 'IEEE 802.11 default beacon interval, 100 TU (CWNP)'),
  wifiAssocLostDbm: p(-90, 'ASSUMPTION: below this, beacons are missed (approx. 5 GHz MCS0 sensitivity)'),
  beaconLossCount: p(8, 'ASSUMPTION: consecutive missed beacons before the OS declares the AP lost (~0.8 s)'),
  /** Packet error vs SNR (logistic). */
  wifiPer50SnrDb: p(8, 'ASSUMPTION: SNR at which voice packet loss after retries reaches 50%'),
  wifiPerSlopeDb: p(1.5, 'ASSUMPTION: width of the loss-vs-SNR logistic curve'),
  wifiBaseLoss: p(0.002, 'ASSUMPTION: residual voice packet loss on a good Wi-Fi link'),
  wifiRadioOwdMs: p(2, 'ASSUMPTION: Wi-Fi air interface one-way delay, good link'),
  wifiRetryOwdMs: p(25, 'ASSUMPTION: extra one-way delay from MAC retries as SNR collapses'),
  wifiJitterMs: p(2, 'ASSUMPTION: mean jitter on a quiet Wi-Fi link'),

  // ───────────── 5G NR propagation (3GPP TR 38.901) ─────────────
  nrFcGHz: p(3.5, 'UAE 5G mid-band 3.3–3.8 GHz (TRA allocation, The National); 3.5 GHz used'),
  nrPerRePowerDbm: p(17.8, 'ASSUMPTION: 53 dBm (200 W) spread over 3276 REs (100 MHz, 30 kHz SCS)'),
  nrSectorGainDbi: p(18, 'ASSUMPTION: macro sector panel gain'),
  nrHpbwHDeg: p(65, '3GPP TR 38.901 Table 7.3-1 horizontal pattern, 65° HPBW', true),
  nrHpbwVDeg: p(10, 'ASSUMPTION: macro panel vertical HPBW (array), 3GPP pattern shape'),
  nrPatternMaxAttDb: p(30, '3GPP TR 38.901 Table 7.3-1, A_max = 30 dB', true),
  nrSlaVDb: p(20, 'ASSUMPTION: vertical side-lobe level for the macro panel'),
  umaSigmaLosDb: p(4, '3GPP TR 38.901 Table 7.4.1-1, UMa LOS σ_SF', true),
  umaSigmaNlosDb: p(6, '3GPP TR 38.901 Table 7.4.1-1, UMa NLOS σ_SF', true),
  umiSigmaNlosDb: p(7.82, '3GPP TR 38.901 Table 7.4.1-1, UMi street canyon NLOS σ_SF', true),
  rmaSigmaNlosDb: p(8, '3GPP TR 38.901 Table 7.4.1-1, RMa NLOS σ_SF', true),
  ueHeightM: p(1.5, '3GPP TR 38.901 reference UE height'),
  nrNoisePerReDbm: p(-122.2, 'COMPUTED: −174 dBm/Hz + 10·log10(30 kHz) + 7 dB UE noise figure (ASSUMPTION NF)'),
  nrInterferencePerReDbm: p(-100, 'ASSUMPTION: loaded-network interference per RE outdoors (attenuated by O2I loss indoors)'),
  nrRadioOwdMs: p(9, 'ASSUMPTION: 5G NSA user-plane one-way delay incl. scheduling'),
  nrCoreOwdMs: p(3, 'ASSUMPTION: operator core one-way'),
  nrJitterMs: p(3, 'ASSUMPTION: mean 5G jitter, good SINR'),
  nrBaseLoss: p(0.002, 'ASSUMPTION: residual loss after HARQ/RLC on a good 5G link'),
  nrLoss50SinrDb: p(-2, 'ASSUMPTION: SINR where voice loss reaches 50%'),
  nrLossSlopeDb: p(1.5, 'ASSUMPTION: width of the 5G loss-vs-SINR logistic curve'),
  /** 3GPP TR 38.901 §7.4.3 O2I building penetration */
  o2iInsideDistCoef: p(0.5, '3GPP TR 38.901 §7.4.3: PL_in = 0.5·d_2D-in', true),
  o2iHighLossSigmaDb: p(6.5, '3GPP TR 38.901 Table 7.4.3-2 high-loss σ_P', true),
  o2iLowLossSigmaDb: p(4.4, '3GPP TR 38.901 Table 7.4.3-2 low-loss σ_P', true),

  // ───────────── Backhaul / Internet / anchor (one-way, ms) ─────────────
  officeLanOwdMs: p(0.5, 'ASSUMPTION: AP → comms-room switch over fibre/copper'),
  officeWanOwdMs: p(3, 'ASSUMPTION: enterprise ISP to the local internet exchange'),
  cafeBackhaulOwdMs: p(7, 'ASSUMPTION: café consumer fibre/DSL to the internet exchange'),
  cafeAirtimeExtraMs: p(6, 'ASSUMPTION: mean extra one-way delay from café airtime load (many clients)'),
  cafeAirtimeJitterMs: p(8, 'ASSUMPTION: mean jitter from café airtime load'),
  cafeAirtimeLoss: p(0.01, 'ASSUMPTION: extra loss from café airtime contention'),
  internetOwdMs: p(3, 'ASSUMPTION: internet exchange to the far end of the call in-country'),
  farEndOwdMs: p(10, 'ASSUMPTION: far party (Hamad) on a good network, his side one-way'),
  anchorDetourMs: p(4, 'ASSUMPTION: extra one-way delay from routing via the anchor server (in-country cloud region)'),

  // ───────────── Satellite (desert site router uplinks) ─────────────
  leoRttMinMs: p(25, 'IIUM 2026 field study (20–100 ms); Mohan et al. WWW 2024'),
  leoRttMaxMs: p(60, 'IIUM 2026 field study (20–100 ms); Mohan et al. WWW 2024'),
  leoJitterMs: p(5, 'ASSUMPTION: 5–15 ms jitter (low end), informed by Mohan et al. WWW 2024'),
  leoPeriodS: p(15, 'Mohan et al., A Multifaceted Look at Starlink Performance, WWW 2024 (15 s global reconfiguration); IMC 2026'),
  leoSpikeExtraMinMs: p(30, 'ASSUMPTION informed by WWW 2024 / IMC 2026 (sub-second degradations at each boundary)'),
  leoSpikeExtraMaxMs: p(80, 'ASSUMPTION informed by WWW 2024 / IMC 2026'),
  leoSpikeLossMin: p(0.01, 'ASSUMPTION informed by WWW 2024 / IMC 2026'),
  leoSpikeLossMax: p(0.05, 'ASSUMPTION informed by WWW 2024 / IMC 2026'),
  leoSpikeWinMinMs: p(150, 'ASSUMPTION informed by WWW 2024 / IMC 2026'),
  leoSpikeWinMaxMs: p(300, 'ASSUMPTION informed by WWW 2024 / IMC 2026'),
  leoBaseLoss: p(0.003, 'ASSUMPTION: clear-sky LEO residual loss'),
  leoPopOwdMs: p(10, 'ASSUMPTION: LEO ground-station/PoP to the anchor region'),
  geoRttMinMs: p(600, 'IIUM 2026 field study (600–3000 ms incl. rain); physics floor ≈477 ms'),
  geoRttMaxMs: p(700, 'IIUM 2026 field study; orbit physics'),
  geoJitterMs: p(18, 'ASSUMPTION: 10–30 ms GEO jitter'),
  geoBaseLoss: p(0.002, 'ASSUMPTION: clear-sky GEO loss'),
  geoSatLonDeg: p(52.5, 'ASSUMPTION: example GEO satellite slot at 52.5°E'),
  geoAltitudeKm: p(35786, 'Orbit physics: GEO altitude above the equator'),
  earthRadiusKm: p(6378.137, 'WGS-84 equatorial radius'),
  siteLatDeg: p(24.2, 'Al Ain, UAE (approx.)'),
  siteLonDeg: p(55.7, 'Al Ain, UAE (approx.)'),
  routerFailoverMinS: p(2, 'ASSUMPTION: site router WAN failure detection + uplink switch 2–5 s'),
  routerFailoverMaxS: p(5, 'ASSUMPTION: site router WAN failure detection + uplink switch 2–5 s'),

  // ───────────── Join / attach costs (plan §9.4) ─────────────
  scanMinS: p(0.1, 'ASSUMPTION: active scan of a few channels'),
  scanMaxS: p(2.0, 'ASSUMPTION: full passive scan'),
  assocOpenMs: p<[number, number]>([30, 80], 'ASSUMPTION: open-system auth + association'),
  assocPskMs: p<[number, number]>([50, 200], 'ASSUMPTION: PSK/SAE 4-way handshake'),
  assoc8021xMs: p<[number, number]>([500, 1500], 'Enterprise roaming guidance: full 802.1X re-auth >1 s (vs 802.11r <50 ms)'),
  ftRoamMs: p(50, 'Enterprise roaming guidance: 802.11r fast transition <50 ms'),
  dhcpS: p<[number, number]>([0.3, 3.0], 'ASSUMPTION: calibrate with Rashid\'s 10 measured joins (§16.3)'),
  portalCheckS: p(1.0, 'ASSUMPTION: OS captive-portal probe ~1 s'),
  handshakeExtraMs: p(15, 'ASSUMPTION: anchor handshake compute + policy margin on top of 1 RTT (WireGuard/Noise-style)'),

  // ───────────── Baseline behaviour ─────────────
  b1LowRssiDbm: p(-85, 'ASSUMPTION: OS-like "Wi-Fi poor" threshold (plan §9.5)'),
  b1LowRssiHoldS: p(2.0, 'ASSUMPTION: time below the threshold before giving up on Wi-Fi'),
  /** App reconnect after a network change with no tunnel (IP change breaks the session). */
  reconnectFastMedianS: p(1.6, 'Fit to UMons iPhone MPTCP handover measurements: overall median ≈2 s'),
  reconnectFastSigma: p(0.5, 'Fit to UMons measurements (lognormal σ of the fast mode)'),
  reconnectSlowShare: p(0.3, 'UMons measurements: ≈30% of switches took >10 s'),
  reconnectSlowRangeS: p<[number, number]>([10, 20], 'ASSUMPTION: shape of the slow mode (UMons only reports ">10 s")'),
  reconnectRtts: p(4, 'ASSUMPTION: app re-signalling (ICE restart) costs ~4 RTTs on the new path'),
  b2RoamMarginDb: p(6, 'ASSUMPTION: B2 roams to a same-name AP this much stronger'),
  b3ProbeIntervalMs: p(300, 'Plan §9.5: B3 fixed liveness, 3 missed probes at 300 ms'),
  b3ProbeTimeoutMs: p(300, 'Plan §9.5: fixed probe timeout (like commercial reactive bonding tools)'),
  b3MissesToDead: p(3, 'Plan §9.5'),
  b3LossSwitchPct: p(20, 'ASSUMPTION: B3 switches when loss over the last 1 s exceeds X%'),
  b3HoldoffS: p(4, 'ASSUMPTION: B3 waits before retrying a path it declared dead'),

  // ───────────── Infinet ─────────────
  forecastHorizonS: p(8, 'Plan §9.6: 0–8 s forecast horizon'),
  headingSmoothS: p(1.5, 'Plan §9.6: heading smoothing window'),
  trendWindowS: p(3, 'Plan §9.6: RSSI trend regression window'),
  trendMaxGapDb: p(10, 'ASSUMPTION: the RSSI trend only counts within 10 dB of the threshold (linear extrapolation of fading is not credible further out)'),
  prepareLeadS: p(5, 'ASSUMPTION: start checking the next network when the edge is ≤5 s away'),
  switchLeadS: p(1.5, 'Plan §9.6: switch when time-to-loss < 1.5 s'),
  dupHoldS: p(2, 'Plan §9.6: duplicate voice for 2 s around the switch'),
  dupDeadlineMarginMs: p(10, 'ASSUMPTION: a path qualifies for duplication only if its one-way delay fits the playout deadline minus this margin'),
  rtoMinMs: p(200, 'RFC 6298 uses 1 s minimum; ASSUMPTION 200 ms for a voice keepalive'),
  rtoMaxMs: p(3000, 'ASSUMPTION: RTO cap'),
  rtoDeadAfter: p(3, 'ASSUMPTION: consecutive RTO expiries (with exponential back-off) before "dead"'),
  keepaliveMs: p(200, 'ASSUMPTION: Infinet probes each live path every 200 ms (piggybacked on voice in practice)'),
  satProbeMs: p(100, 'ASSUMPTION: on satellite paths Infinet samples RTT every 100 ms from tunnel acks on voice packets'),
  leoLearnMinS: p(40, 'ASSUMPTION: minimum RTT history before claiming a period'),
  leoLearnConfidence: p(0.35, 'ASSUMPTION: autocorrelation peak needed to claim a pattern'),
  leoGuardBeforeMs: p(300, 'Plan §6.4: protection starts ~300 ms before each predicted spike'),
  leoGuardAfterMs: p(450, 'ASSUMPTION: protection lasts past the longest assumed window'),
  leoStretchMs: p(90, 'ASSUMPTION: extra jitter-buffer depth during a predicted spike'),

  // ───────────── Trust gate (plan §9.7) — design choices, all ASSUMPTION ─────────────
  flagUnknownDevice: p(2, 'ASSUMPTION (design choice): known name, BSSID not in map/profile for this area'),
  flagDowngrade: p(3, 'ASSUMPTION (design choice): weaker security than enrolled/expected'),
  flagSignalAnomaly: p(2, 'ASSUMPTION (design choice): observed − predicted > threshold'),
  flagNewcomer: p(2, 'ASSUMPTION (design choice): second device for a name already seen here'),
  flagChannel: p(1, 'ASSUMPTION (design choice): channel/band inconsistent with the known AP'),
  anomalyDb: p(12, 'ASSUMPTION: ≈2σ of combined shadowing + map error'),
  blockScore: p(4, 'ASSUMPTION (design choice): block at score ≥ 4'),

  // ───────────── Voice / quality ─────────────
  codecDelayMs: p(25, 'ASSUMPTION: G.711-class codec + 5 ms look-ahead + packetisation'),
  jbTargetMs: p(60, 'Plan §9.8: adaptive jitter buffer target'),
  jbMinMs: p(40, 'Plan §9.8'),
  jbMaxMs: p(150, 'Plan §9.8'),
  plcMaxFrames: p(2, 'Plan §9.8: first 2 consecutive losses concealed by PLC'),
  frozenMinMs: p(200, 'Plan §9.8: "frozen" = ≥200 ms with no played frames'),
  callDropS: p(8, 'ASSUMPTION: frozen ≥ 8 s counts as a dropped call'),
  lateLimitMs: p(150, 'ITU-T G.114: 150 ms one-way, transparent for most applications'),
  emodelR0: p(93.2, 'ITU-T G.107 default R0 − Is (simplified)', true),
  g711PlcIe: p(0, 'ITU-T G.113 Appendix I: G.711 with PLC, Ie = 0', true),
  g711PlcBpl: p(25.1, 'ITU-T G.113 Appendix I: G.711 with PLC, Bpl = 25.1', true),
  mosWindowS: p(5, 'Plan §9.8: live MOS over a 5 s window'),

  // ───────────── Visual compressions (listed in Sim notes) ─────────────
  packetTimeStretch: p(4, 'VISUAL: packet travel time = one-way delay × 4, clamped 0.25–3 s'),
  packetSample: p(5, 'VISUAL: 1 in 5 voice frames drawn'),
  beaconVisualDivisor: p(10, 'VISUAL: beacon rings shown 1 in 10'),
  satAltitudeCompression: p('log', 'VISUAL: satellite altitudes compressed (log scale) and labelled'),
} as const;

export type Params = typeof PARAMS;
export const v = <K extends keyof Params>(k: K): Params[K]['v'] => PARAMS[k].v;

/** Visual compressions, for the Sim notes panel. */
export const VISUAL_NOTES = [
  'Packets are time-stretched ×4 (clamped 0.25–3 s) so you can see delay. Real packets are faster.',
  'Only 1 in 5 voice packets is drawn.',
  'Beacon rings show 1 in 10 beacons (real interval 102.4 ms).',
  'Satellite altitudes are compressed and labelled (GEO 35,786 km; LEO ≈550 km).',
  'The gateway and the anchor server are drawn at the edge of the world; real distances are hundreds of km.',
  'The desert site is reached by fast travel; the highway between is not modelled in this build.',
  'Walls are drawn 1.5 m high and cut away; the radio model uses the full-height walls.',
];
