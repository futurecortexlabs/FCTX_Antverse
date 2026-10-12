/**
 * The environment as the simulation uses it (Phase 7): light, surface
 * temperature and the ectotherm rate factor at the surface and at every depth
 * in the soil, refreshed every env.updateInterval of simulated time. The
 * values are computed for the start of the interval the tick falls in, so
 * every thread (each keeps its own Climate) gets exactly the same numbers.
 */

import { Environment } from '../../env/environment.ts';
import type { World } from '../world.ts';

export class Climate {
  readonly env: Environment;
  light = 1;
  surfaceTemp: number;
  surfaceRate = 1;
  /** Rate factor and temperature (°C) per mm of depth below the surface (index = depth in mm). */
  readonly rates: Float64Array;
  readonly temps: Float64Array;
  /** Whether foragers go out now (light and surface temperature). */
  foraging = true;
  private slot = -1;

  constructor(world: World) {
    this.env = new Environment(world.config);
    this.surfaceTemp = world.config.env.referenceTemp;
    const depth = (world.config.soil.size as readonly number[])[1]!;
    this.rates = new Float64Array(depth + 1).fill(1);
    this.temps = new Float64Array(depth + 1).fill(world.config.env.referenceTemp);
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
    const [lo, hi] = e.foragingTemp as readonly [number, number];
    this.foraging = this.light >= e.foragingLight && this.surfaceTemp >= lo && this.surfaceTemp <= hi;
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
