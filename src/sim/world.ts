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
import { AgentStore } from './agents/store.ts';
import { spawnWorkers } from './population.ts';
import { bodyPose } from './rules/body-pose.ts';
import { explore } from './rules/explore.ts';

export type Rule = (world: World, from: number, to: number) => void;

/** Rules in update order. Each is per-agent (no cross-agent reads yet). */
export const RULES: readonly Rule[] = [explore, bodyPose];

export interface WorldOptions {
  /** Use these agents instead of allocating and spawning (thread helpers attach to shared memory). */
  agents?: AgentStore;
  /** Allocate the agents in shared memory so helper threads can step slices of them. */
  sharedAgents?: boolean;
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
  private readonly terrainDigest: number;

  constructor(config: Config, opts: WorldOptions = {}) {
    this.config = config;
    this.seed = config.sim.seed >>> 0;
    this.terrain = new Terrain(config);
    this.terrainDigest = this.terrain.digest();
    this.poseAlpha = 1 - dexp(-config.sim.dt / config.locomotion.poseSmoothing);
    if (opts.agents) {
      this.agents = opts.agents;
    } else {
      this.agents = new AgentStore(config.sim.capacity, { shared: opts.sharedAgents === true });
      spawnWorkers(this, config.population.count);
    }
  }

  /** Run every rule on slots [from, to) for the current tick (does not advance the tick). */
  stepRange(from: number, to: number): void {
    for (const rule of RULES) rule(this, from, to);
  }

  completeStep(): void {
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
    return h.digest();
  }
}
