/**
 * Observing a double-bridge run (Phase 3), the way the experiments counted:
 * traffic is the number of ants that cross each branch from one fork to the
 * other (Goss et al. 1989; Beckers et al. 1992). A crossing is attributed to
 * the branch whose middle gate the ant passed on the way; an ant that enters
 * a branch and comes back out at the same fork is not counted.
 *
 * Observation only: nothing here feeds back into the simulation.
 */

import type { Config } from '../../config/params.ts';
import { Branch } from '../../terrain/apparatus.ts';
import { AgentState } from '../agents/store.ts';
import { World } from '../world.ts';

export interface BinCounts {
  short: number;
  long: number;
  /** Food deliveries to the nest. */
  trips: number;
  /** Ants searching for the nest (home vector run off) at the end of the bin. */
  searching: number;
}

export class BridgeObserver {
  readonly world: World;
  /** Crossings per bin of `binTicks`. */
  readonly bins: BinCounts[] = [];
  private readonly binTicks: number;
  private readonly branch: Int8Array;
  private readonly fromB: Uint8Array;
  private readonly carrying: Uint8Array;
  private current: BinCounts = { short: 0, long: 0, trips: 0, searching: 0 };
  private ticks = 0;

  constructor(world: World, binSeconds: number) {
    if (!world.bridge) throw new Error('BridgeObserver: the world has no double bridge');
    this.world = world;
    this.binTicks = Math.max(1, Math.round(binSeconds / world.config.sim.dt));
    const n = world.agents.capacity;
    this.branch = new Int8Array(n);
    this.fromB = new Uint8Array(n).fill(2);
    this.carrying = new Uint8Array(n);
    const a = world.agents.a;
    for (let s = 0; s < world.agents.highWater; s++) this.carrying[s] = a.state[s] === AgentState.RETURN ? 1 : 0;
  }

  /** Call after every World.step(). */
  observe(): void {
    const b = this.world.bridge!;
    const a = this.world.agents.a;
    const c = this.current;
    const lo = b.forkA + b.half, hi = b.forkB - b.half;
    for (let s = 0; s < this.world.agents.highWater; s++) {
      const x = a.posX[s]!, z = a.posZ[s]!;
      // fromB: the fork zone the ant was last in (0 = A side, 1 = B side, 2 = not yet).
      if (x <= lo || x >= hi) {
        const side = x <= lo ? 0 : 1;
        const from = this.fromB[s]!;
        if (from !== 2 && from !== side && this.branch[s] !== Branch.NONE) {
          if (this.branch[s] === Branch.SHORT) c.short++; else c.long++;
        }
        this.fromB[s] = side;
        this.branch[s] = Branch.NONE;
      } else {
        const g = b.gateAt(x, z);
        if (g !== Branch.NONE) this.branch[s] = g;
      }
      const ret = a.state[s] === AgentState.RETURN ? 1 : 0;
      if (this.carrying[s] === 1 && ret === 0) c.trips++;
      this.carrying[s] = ret;
    }
    if (++this.ticks % this.binTicks === 0) {
      for (let s = 0; s < this.world.agents.highWater; s++) if (a.state[s] === AgentState.NEST_SEARCH) c.searching++;
      this.bins.push(c);
      this.current = { short: 0, long: 0, trips: 0, searching: 0 };
    }
  }
}

export interface TrialResult {
  seed: number;
  bins: BinCounts[];
  /** Share of crossings on the short branch over the final window. */
  finalShare: number;
  converged: boolean;
}

/** Share of short-branch crossings over the last `count` bins. */
export function shortShare(bins: readonly BinCounts[], count: number): number {
  let s = 0, l = 0;
  for (const b of bins.slice(Math.max(0, bins.length - count))) { s += b.short; l += b.long; }
  return s + l > 0 ? s / (s + l) : 0.5;
}

/** One run of the experiment protocol (config.experiment) on a fresh world. */
export function runBridgeTrial(config: Config): TrialResult {
  const ex = config.experiment;
  const world = new World(config);
  const obs = new BridgeObserver(world, ex.bin);
  const ticks = Math.round(ex.duration / config.sim.dt);
  const wipe = ex.wipeAt > 0 ? Math.round(ex.wipeAt / config.sim.dt) : -1;
  for (let t = 0; t < ticks; t++) {
    if (t === wipe) world.pheromone?.clear();
    world.step();
    obs.observe();
  }
  const finalShare = shortShare(obs.bins, Math.round(ex.window / ex.bin));
  return { seed: config.sim.seed, bins: obs.bins, finalShare, converged: finalShare > ex.convergedShare };
}
