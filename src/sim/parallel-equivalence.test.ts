/**
 * Multi-threaded stepping must not change the simulation: stepping any
 * partition of the slots, in any order, and from a second World attached to
 * the same shared memory (what a helper thread does), equals world.step().
 * With a pheromone field, helpers read the coordinator's shared grid and
 * deposits are applied by the coordinator in slot order.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildConfig, type Overlay } from '../config/load.ts';
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

  it('with the pheromone field shared between threads (double bridge)', () => {
    const preset = JSON.parse(readFileSync('config/presets/double-bridge.json', 'utf8')) as Overlay;
    const cfg = buildConfig([preset, { population: { count: 120 } }]).config;
    const ref = new World(cfg);
    const main = new World(cfg, { sharedAgents: true });
    const buffer = main.pheromone!.buffer as SharedArrayBuffer;
    expect(buffer).toBeInstanceOf(SharedArrayBuffer);
    const helper = new World(cfg, {
      agents: new AgentStore(cfg.sim.capacity, { buffers: main.agents.sharedBuffers() }),
      pheromoneBuffer: buffer,
    });
    for (let t = 0; t < 1800; t++) {
      ref.step();
      const n = main.agents.highWater, cut = 37;
      helper.tick = main.tick;
      helper.stepRange(cut, n);
      main.stepRange(0, cut);
      main.completeStep();
    }
    expect(ref.pheromone!.total()).toBeGreaterThan(0);
    expect(main.stateHash()).toBe(ref.stateHash());
  });

  it('foraging by path integration on open ground (homing scenario)', () => {
    const preset = JSON.parse(readFileSync('config/presets/homing.json', 'utf8')) as Overlay;
    const cfg = buildConfig([preset, { population: { count: 200 }, forage: { exitRate: 1 } }]).config;
    const ref = new World(cfg);
    const main = new World(cfg, { sharedAgents: true });
    const helper = new World(cfg, { agents: new AgentStore(cfg.sim.capacity, { buffers: main.agents.sharedBuffers() }) });
    for (let t = 0; t < 1800; t++) {
      ref.step();
      const n = main.agents.highWater, cut = 71;
      helper.tick = main.tick;
      helper.stepRange(cut, n);
      main.stepRange(0, cut);
      main.completeStep();
    }
    expect(main.stateHash()).toBe(ref.stateHash());
  });

  it('nest excavation: any slot partition gives the same soil, mound and agents (digs and drops are granted in slot order)', () => {
    const preset = JSON.parse(readFileSync('config/presets/digging.json', 'utf8')) as Overlay;
    const cfg = buildConfig([preset, { population: { count: 80 }, soil: { size: [128, 256, 128] } }]).config;
    const ref = new World(cfg);
    const split = new World(cfg);
    for (let t = 0; t < 3600; t++) {
      ref.step();
      const n = split.agents.highWater;
      const cuts = [0, 13, 40, 41, n];
      for (let k = cuts.length - 2; k >= 0; k--) split.stepRange(cuts[k]!, cuts[k + 1]!);
      split.completeStep();
    }
    expect(ref.soil!.dug).toBeGreaterThan(ref.pitVoxels);
    expect(split.stateHash()).toBe(ref.stateHash());
  });
});
