/**
 * The authoritative simulation state and its fixed-step update.
 *
 * World knows nothing about wall-clock time, threads or rendering: step()
 * advances exactly one dt. The same World runs in the sim worker, in Node
 * tests and in headless experiments, and must produce the same stateHash()
 * for the same (config, seed, tick) everywhere.
 */

import { StateHasher } from '../core/statehash.ts';
import type { Config } from '../config/params.ts';
import { AgentStore } from './agents/store.ts';
import { debugRandomWalk, spawnDebugWalkers } from './rules/debug-random-walk.ts';

export type Rule = (world: World) => void;

export class World {
  readonly config: Config;
  readonly seed: number;
  /** Index of the next step to compute (= number of completed steps). */
  tick = 0;
  readonly agents: AgentStore;
  private readonly rules: Rule[];

  constructor(config: Config) {
    this.config = config;
    this.seed = config.sim.seed >>> 0;
    this.agents = new AgentStore(config.sim.capacity);
    // Phase 0: pipeline fixture only. Replaced by real rules from Phase 2.
    this.rules = [debugRandomWalk];
    spawnDebugWalkers(this, config.debugWalk.count);
  }

  step(): void {
    for (const rule of this.rules) rule(this);
    this.tick++;
  }

  simTime(): number {
    return this.tick * this.config.sim.dt;
  }

  stateHash(): number {
    const h = new StateHasher().word(this.seed).word(this.tick);
    h.word(this.agents.highWater).word(this.agents.alive);
    for (const s of this.agents.freeSlots()) h.word(s);
    for (const v of this.agents.views()) h.view(v);
    return h.digest();
  }
}
