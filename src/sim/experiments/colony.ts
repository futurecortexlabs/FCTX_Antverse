/**
 * Phase 6 acceptance trials (ENG-EXP-004), one colony each:
 *
 * - removal: after a warm-up, half of the workers foraging at that moment are
 *   removed (as in forager-removal experiments); the number of foragers in the
 *   last window of the recovery period is compared with that of a control
 *   run of the same colony (same seed) left intact — the colony is still
 *   settling, so a before/after comparison would mix in that drift. The run
 *   also gives the ages of foragers and nurses before the removal (age
 *   polyethism).
 * - economy: food in the colony (crops, reserves, the queen) and larval growth
 *   over a long run, with or without food at the feeders.
 * - recruitment: food brought in by a hungry colony in the first hours, with
 *   or without trail pheromone; then workers that have never found food are
 *   sent out from the entrance onto whatever trails exist, and the share that
 *   reaches food within recruitTime is counted.
 */

import type { Config } from '../../config/params.ts';
import { S_PER_DAY } from '../../core/units.ts';
import { AgentFlag, AgentState, Caste, Task } from '../agents/store.ts';
import { BroodStage } from '../colony/brood.ts';
import { World } from '../world.ts';

/** Counts are sampled this often (s). */
const SAMPLE = 60;

export interface RemovalResult {
  seed: number;
  /** False: the control run (nobody removed). */
  removal: boolean;
  /** Mean number of foragers (task FORAGE) in the window before the removal and at the end of the recovery. */
  before: number;
  after: number;
  removed: number;
  /** Median age (days) of foragers and nurses over the window before the removal (pooled samples). */
  foragerAge: number;
  nurseAge: number;
  nurses: number;
  /** Foragers and nurses per sample over the whole run. */
  foragers: number[];
  nursesSeries: number[];
}

export interface EconomyResult {
  seed: number;
  food: boolean;
  /** Food in the colony (mg) at the start and end, and what the larvae ate meanwhile (mg). */
  start: number;
  end: number;
  larvalGrowth: number;
  intake: number;
  workers: number;
  /** Colony food per sample (every hour). */
  series: number[];
}

export interface RecruitResult {
  seed: number;
  trails: boolean;
  intake: number;
  /** Food taken in so far, every 10 minutes (mg). */
  intakeSeries: number[];
  /** Workers that had never found food sent out at the end, and how many of them reached food within recruitTime. */
  recruits: number;
  recruitsFound: number;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

function stepFor(w: World, seconds: number): void {
  const n = Math.round(seconds / w.config.sim.dt);
  for (let t = 0; t < n; t++) w.step();
}

function tasks(w: World): { foragers: number[]; nurses: number[] } {
  const a = w.agents.a, out = { foragers: [] as number[], nurses: [] as number[] };
  for (let s = 0; s < w.agents.highWater; s++) {
    if ((a.flags[s]! & AgentFlag.ALIVE) === 0 || a.caste[s] !== Caste.WORKER) continue;
    if (a.task[s] === Task.FORAGE) out.foragers.push(s);
    else if (a.task[s] === Task.NURSE) out.nurses.push(s);
  }
  return out;
}

export function runRemovalTrial(config: Config, removal = true): RemovalResult {
  const ex = config.experiment;
  const w = new World(config);
  const ageOf = (s: number): number => (w.simTime() - w.agents.a.born[s]!) / S_PER_DAY;
  const foragers: number[] = [], nursesSeries: number[] = [];
  const fAges: number[] = [], nAges: number[] = [];
  const warm = ex.removalWarmup, win = ex.removalWindow;
  for (let t = SAMPLE; t <= warm; t += SAMPLE) {
    stepFor(w, SAMPLE);
    const k = tasks(w);
    foragers.push(k.foragers.length); nursesSeries.push(k.nurses.length);
    if (t > warm - win) { for (const s of k.foragers) fAges.push(ageOf(s)); for (const s of k.nurses) nAges.push(ageOf(s)); }
  }
  const nWin = Math.round(win / SAMPLE);
  const mean = (xs: number[]): number => xs.reduce((p, x) => p + x, 0) / Math.max(1, xs.length);
  const before = mean(foragers.slice(-nWin));
  const nurses = mean(nursesSeries.slice(-nWin));
  // Remove every other forager (in slot order): half of them.
  const now = tasks(w).foragers;
  let removed = 0;
  if (removal) for (let i = 0; i < now.length; i++) if (i % 2 === 0) { w.agents.kill(now[i]!); removed++; }
  for (let t = SAMPLE; t <= ex.removalRecovery; t += SAMPLE) {
    stepFor(w, SAMPLE);
    const k = tasks(w);
    foragers.push(k.foragers.length); nursesSeries.push(k.nurses.length);
  }
  const after = mean(foragers.slice(-nWin));
  return { seed: config.sim.seed, removal, before, after, removed, foragerAge: median(fAges), nurseAge: median(nAges), nurses, foragers, nursesSeries };
}

/** All food held by the colony's adults (mg): crops and reserves, the queen's included. */
export function colonyFood(w: World): number {
  const a = w.agents.a;
  let f = 0;
  for (let s = 0; s < w.agents.highWater; s++) if ((a.flags[s]! & AgentFlag.ALIVE) !== 0) f += a.crop[s]! + a.reserve[s]!;
  return f;
}

function larvalEaten(w: World): number {
  const b = w.colony!.brood;
  let e = 0;
  for (let i = 0; i < b.highWater; i++) if (b.stage[i] === BroodStage.LARVA || b.stage[i] === BroodStage.PUPA) e += b.eaten[i]!;
  return e;
}

export function runEconomyTrial(config: Config): EconomyResult {
  const w = new World(config);
  const start = colonyFood(w);
  const series = [start];
  // Larval growth: food the larvae took from their guts (fed food not yet eaten stays in the gut).
  let grown = 0, last = larvalEaten(w);
  const hours = Math.round(config.experiment.economyDuration / 3600);
  for (let h = 0; h < hours; h++) {
    for (let m = 0; m < 60; m++) {
      stepFor(w, 60);
      const e = larvalEaten(w);
      // Pupation keeps the eaten food (pupae count); eclosion and deaths remove it — count only increases.
      grown += Math.max(0, e - last);
      last = e;
    }
    series.push(colonyFood(w));
  }
  let workers = 0;
  for (let s = 0; s < w.agents.highWater; s++) if (w.agents.isAlive(s) && w.agents.a.caste[s] === Caste.WORKER) workers++;
  return { seed: config.sim.seed, food: (config.scenario.feeders as readonly number[]).length > 0, start, end: colonyFood(w), larvalGrowth: grown, intake: w.colony!.intake, workers, series };
}

export function runRecruitTrial(config: Config): RecruitResult {
  const w = new World(config);
  const intakeSeries: number[] = [];
  const steps = Math.round(config.experiment.recruitDuration / 600);
  for (let k = 0; k < steps; k++) { stepFor(w, 600); intakeSeries.push(w.colony!.intake); }
  const intake = w.colony!.intake;
  // Recruits: idle workers that have never found food, sent out from the entrance onto
  // whatever trails the colony has laid; the share that reaches food within recruitTime.
  const ex = config.experiment, a = w.agents.a, nest = w.nest!;
  const recruits: number[] = [];
  for (let s = 0; s < w.agents.highWater && recruits.length < ex.recruits; s++) {
    const f = a.flags[s]!;
    if ((f & AgentFlag.ALIVE) === 0 || (f & AgentFlag.KNOWS_FOOD) !== 0 || a.caste[s] !== Caste.WORKER || a.task[s] !== Task.IDLE) continue;
    recruits.push(s);
  }
  for (const [k, s] of recruits.entries()) {
    a.flags[s] = a.flags[s]! & ~AgentFlag.UNDERGROUND;
    a.cell[s] = -1;
    a.posX[s] = nest.x; a.posZ[s] = nest.z;
    a.posY[s] = w.terrain.supportHeight(nest.x, nest.z) + config.locomotion.rideHeight;
    a.heading[s] = (2 * Math.PI * k) / recruits.length - Math.PI;
    a.task[s] = Task.FORAGE; a.state[s] = AgentState.EXIT; a.crop[s] = 0;
  }
  let found = 0;
  const done = new Set<number>();
  const n = Math.round(ex.recruitTime / config.sim.dt);
  for (let t = 0; t < n; t++) {
    w.step();
    for (const s of recruits) if (!done.has(s) && (a.flags[s]! & AgentFlag.KNOWS_FOOD) !== 0) { done.add(s); found++; }
  }
  return { seed: config.sim.seed, trails: config.pheromone.depositReturn > 0, intake, intakeSeries, recruits: recruits.length, recruitsFound: found };
}
