/**
 * The authoritative simulation state and its fixed-step update.
 *
 * World knows nothing about wall-clock time, threads or rendering: step()
 * advances exactly one dt. The same World runs in the sim worker, in Node
 * tests and in headless experiments, and must produce the same stateHash()
 * for the same (config, seed, tick) everywhere.
 *
 * Rules operate on a slot range and only read/write the agents in it, so a
 * step can be split across threads (worker/parallel.ts) without changing the
 * result: stepRange() over any partition of [0, highWater), followed by one
 * completeStep(), equals step().
 */

import { dexp } from '../core/dmath.ts';
import { StateHasher } from '../core/statehash.ts';
import type { Config } from '../config/params.ts';
import { Terrain } from '../terrain/terrain.ts';
import { DoubleBridge, homingSites, type Site } from '../terrain/apparatus.ts';
import { PheromoneField } from './pheromone/field.ts';
import { forage } from './rules/forage.ts';
import { navigate, pathIntegrate } from './rules/navigate.ts';
import { layTrail, trail } from './rules/trail.ts';
import { AgentStore } from './agents/store.ts';
import { spawnWorkers } from './population.ts';
import { bodyPose } from './rules/body-pose.ts';
import { explore } from './rules/explore.ts';

export type Rule = (world: World, from: number, to: number) => void;

/**
 * Rules in update order. Each reads the shared environment (terrain, the
 * pheromone field as it was at the start of the tick) and writes only its own
 * agents; pheromone deposits are recorded per agent and applied afterwards.
 * trail and navigate request turns, explore moves, pathIntegrate measures the move.
 */
export const RULES: readonly Rule[] = [forage, trail, navigate, explore, pathIntegrate, layTrail, bodyPose];

export type { Site };

export interface WorldOptions {
  /** Use these agents instead of allocating and spawning (thread helpers attach to shared memory). */
  agents?: AgentStore;
  /** Allocate the agents in shared memory so helper threads can step slices of them. */
  sharedAgents?: boolean;
  /** Attach to an existing pheromone grid (thread helpers). */
  pheromoneBuffer?: SharedArrayBuffer;
  /** Allocate the pheromone grid in shared memory (helpers or the renderer read it). */
  sharedField?: boolean;
}

export class World {
  readonly config: Config;
  readonly seed: number;
  /** Index of the next step to compute (= number of completed steps). */
  tick = 0;
  readonly agents: AgentStore;
  readonly terrain: Terrain;
  /** Per-step blend factor of the body pose filter: 1 - exp(-dt/τ). */
  readonly poseAlpha: number;
  /** Experimental apparatus, if the scenario uses one. */
  readonly bridge: DoubleBridge | null;
  /** Nest and food source of a foraging scenario (null on open ground without one). */
  readonly nest: Site | null;
  readonly feeder: Site | null;
  /**
   * Trail pheromone over the apparatus. Open ground has no field yet: nothing
   * there lays trail until the colony forages (Phase 6), and a 1 mm grid over
   * the whole 2 m square would cost 16 MB per world for nothing.
   */
  readonly pheromone: PheromoneField | null;
  private readonly terrainDigest: number;

  constructor(config: Config, opts: WorldOptions = {}) {
    this.config = config;
    this.seed = config.sim.seed >>> 0;
    this.terrain = new Terrain(config);
    this.terrainDigest = this.terrain.digest();
    this.poseAlpha = 1 - dexp(-config.sim.dt / config.locomotion.poseSmoothing);
    this.bridge = config.scenario.doubleBridge ? new DoubleBridge(config) : null;
    if (this.bridge) {
      this.nest = this.bridge.nest;
      this.feeder = this.bridge.feeder;
    } else if (config.scenario.homing) {
      ({ nest: this.nest, feeder: this.feeder } = homingSites(config));
    } else {
      this.nest = null;
      this.feeder = null;
    }
    this.pheromone = this.makeField(opts);
    if (opts.agents) {
      this.agents = opts.agents;
    } else {
      this.agents = new AgentStore(config.sim.capacity, { shared: opts.sharedAgents === true });
      spawnWorkers(this, config.population.count);
    }
  }

  private makeField(opts: WorldOptions): PheromoneField | null {
    const pc = this.config.pheromone;
    const b = this.bridge;
    if (!b) return null;
    const margin = this.config.scenario.bridgeWidth;
    // Grid nodes on multiples of the cell, so the axis z = 0 is a row of nodes and
    // mirror-image geometry gives a mirror-image grid.
    const c = pc.cell;
    const x0 = Math.floor((b.minX - margin) / c) * c, z0 = Math.floor((b.minZ - margin) / c) * c;
    const x1 = Math.ceil((b.maxX + margin) / c) * c, z1 = Math.ceil((b.maxZ + margin) / c) * c;
    const rect = { x0, z0, width: x1 - x0, depth: z1 - z0 };
    return new PheromoneField(
      { ...rect, cell: pc.cell, lifetime: pc.lifetime, diffusion: pc.diffusion, dt: pc.period * this.config.sim.dt, epsilon: pc.epsilon },
      opts.sharedAgents === true || opts.sharedField === true,
      opts.pheromoneBuffer,
    );
  }

  /** Run every rule on slots [from, to) for the current tick (does not advance the tick). */
  stepRange(from: number, to: number): void {
    for (const rule of RULES) rule(this, from, to);
  }

  /**
   * Finish the tick on the coordinating thread: lay this tick's pheromone in
   * slot order (deterministic regardless of threads), update the field on its
   * own period, advance the tick.
   */
  completeStep(): void {
    const field = this.pheromone;
    if (field) {
      const a = this.agents.a;
      for (let s = 0; s < this.agents.highWater; s++) {
        const q = a.deposit[s]!;
        if (q > 0) { field.deposit(a.posX[s]!, a.posZ[s]!, q); a.deposit[s] = 0; }
      }
      if ((this.tick + 1) % this.config.pheromone.period === 0) field.step();
    }
    this.tick++;
  }

  step(): void {
    this.stepRange(0, this.agents.highWater);
    this.completeStep();
  }

  simTime(): number {
    return this.tick * this.config.sim.dt;
  }

  stateHash(): number {
    const h = new StateHasher().word(this.seed).word(this.tick).word(this.terrainDigest);
    h.word(this.agents.highWater).word(this.agents.alive);
    for (const s of this.agents.freeSlots()) h.word(s);
    for (const v of this.agents.views()) h.view(v);
    if (this.pheromone) h.view(this.pheromone.data);
    return h.digest();
  }
}
