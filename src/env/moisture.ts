/**
 * Soil moisture: the volumetric water content θ of every 1 mm layer below the
 * surface (PHY-ENV-005, ASM-ENV-007). Rain soaks in at the top (what the top
 * layer cannot hold runs off), the top layer dries by evaporation (faster when
 * warm and in dry air), water spreads by diffusion — much slower
 * through dry soil (the diffusivity rises exponentially from air-dry to
 * saturation), so a dry crust forms on top in dry weather — and below the
 * last layer the soil stays at env.deepMoisture. Each step is implicit
 * (backward Euler, diffusivities from the start of the step), so it is
 * stable for any interval. Deterministic arithmetic only: every thread that
 * steps the same intervals gets the same numbers.
 */

import type { Config } from '../config/params.ts';
import { dexp, dlog, dpow } from '../core/dmath.ts';
import { S_PER_H } from '../core/units.ts';

export class SoilMoisture {
  /** θ per layer (index = depth in mm; layer 0 is the top millimetre). */
  readonly theta: Float64Array;
  /** Water budget since the start (mm of water): rain taken in, run off, evaporated, lost to the deep soil (negative: drawn up from it). */
  infiltrated = 0;
  runoff = 0;
  evaporated = 0;
  drained = 0;
  private readonly cfg: Config['env'];
  /** Per face between layer i and i + 1: dt × diffusivity (1 mm layers); the Thomas sweep's scratch. */
  private readonly face: Float64Array;
  private readonly cp: Float64Array;
  private readonly dp: Float64Array;

  constructor(cfg: Config, layers: number) {
    this.cfg = cfg.env;
    this.theta = new Float64Array(layers).fill(cfg.env.deepMoisture);
    this.face = new Float64Array(layers);
    this.cp = new Float64Array(layers);
    this.dp = new Float64Array(layers);
  }

  /** Water held in the soil column (mm of water per mm² of surface). */
  storage(): number {
    let s = 0;
    for (let i = 0; i < this.theta.length; i++) s += this.theta[i]!;
    return s;
  }

  /** Advance by dt seconds with rain (mm/h), relative humidity and surface temperature (°C). */
  step(dt: number, rain: number, humidity: number, surfaceTemp: number): void {
    const e = this.cfg, th = this.theta, n = th.length;
    const [dry, sat] = e.moistureRange as readonly [number, number];
    // Evaporation from the top layer at the potential rate (x temperature x air dryness), never more
    // than the layer holds above air-dry: once the soil below cannot keep up, the top dries out.
    const potential = (e.soilEvaporation / S_PER_H) * dpow(2, (surfaceTemp - e.referenceTemp) / e.evaporationDoubling)
      * Math.max(0, 1 - humidity) / (1 - e.humidity);
    const evap = Math.min(potential * dt, Math.max(0, th[0]! - dry));
    const rainIn = (rain / S_PER_H) * dt;
    // Diffusivity: exponential in the relative wetness, from Ddry at air-dry to Dsat at saturation.
    const [dDry, dSat] = e.moistureDiffusivity as readonly [number, number];
    const k = dlog(dSat / dDry);
    const diff = (theta: number): number => dDry * dexp(k * Math.min(1, Math.max(0, (theta - dry) / (sat - dry))));
    // dt × the diffusivity at each face: the harmonic mean of the two layers' (a dry layer holds the
    // water back, as in series conduction); the last face leads to the deep soil.
    for (let i = 0; i < n; i++) {
      const d1 = diff(th[i]!), d2 = diff(i + 1 < n ? th[i + 1]! : e.deepMoisture);
      this.face[i] = (dt * 2 * d1 * d2) / (d1 + d2);
    }
    // Backward Euler: -f[i-1] θ[i-1] + (1 + f[i-1] + f[i]) θ[i] - f[i] θ[i+1] = θ_old[i] (+ the sources in
    // the top layer); no diffusive flux through the surface, θ fixed at deepMoisture below the last layer.
    // Thomas algorithm.
    const f = this.face, cp = this.cp, dp = this.dp;
    for (let i = 0; i < n; i++) {
      const up = i > 0 ? f[i - 1]! : 0;
      let rhs = th[i]!;
      if (i === 0) rhs += rainIn - evap;
      if (i === n - 1) rhs += f[i]! * e.deepMoisture;
      const m = 1 + up + f[i]! - (i > 0 ? -up * cp[i - 1]! : 0);
      cp[i] = -f[i]! / m;
      dp[i] = (rhs - (i > 0 ? -up * dp[i - 1]! : 0)) / m;
    }
    th[n - 1] = dp[n - 1]!;
    for (let i = n - 2; i >= 0; i--) th[i] = dp[i]! - cp[i]! * th[i + 1]!;
    this.drained += f[n - 1]! * (th[n - 1]! - e.deepMoisture);
    this.infiltrated += rainIn;
    this.evaporated += evap;
    // What the layers cannot hold runs off (it can only pile up near the top, where the rain came in).
    for (let i = 0; i < n; i++) {
      if (th[i]! > sat) { this.runoff += th[i]! - sat; th[i] = sat; }
    }
  }
}
