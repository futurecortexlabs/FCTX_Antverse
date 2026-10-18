/**
 * Soil-moisture experiments (ENG-EXP-007), observation only: how much a
 * colony digs hour by hour (dry vs moist soil, rain vs no rain), and how dry
 * the soil around its brood is over the day.
 */

import type { Config } from '../../config/params.ts';
import { BroodStage } from '../colony/brood.ts';
import { World } from '../world.ts';

const S_PER_HOUR = 3600;

export interface DigSeries {
  seed: number;
  /** Pellets dug in each hour of the run. */
  hourly: number[];
}

/** A colony digging from its starting pit for `hours`: pellets dug per hour. */
export function runMoistDigTrial(config: Config, hours: number): DigSeries {
  const w = new World(config);
  const per = Math.round(S_PER_HOUR / config.sim.dt);
  const hourly: number[] = [];
  let last = w.soil!.dug;
  for (let h = 0; h < hours; h++) {
    for (let t = 0; t < per; t++) w.step();
    hourly.push(w.soil!.dug - last);
    last = w.soil!.dug;
  }
  return { seed: config.sim.seed, hourly };
}

export interface BroodMoistResult {
  seed: number;
  /** Per hour: mean θ at the brood, mean shortfall below colony.broodMoisture, mean distance from broodTemp (°C). */
  theta: number[];
  short: number[];
  off: number[];
}

/** A colony over `hours`: how moist and how warm the soil around its brood is, hour by hour. */
export function runBroodMoistTrial(config: Config, hours: number): BroodMoistResult {
  const w = new World(config);
  const per = Math.round(S_PER_HOUR / config.sim.dt);
  const cc = config.colony, soil = w.soil!, v = new Int32Array(3);
  const theta: number[] = [], short: number[] = [], off: number[] = [];
  for (let h = 0; h < hours; h++) {
    let th = 0, sh = 0, of = 0, n = 0;
    for (let t = 0; t < per; t++) {
      w.step();
      if (t % Math.round(per / 6) !== 0) continue; // every 10 minutes
      const b = w.colony!.brood;
      for (let i = 0; i < b.highWater; i++) {
        if (b.stage[i] === BroodStage.NONE) continue;
        soil.unindex(b.cell[i]!, v);
        const y = soil.centreY(v[1]!), m = w.climate.moistureAt(y);
        th += m; sh += Math.max(0, cc.broodMoisture - m); of += Math.abs(w.climate.tempAt(y) - cc.broodTemp); n++;
      }
    }
    theta.push(th / Math.max(1, n)); short.push(sh / Math.max(1, n)); off.push(of / Math.max(1, n));
  }
  return { seed: config.sim.seed, theta, short, off };
}
