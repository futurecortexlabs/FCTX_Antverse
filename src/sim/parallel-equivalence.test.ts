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

  it('nest excavation with a helper thread: it replays the dig log (also what was dug before it attached) and walks the same tunnels', () => {
    const preset = JSON.parse(readFileSync('config/presets/digging.json', 'utf8')) as Overlay;
    const cfg = buildConfig([preset, { population: { count: 80 }, soil: { size: [128, 256, 128] } }]).config;
    const ref = new World(cfg);
    const main = new World(cfg, { sharedAgents: true });
    const step = (w: World): void => { w.stepRange(0, w.agents.highWater); w.completeStep(); };
    for (let t = 0; t < 1200; t++) { ref.step(); step(main); } // the helper attaches late
    const nest = main.sharedNest()!;
    expect(nest).not.toBeNull();
    const helper = new World(cfg, {
      agents: new AgentStore(cfg.sim.capacity, { buffers: main.agents.sharedBuffers() }),
      moundBuffer: nest.mound, densityBuffer: nest.density, digLogBuffer: nest.digLog,
    });
    expect(helper.sharedNest()).toBeNull(); // helpers never hand out the log
    for (let t = 0; t < 2400; t++) {
      ref.step();
      const n = main.agents.highWater, cut = 29;
      helper.tick = main.tick;
      helper.stepRange(cut, n);
      main.stepRange(0, cut);
      main.completeStep();
    }
    expect(ref.soil!.dug - ref.pitVoxels).toBeGreaterThan(50);
    expect(main.digLog!.count).toBe(main.soil!.dug - main.pitVoxels);
    expect(main.stateHash()).toBe(ref.stateHash());
    expect(helper.soil!.dug).toBe(main.soil!.dug);
    expect(helper.density!.open).toEqual(main.density!.open);
  });

  it('a colony with helper threads: contacts, trophallaxis, tasks and brood demand read from shared memory', () => {
    const preset = JSON.parse(readFileSync('config/presets/colony.json', 'utf8')) as Overlay;
    const cfg = buildConfig([preset, { population: { count: 90 }, soil: { size: [128, 256, 128] }, scenario: { feeders: [40, 0] }, colony: { engageRate: 0.05 } }]).config;
    const ref = new World(cfg);
    const main = new World(cfg, { sharedAgents: true });
    const nest = main.sharedNest()!;
    expect(nest.contacts).not.toBeNull();
    const helpers = [0, 1].map(() => new World(cfg, {
      agents: new AgentStore(cfg.sim.capacity, { buffers: main.agents.sharedBuffers() }),
      pheromoneBuffer: main.pheromone!.buffer as SharedArrayBuffer,
      moundBuffer: nest.mound, densityBuffer: nest.density, digLogBuffer: nest.digLog, contactBuffers: nest.contacts!,
    }));
    for (let t = 0; t < 3600; t++) {
      ref.step();
      const n = main.agents.highWater, c1 = 31, c2 = 64;
      helpers[1]!.tick = main.tick; helpers[1]!.stepRange(c2, n);
      helpers[0]!.tick = main.tick; helpers[0]!.stepRange(c1, c2);
      main.stepRange(0, c1);
      main.completeStep();
    }
    expect(ref.colony!.intake).toBeGreaterThan(0);
    expect(main.stateHash()).toBe(ref.stateHash());
  });
});
