/**
 * Baselines ("Today's phone" versions), plan §9.5. Named on screen every time.
 *  B1 · Switches after the drop (OS default, sticky Wi-Fi, no tunnel)
 *  B2 · Joins the strongest signal (roams to the loudest same-name AP, no tunnel)
 *  B3 · Tunnel, no check (keeps the call through a tunnel; fixed-timeout liveness; trusts every network)
 */
import { v } from '../params';
import type { PolicyId } from '../types';
import { Agent, isWifiPath, type Ctx } from './agent';
import { sampleProbeRtt } from '../links/paths';

abstract class OsLikeAgent extends Agent {
  protected lowSince: number | null = null;
  protected abstract roamAggressive: boolean;

  /** OS Wi-Fi behaviour: auto-join saved networks, give up on poor Wi-Fi, roam within the same name+security. */
  protected osWifi(ctx: Ctx) {
    const w = this.wifi;
    if (!w.net) {
      const cands = this.savedAndVisible(ctx, v('wifiDataDbm')).sort((a, b) => b.rssiDbm - a.rssiDbm);
      if (cands.length) this.joinWifi(ctx, cands[0].net, cands[0].bssid, 'use');
      return;
    }
    if (w.phase !== 'up') return;
    const cur = this.measuredWifiRssi(ctx);
    if (cur < v('b1LowRssiDbm')) {
      this.lowSince ??= ctx.t;
      if (ctx.t - this.lowSince >= v('b1LowRssiHoldS')) { this.disassociate(ctx, 'poor Wi-Fi', 10); this.lowSince = null; return; }
    } else this.lowSince = null;
    // roaming to another BSS with the same SSID + security (a different network behind it = new DHCP lease)
    const curEntry = w.bssid ? ctx.obs.byBssid.get(w.bssid) : undefined;
    if (!curEntry) return;
    const better = ctx.obs.scan
      .filter((e) => e.ssid === curEntry.ssid && e.security === curEntry.security && e.net !== w.net && (this.cooldown.get(e.bssid) ?? -1) < ctx.t)
      .sort((a, b) => b.rssiDbm - a.rssiDbm)[0];
    const sticky = !this.roamAggressive && cur > v('wifiDataDbm');
    if (better && !sticky && better.rssiDbm >= cur + v('b2RoamMarginDb')) this.joinWifi(ctx, better.net, better.bssid, 'use');
  }

  /** The OS default route: validated Wi-Fi, else cellular. */
  protected osRoute(ctx: Ctx): string | null {
    if (this.wifi.net && this.wifi.phase === 'up' && this.wifi.validated && ctx.paths.get(`wifi:${this.wifi.net}`)?.up) return `wifi:${this.wifi.net}`;
    const cells = [...ctx.obs.cell.values()].filter((c) => c.attached).sort((a, b) => b.rsrpDbm - a.rsrpDbm);
    return cells.length ? `cell:${cells[0].net}` : this.route;
  }
}

export class B1 extends OsLikeAgent {
  protected roamAggressive = false;
  constructor(seed: number) { super('b1', seed, false); }
  decide(ctx: Ctx) {
    this.osWifi(ctx);
    const want = this.osRoute(ctx);
    if (want !== this.route) this.steer(ctx, want);
  }
}

export class B2 extends OsLikeAgent {
  protected roamAggressive = true;
  constructor(seed: number) { super('b2', seed, false); }
  decide(ctx: Ctx) {
    this.osWifi(ctx);
    const want = this.osRoute(ctx);
    if (want !== this.route) this.steer(ctx, want);
  }
}

export class B3 extends OsLikeAgent {
  protected roamAggressive = true;
  private dead = new Map<string, number>();
  private misses = 0;
  private probes: Array<{ due: number; ok: boolean }> = [];
  private nextProbe = 0;
  private probeSlot = 0;

  constructor(seed: number, id: PolicyId = 'b3') { super(id, seed, true); }

  decide(ctx: Ctx) {
    this.osWifi(ctx);
    const pref = this.osRoute(ctx);
    // fixed-timeout liveness on the current path: 3 missed probes at 300 ms (plan §9.5)
    if (this.route && ctx.t >= this.nextProbe) {
      this.nextProbe = ctx.t + v('b3ProbeIntervalMs') / 1000;
      const p = ctx.paths.get(this.route);
      const usable = this.pathUsable(ctx, this.route);
      const rtt = p && usable ? sampleProbeRtt(ctx.seed, p, this.probeSlot++, true) : Infinity;
      this.probes.push({ due: ctx.t + v('b3ProbeTimeoutMs') / 1000, ok: rtt <= v('b3ProbeTimeoutMs') });
    }
    while (this.probes.length && this.probes[0].due <= ctx.t) {
      const pr = this.probes.shift()!;
      this.misses = pr.ok ? 0 : this.misses + 1;
    }
    const lossy = this.recentLoss(ctx.t, 1) * 100 > v('b3LossSwitchPct') && ctx.t - this.lastSwitchT > 1.5;
    if (this.route && (this.misses >= v('b3MissesToDead') || lossy)) {
      const p = ctx.paths.get(this.route);
      if (p && p.up && p.loss < 0.5 && !(p.attacker && ctx.lab.attackerMode === 'intercept')) {
        this.falseDead++;
        ctx.emit({ t: ctx.t, type: 'falsedead', policy: this.id, link: this.route });
      }
      this.dead.set(this.route, ctx.t + v('b3HoldoffS'));
      this.misses = 0;
      this.probes = [];
      const alt = this.alternative(ctx, this.route);
      if (alt) this.go(ctx, alt);
      return;
    }
    const prefDead = pref ? (this.dead.get(pref) ?? -1) > ctx.t : true;
    if (pref && pref !== this.route && !prefDead) this.go(ctx, pref);
    if (!this.route && pref) this.go(ctx, pref);
  }

  private lastSwitchT = -10;
  private go(ctx: Ctx, to: string) {
    this.lastSwitchT = ctx.t;
    this.misses = 0;
    this.probes = [];
    this.steer(ctx, to);
  }

  private alternative(ctx: Ctx, from: string): string | null {
    const cands: string[] = [];
    if (this.wifi.net && this.wifi.phase === 'up' && `wifi:${this.wifi.net}` !== from) cands.push(`wifi:${this.wifi.net}`);
    for (const c of ctx.obs.cell.values()) if (c.attached && `cell:${c.net}` !== from) cands.push(`cell:${c.net}`);
    const alive = cands.filter((c) => (this.dead.get(c) ?? -1) <= ctx.t);
    if (alive.length) return alive.sort((a, b) => this.score(ctx, b) - this.score(ctx, a))[0];
    // everything was declared dead: go back to whichever path's hold-off ends first
    const all = [...cands, from].sort((a, b) => (this.dead.get(a) ?? 0) - (this.dead.get(b) ?? 0));
    return all[0] ?? null;
  }

  private score(ctx: Ctx, pathId: string): number {
    if (isWifiPath(pathId)) return this.measuredWifiRssi(ctx) + 30;
    const c = ctx.obs.cell.get(pathId.split(':')[1]);
    return c ? c.rsrpDbm + c.sinrDb : -300;
  }
}
