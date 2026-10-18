/**
 * The environment as the simulation uses it (Phase 7): light, surface
 * temperature and the ectotherm rate factor at the surface and at every depth
 * in the soil, refreshed every env.updateInterval of simulated time. The
 * values are computed for the start of the interval the tick falls in, so
 * every thread (each keeps its own Climate) gets exactly the same numbers.
 */

import { dpow } from '../../core/dmath.ts';
import { Environment } from '../../env/environment.ts';
import { SoilMoisture } from '../../env/moisture.ts';
import type { World } from '../world.ts';

export class Climate {
  readonly env: Environment;
  light = 1;
  surfaceTemp: number;
  surfaceRate = 1;
  /** Rate factor and temperature (°C) per mm of depth below the surface (index = depth in mm). */
  readonly rates: Float64Array;
  readonly temps: Float64Array;
  /** Whether foragers go out now (light, surface temperature, no rain). */
  foraging = true;
  /** Rain intensity (mm/h) and relative humidity. */
  rain = 0;
  humidity: number;
  /** Evaporation of drops: d(r²)/dt (mm²/s, ≥ 0) at the surface. */
  evaporation = 0;
  /**
   * Soil moisture (env.moisture, with soil): stepped once per interval from the start, so that a
   * thread that starts late catches up to the same numbers. digRates: the digging rate factor per
   * mm of depth (BIO-NST-003).
   */
  readonly moisture: SoilMoisture | null;
  readonly digRates: Float64Array;
  private moistSlot = -1;
  private slot = -1;

  constructor(world: World) {
    this.env = new Environment(world.config);
    this.surfaceTemp = world.config.env.referenceTemp;
    this.humidity = world.config.env.humidity;
    const depth = (world.config.soil.size as readonly number[])[1]!;
    this.rates = new Float64Array(depth + 1).fill(1);
    this.temps = new Float64Array(depth + 1).fill(world.config.env.referenceTemp);
    this.digRates = new Float64Array(depth + 1).fill(1);
    this.moisture = this.env.enabled && world.config.env.moisture && world.soil ? new SoilMoisture(world.config, depth + 1) : null;
  }

  /** Bring the values up to the interval of the world's current tick. */
  update(world: World): void {
    if (!this.env.enabled) return;
    const e = world.config.env;
    const slot = Math.floor((world.tick * world.config.sim.dt) / e.updateInterval);
    if (slot === this.slot) return;
    this.slot = slot;
    const t = slot * e.updateInterval;
    this.light = this.env.light(t);
    this.surfaceTemp = this.env.surfaceTemp(t);
    this.surfaceRate = this.env.rate(this.surfaceTemp);
    for (let z = 0; z < this.rates.length; z++) {
      this.temps[z] = this.env.soilTemp(z, t);
      this.rates[z] = this.env.rate(this.temps[z]!);
    }
    this.rain = this.env.rain(t);
    this.humidity = this.env.humidity(t);
    // d(r²)/dt: 1 mm² over dropLifetime at the reference temperature and dry humidity (PHY-ENV-004).
    this.evaporation = (1 / e.dropLifetime) * dpow(2, (this.surfaceTemp - e.referenceTemp) / e.evaporationDoubling)
      * Math.max(0, 1 - this.humidity) / (1 - e.humidity);
    const [lo, hi] = e.foragingTemp as readonly [number, number];
    this.foraging = this.light >= e.foragingLight && this.surfaceTemp >= lo && this.surfaceTemp <= hi && this.rain === 0;
    if (this.moisture) this.stepMoisture(world, slot);
  }

  /** Step the soil moisture through every interval up to `slot` (each with its own weather). */
  private stepMoisture(world: World, slot: number): void {
    const e = world.config.env, m = this.moisture!;
    for (let k = this.moistSlot + 1; k <= slot; k++) {
      const t = k * e.updateInterval;
      m.step(e.updateInterval, this.env.rain(t), this.env.humidity(t), this.env.surfaceTemp(t));
    }
    this.moistSlot = slot;
    // Digging rate: none when too dry, rising to the full rate at the optimum, none at saturation.
    const [dry, opt] = world.config.dig.moistureDig as readonly [number, number];
    const sat = (e.moistureRange as readonly number[])[1]!;
    for (let z = 0; z < this.digRates.length; z++) {
      const th = m.theta[z]!;
      this.digRates[z] = th <= dry ? 0 : th < opt ? (th - dry) / (opt - dry) : Math.max(0, (sat - th) / (sat - opt));
    }
  }

  /** Soil moisture at height y below the surface (θ; 0 without the moisture model). */
  moistureAt(y: number): number {
    if (!this.moisture) return 0;
    const th = this.moisture.theta;
    return th[Math.min(th.length - 1, Math.max(0, Math.floor(-y)))]!;
  }

  /** Digging rate factor at height y (1 without the moisture model). */
  digRateAt(y: number): number {
    return this.digRates[Math.min(this.digRates.length - 1, Math.max(0, Math.floor(-y)))]!;
  }

  /**
   * How unsuitable the soil at height y is for brood (°C-equivalent): its distance from broodTemp,
   * plus broodDryCost per unit of θ below broodMoisture (with the moisture model).
   */
  broodCost(world: World, y: number): number {
    const cc = world.config.colony;
    const off = Math.abs(this.tempAt(y) - cc.broodTemp);
    if (!this.moisture) return off;
    return off + cc.broodDryCost * Math.max(0, cc.broodMoisture - this.moistureAt(y));
  }

  /** Rate factor for an agent at height y (y ≥ 0: on the surface; below: in the soil). */
  rateAt(y: number): number {
    if (y >= 0) return this.surfaceRate;
    return this.rates[Math.min(this.rates.length - 1, Math.floor(-y))]!;
  }

  /** Temperature at height y (°C; the surface's at y ≥ 0), at the current interval. */
  tempAt(y: number): number {
    if (y >= 0) return this.surfaceTemp;
    return this.temps[Math.min(this.temps.length - 1, Math.floor(-y))]!;
  }
}
