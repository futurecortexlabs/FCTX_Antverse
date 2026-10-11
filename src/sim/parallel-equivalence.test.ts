/**
 * Multi-threaded stepping must not change the simulation: stepping any
 * partition of the slots, in any order, and from a second World attached to
 * the same shared memory (what a helper thread does), equals world.step().
 */

import { describe, expect, it } from 'vitest';
import { buildConfig } from '../config/load.ts';
import { AgentStore } from './agents/store.ts';
import { World } from './world.ts';

const { config } = buildConfig([{ population: { count: 240 } }]);
const TICKS = 300;

describe('parallel stepping equivalence', () => {
  it('any slot partition, in any order, gives the same state as step()', () => {
    const ref = new World(config);
    const split = new World(config);
    for (let t = 0; t < TICKS; t++) {
      ref.step();
      const n = split.agents.highWater;
      // Uneven slices, processed back to front.
      const cuts = [0, 17, 90, 91, 200, n];
      for (let k = cuts.length - 2; k >= 0; k--) split.stepRange(cuts[k]!, cuts[k + 1]!);
      split.completeStep();
    }
    expect(split.stateHash()).toBe(ref.stateHash());
  });

  it('a second World attached to shared agents (a helper thread) can step a slice', () => {
    const ref = new World(config);
    const main = new World(config, { sharedAgents: true });
    const helper = new World(config, { agents: new AgentStore(config.sim.capacity, { buffers: main.agents.sharedBuffers() }) });
    for (let t = 0; t < TICKS; t++) {
      ref.step();
      const n = main.agents.highWater, mid = n >> 1;
      helper.tick = main.tick;
      helper.stepRange(mid, n);
      main.stepRange(0, mid);
      main.completeStep();
    }
    expect(main.stateHash()).toBe(ref.stateHash());
  });
});
