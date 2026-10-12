/// <reference lib="webworker" />
/**
 * Simulation helper thread: attaches to the coordinator's shared agents with
 * its own (identical) World and terrain, and steps the slot slice assigned to
 * it each tick. See parallel.ts.
 */

import { AgentStore } from '../sim/agents/store.ts';
import { World } from '../sim/world.ts';
import { Ctl, type HelperIn, type HelperOut } from './parallel.ts';

declare const self: DedicatedWorkerGlobalScope;

const post = (m: HelperOut): void => self.postMessage(m);

async function serve(world: World, ctl: Int32Array, index: number, attachId: number): Promise<void> {
  let seen = Atomics.load(ctl, Ctl.GEN);
  for (;;) {
    const w = Atomics.waitAsync(ctl, Ctl.GEN, seen);
    if (w.async) await w.value;
    // A newer attach replaced this world: stop without touching DONE.
    if (Atomics.load(ctl, Ctl.ATTACH) !== attachId) return;
    seen = Atomics.load(ctl, Ctl.GEN);
    const from = Atomics.load(ctl, Ctl.RANGES + 2 * index);
    const to = Atomics.load(ctl, Ctl.RANGES + 2 * index + 1);
    if (to > from) {
      world.tick = Atomics.load(ctl, Ctl.TICK);
      world.stepRange(from, to);
    }
    Atomics.add(ctl, Ctl.DONE, 1);
    Atomics.notify(ctl, Ctl.DONE);
  }
}

self.onmessage = (e: MessageEvent<HelperIn>) => {
  const m = e.data;
  try {
    const agents = new AgentStore(m.config.sim.capacity, { buffers: m.buffers });
    const world = new World(m.config, {
      agents,
      ...(m.pheromone ? { pheromoneBuffer: m.pheromone } : {}),
      ...(m.nest ? { moundBuffer: m.nest.mound, densityBuffer: m.nest.density, digLogBuffer: m.nest.digLog } : {}),
      ...(m.nest?.contacts ? { contactBuffers: m.nest.contacts } : {}),
      ...(m.surface ? { surfaceBuffers: m.surface } : {}),
      ...(m.drops ? { dropBuffers: m.drops } : {}),
    });
    const ctl = new Int32Array(m.control);
    post({ type: 'attached', attachId: m.attachId, index: m.index });
    void serve(world, ctl, m.index, m.attachId).catch((err: unknown) => post({ type: 'error', message: String(err) }));
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
