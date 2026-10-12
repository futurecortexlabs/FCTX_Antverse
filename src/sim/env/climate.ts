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
  /** Rate factor per mm of depth below the surface (index = depth in mm). */
  readonly rates: Float64Array;
  /** Whether foragers go out now (light and surface temperature). */
  foraging = true;
  private slot = -1;

  constructor(world: World) {
    this.env = new Environment(world.config);
    this.surfaceTemp = world.config.env.referenceTemp;
    const depth = (world.config.soil.size as readonly number[])[1]!;
    this.rates = new Float64Array(depth + 1).fill(1);
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
    for (let z = 0; z < this.rates.length; z++) this.rates[z] = this.env.rate(this.env.soilTemp(z, t));
    const [lo, hi] = e.foragingTemp as readonly [number, number];
    this.foraging = this.light >= e.foragingLight && this.surfaceTemp >= lo && this.surfaceTemp <= hi;
  }

  /** Rate factor for an agent at height y (y ≥ 0: on the surface; below: in the soil). */
  rateAt(y: number): number {
    if (y >= 0) return this.surfaceRate;
    return this.rates[Math.min(this.rates.length - 1, Math.floor(-y))]!;
  }

  /** Soil temperature at height y (°C), at the current interval. */
  tempAt(world: World, y: number): number {
    const t = this.slot * world.config.env.updateInterval;
    return y >= 0 ? this.surfaceTemp : this.env.soilTemp(-y, t);
  }
}
