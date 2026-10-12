/**
 * Phase 7 acceptance trials (ENG-EXP-005), one colony each in the field
 * scenario (colony + environment + collision avoidance):
 *
 * - day: two days from 06:00. Foragers on the surface by day and by night;
 *   the brood's depth and its distance from broodTemp, compared with the same
 *   colony whose nurses do not carry brood (control).
 * - temperature: a day's foraging on a cool day against a warm one.
 * - rain: a shower at midday; foragers on the surface before, during and
 *   after it; ants stepping into water drops; drops left afterwards.
 * - recruitment (moved from Phase 6): a new feeder appears far from the
 *   nest; crop fills taken there in the hours after it is first found, with
 *   and without trail pheromone.
 */

import type { Config } from '../../config/params.ts';
import { S_PER_H } from '../../core/units.ts';
import { AgentFlag, AgentState, Caste, Request } from '../agents/store.ts';
import { BroodStage } from '../colony/brood.ts';
import { World } from '../world.ts';

const SAMPLE = 60;

function stepFor(w: World, seconds: number): void {
  const n = Math.round(seconds / w.config.sim.dt);
  for (let t = 0; t < n; t++) w.step();
}

/** Workers out foraging on the surface (searching, carrying food home or searching for the nest). */
export function foragersOut(w: World): number {
  const a = w.agents.a;
  let n = 0;
  for (let s = 0; s < w.agents.highWater; s++) {
    if ((a.flags[s]! & (AgentFlag.ALIVE | AgentFlag.UNDERGROUND)) !== AgentFlag.ALIVE || a.caste[s] !== Caste.WORKER) continue;
    const st = a.state[s]!;
    if (st === AgentState.SEARCH || st === AgentState.RETURN || st === AgentState.NEST_SEARCH) n++;
  }
  return n;
}

/** Mean depth of the brood (mm) and its mean distance from broodTemp (°C). */
export function broodThermal(w: World): { depth: number; off: number } {
  const b = w.colony!.brood, soil = w.soil!, v = new Int32Array(3), pref = w.config.colony.broodTemp;
  let depth = 0, off = 0, n = 0;
  for (let i = 0; i < b.highWater; i++) {
    if (b.stage[i] === BroodStage.NONE) continue;
    soil.unindex(b.cell[i]!, v);
    const y = soil.centreY(v[1]!);
    depth += -y; off += Math.abs(w.climate.tempAt(y) - pref); n++;
  }
  return n ? { depth: depth / n, off: off / n } : { depth: NaN, off: NaN };
}

export interface DayResult {
  seed: number;
  carry: boolean;
  /** Mean foragers on the surface while light ≥ 0.2, and in the dark (light = 0). */
  day: number;
  night: number;
  /** Over the second day (24–48 h): mean brood distance from broodTemp; mean brood depth 09–11 h and 15–17 h solar time. */
  off: number;
  morningDepth: number;
  afternoonDepth: number;
  /** Per hour: foragers out (mean), brood depth, brood off, light. */
  hourly: number[][];
}

export function runDayTrial(config: Config, carry: boolean): DayResult {
  const w = new World(config);
  const hours = Math.round(config.experiment.dayDuration / S_PER_H);
  let daySum = 0, dayN = 0, nightSum = 0, nightN = 0, offSum = 0, offN = 0;
  const morning: number[] = [], afternoon: number[] = [];
  const hourly: number[][] = [];
  for (let h = 0; h < hours; h++) {
    let out = 0, depth = 0, off = 0, light = 0;
    for (let m = 0; m < S_PER_H / SAMPLE; m++) {
      stepFor(w, SAMPLE);
      const f = foragersOut(w), l = w.climate.light, bt = broodThermal(w);
      out += f; depth += bt.depth; off += bt.off; light += l;
      if (l >= config.experiment.dayLight) { daySum += f; dayN++; } else if (l === 0) { nightSum += f; nightN++; }
      if (h >= hours / 2) {
        offSum += bt.off; offN++;
        const hour = w.climate.env.hour(w.simTime());
        const [m0, m1] = config.experiment.morningHours as readonly [number, number];
        const [a0, a1] = config.experiment.afternoonHours as readonly [number, number];
        if (hour >= m0 && hour < m1) morning.push(bt.depth);
        if (hour >= a0 && hour < a1) afternoon.push(bt.depth);
      }
    }
    const k = S_PER_H / SAMPLE;
    hourly.push([out / k, depth / k, off / k, light / k]);
  }
  const mean = (xs: number[]): number => xs.reduce((p, x) => p + x, 0) / Math.max(1, xs.length);
  return {
    seed: config.sim.seed, carry, day: daySum / Math.max(1, dayN), night: nightSum / Math.max(1, nightN),
    off: offSum / Math.max(1, offN), morningDepth: mean(morning), afternoonDepth: mean(afternoon), hourly,
  };
}

export interface TempResult { seed: number; meanTemp: number; intake: number; out: number }

/** One day (06:00–18:00) at a given mean temperature: food taken in and foragers out (mean). */
export function runTempTrial(config: Config): TempResult {
  const w = new World(config);
  let out = 0, n = 0;
  const end = config.experiment.tempDuration;
  for (let t = 0; t < end; t += SAMPLE) { stepFor(w, SAMPLE); out += foragersOut(w); n++; }
  return { seed: config.sim.seed, meanTemp: config.env.meanTemp, intake: w.colony!.intake, out: out / n };
}

export interface RainResult {
  seed: number;
  /** Mean foragers out over the hour before the rain, during it (after its first rainResponse), and the hour ending recovery after it. */
  before: number;
  during: number;
  after: number;
  /** Free ants stepping from dry ground into a drop, ants caught by forming drops, drops at the end of the rain and at the end of the run. */
  entered: number;
  hits: number;
  dropsAtEnd: number;
  dropsLeft: number;
  series: number[];
}

export function runRainTrial(config: Config): RainResult {
  const w = new World(config), a = w.agents.a, ex = config.experiment;
  const r = config.env.rain as readonly number[];
  const start = r[0]! * S_PER_H, stop = start + r[1]! * S_PER_H, end = stop + ex.rainRecovery;
  const series: number[] = [];
  let before = 0, nb = 0, during = 0, nd = 0, after = 0, na = 0, entered = 0, hits = 0, dropsAtEnd = 0;
  let wet: boolean[] = [];
  const dt = config.sim.dt;
  for (let tick = 0; tick * dt < end; tick++) {
    const stun = Array.from(a.stun.subarray(0, w.agents.highWater));
    w.step();
    const t = w.simTime();
    const d = w.drops!;
    // Entries into water by free ants, and new hits (stun rising).
    const now: boolean[] = [];
    for (let s = 0; s < w.agents.highWater; s++) {
      const out = (a.flags[s]! & (AgentFlag.ALIVE | AgentFlag.UNDERGROUND)) === AgentFlag.ALIVE;
      now[s] = out && d.at(a.posX[s]!, a.posZ[s]!) >= 0;
      if (now[s] && wet[s] === false && stun[s] === 0 && a.stun[s] === 0) entered++;
      if (out && a.stun[s]! > (stun[s] ?? 0) + dt) hits++;
    }
    wet = now;
    if (Math.abs(t - stop) < dt / 2) dropsAtEnd = d.count;
    if (tick % Math.round(SAMPLE / dt) !== 0) continue;
    const f = foragersOut(w);
    series.push(f);
    if (t >= start - S_PER_H && t < start) { before += f; nb++; }
    else if (t >= start + ex.rainResponse && t < stop) { during += f; nd++; }
    else if (t >= end - S_PER_H) { after += f; na++; }
  }
  return {
    seed: config.sim.seed, before: before / Math.max(1, nb), during: during / Math.max(1, nd), after: after / Math.max(1, na),
    entered, hits, dropsAtEnd, dropsLeft: w.drops!.count, series,
  };
}

export interface NewFoodResult { seed: number; trails: boolean; found: number; fills: number; recruits: number }

/**
 * A feeder appearing during the run (scenario.lateFeeders, the last one): crop fills taken there
 * in newFoodWindow after it is first found, and how many different workers took them.
 */
export function runNewFoodTrial(config: Config): NewFoodResult {
  const w = new World(config), c = w.colony!, a = w.agents.a;
  const k = c.feeders.length - 1;
  const ex = config.experiment;
  const visitors = new Set<number>();
  let fillsAtStart = -1;
  const until = ex.newFoodLimit;
  const dt = config.sim.dt;
  for (let tick = 0; tick * dt < until; tick++) {
    // Who fills at the new feeder this tick: the request is granted in completeStep.
    w.stepRange(0, w.agents.highWater);
    if (c.firstFill[k]! >= 0) for (let s = 0; s < w.agents.highWater; s++) if (a.request[s] === Request.FILL && a.requestCell[s] === k) visitors.add(s);
    w.completeStep();
    if (c.firstFill[k]! >= 0 && fillsAtStart < 0) fillsAtStart = c.fills[k]!;
    if (c.firstFill[k]! >= 0 && w.simTime() - c.firstFill[k]! >= ex.newFoodWindow) break;
  }
  return { seed: config.sim.seed, trails: config.pheromone.depositReturn > 0, found: c.firstFill[k]!, fills: c.fills[k]!, recruits: visitors.size };
}
