/**
 * Multi-threaded stepping (coordinator side). docs/ARCHITECTURE.md §3
 *
 * Agents live in SharedArrayBuffers. Each tick the slot range [0, highWater)
 * is cut into equal slices: the coordinator steps the first, helper workers
 * (sim-helper.worker.ts) the others, all on the same tick. Rules only read and
 * write their own slots (plus read-only terrain), so the result is
 * bit-identical to single-threaded stepping for any number of threads — which
 * also means the coordinator can step alone at any time (while helpers are
 * still starting, or when there are too few agents to be worth splitting).
 *
 * Synchronisation uses one Int32Array in shared memory: the coordinator bumps
 * GEN and notifies; helpers wake (Atomics.waitAsync, so their event loop stays
 * free for messages), step their slice and increment DONE; the coordinator
 * blocks on DONE (Atomics.wait) until all helpers are finished.
 */

import type { Config } from '../config/params.ts';
import { isSharedBuffer } from '../core/soa.ts';
import type { World } from '../sim/world.ts';

export const Ctl = { GEN: 0, DONE: 1, TICK: 2, ATTACH: 3, RANGES: 4 } as const;

export type HelperIn = {
  type: 'attach';
  config: Config;
  buffers: Record<string, SharedArrayBuffer>;
  /** The pheromone grid (read-only for helpers). */
  pheromone: SharedArrayBuffer | null;
  control: SharedArrayBuffer;
  index: number;
  attachId: number;
};

export type HelperOut =
  | { type: 'attached'; attachId: number; index: number }
  | { type: 'error'; message: string };

/** Wait timeout (ms) of the coordinator's DONE loop; it re-checks, so this only bounds a single wait. */
const WAIT_SLICE_MS = 50;

export class ParallelStepper {
  readonly threads: number;
  private readonly helpers: Worker[];
  private readonly ctl: Int32Array;
  private readonly control: SharedArrayBuffer;
  private attachId = 0;
  private acks = 0;
  private ready = false;
  private readonly minPerThread: number;
  /** Ticks stepped with helpers / alone (for stats). */
  parallelTicks = 0;
  soloTicks = 0;

  constructor(helpers: Worker[], minAgentsPerThread: number, onError: (msg: string) => void) {
    this.helpers = helpers;
    this.threads = helpers.length + 1;
    this.minPerThread = minAgentsPerThread;
    this.control = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * (Ctl.RANGES + 2 * helpers.length));
    this.ctl = new Int32Array(this.control);
    helpers.forEach((w) => {
      w.onmessage = (e: MessageEvent<HelperOut>) => {
        const m = e.data;
        if (m.type === 'attached' && m.attachId === this.attachId && ++this.acks === this.helpers.length) this.ready = true;
        else if (m.type === 'error') onError(m.message);
      };
    });
  }

  /** Point the helpers at a (new) world's shared agents; stepping is single-threaded until all confirm. */
  attach(world: World): void {
    this.ready = false;
    this.acks = 0;
    this.attachId++;
    Atomics.store(this.ctl, Ctl.ATTACH, this.attachId);
    const buffers = world.agents.sharedBuffers();
    const field = world.pheromone?.buffer;
    const pheromone = field && isSharedBuffer(field) ? field : null;
    this.helpers.forEach((w, index) => {
      const msg: HelperIn = { type: 'attach', config: world.config, buffers, pheromone, control: this.control, index, attachId: this.attachId };
      w.postMessage(msg);
    });
  }

  step(world: World): void {
    const n = world.agents.highWater;
    const k = this.helpers.length;
    // The soil of a digging world lives only in this thread's World (helpers would not see new tunnels).
    if (!this.ready || world.soil || n < this.minPerThread * (k + 1)) {
      world.step();
      this.soloTicks++;
      return;
    }
    const chunk = Math.ceil(n / (k + 1));
    for (let h = 0; h < k; h++) {
      const from = Math.min(n, (h + 1) * chunk);
      Atomics.store(this.ctl, Ctl.RANGES + 2 * h, from);
      Atomics.store(this.ctl, Ctl.RANGES + 2 * h + 1, Math.min(n, from + chunk));
    }
    Atomics.store(this.ctl, Ctl.TICK, world.tick);
    Atomics.store(this.ctl, Ctl.DONE, 0);
    Atomics.add(this.ctl, Ctl.GEN, 1);
    Atomics.notify(this.ctl, Ctl.GEN);
    world.stepRange(0, Math.min(n, chunk));
    let done: number;
    while ((done = Atomics.load(this.ctl, Ctl.DONE)) < k) Atomics.wait(this.ctl, Ctl.DONE, done, WAIT_SLICE_MS);
    world.completeStep();
    this.parallelTicks++;
  }

  get active(): boolean {
    return this.ready;
  }

  dispose(): void {
    for (const w of this.helpers) w.terminate();
  }
}

/** Threads to use for stepping, from config.sim.threads (0 = auto). */
export function threadCount(cfg: Config, hardwareThreads: number): number {
  const want = cfg.sim.threads > 0 ? cfg.sim.threads : hardwareThreads - 2;
  return Math.max(1, Math.min(cfg.sim.maxThreads, want));
}
