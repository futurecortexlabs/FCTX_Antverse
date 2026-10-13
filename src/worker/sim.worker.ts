/// <reference lib="webworker" />
/**
 * Sim worker entry: owns the authoritative World and runs it on its own
 * schedule, independent of the render frame rate.
 */

import { buildConfig } from '../config/load.ts';
import { checkDeterminism, runHeadless } from '../sim/headless.ts';
import {
  SnapshotView, TripleBufferWriter, snapshotByteLength,
  type FromWorker, type ToWorker,
} from './protocol.ts';
import { SimRunner, type SnapshotSink } from './sim-runner.ts';
import { ParallelStepper, threadCount } from './parallel.ts';
import { formatHash } from '../core/statehash.ts';

declare const self: DedicatedWorkerGlobalScope;

const wallNow = (): number => performance.timeOrigin + performance.now();
const post = (msg: FromWorker, transfer: Transferable[] = []): void => self.postMessage(msg, transfer);

let runner: SimRunner | null = null;
let stepper: ParallelStepper | null = null;
let scheduled = false;
let idleDelay = 0;

// Zero-delay scheduling for when steps are owed (setTimeout clamps to >= 4 ms).
const channel = new MessageChannel();
channel.port1.onmessage = () => loop();

function schedule(immediate: boolean): void {
  if (scheduled) return;
  scheduled = true;
  if (immediate) channel.port2.postMessage(0);
  else setTimeout(loop, idleDelay);
}

function loop(): void {
  scheduled = false;
  if (!runner) return;
  const owed = runner.iterate();
  const stats = runner.takeStats();
  if (stats) {
    post({ type: 'stats', stats });
    // Without shared memory the renderer gets a copy of the pheromone grid at the stats rate.
    const data = runner.fieldCopy();
    if (data) post({ type: 'fieldData', data }, [data.buffer]);
    // Nest: dug chunks always as messages, the mound as copies without shared memory.
    const chunks = runner.takeSoilChunks();
    if (chunks.length > 0) post({ type: 'soilChunks', chunks }, chunks.map((c) => c.data.buffer));
    const mound = runner.moundCopy();
    if (mound) post({ type: 'moundData', data: mound }, [mound.buffer]);
    const brood = runner.broodCopy();
    if (brood) post({ type: 'brood', data: brood }, [brood.buffer]);
    const drops = runner.dropsCopy();
    if (drops) post({ type: 'drops', data: drops }, [drops.buffer]);
  }
  schedule(owed);
}

function sharedSink(control: SharedArrayBuffer, slots: SharedArrayBuffer[], capacity: number): SnapshotSink {
  const writer = new TripleBufferWriter(new Int32Array(control));
  const views = slots.map((b) => new SnapshotView(b, capacity));
  return {
    target: () => views[writer.back]!,
    commit: () => { writer.publish(); },
  };
}

function copySink(capacity: number): SnapshotSink {
  const pool: ArrayBuffer[] = [];
  let current: SnapshotView | null = null;
  self.addEventListener('message', (e: MessageEvent<ToWorker>) => {
    if (e.data.type === 'returnBuffer') pool.push(e.data.buffer);
  });
  return {
    target: () => {
      const buf = pool.pop() ?? new ArrayBuffer(snapshotByteLength(capacity));
      current = new SnapshotView(buf, capacity);
      return current;
    },
    commit: () => {
      if (!current) return;
      const buf = current.buffer as ArrayBuffer;
      post({ type: 'snapshot', buffer: buf }, [buf]);
      current = null;
    },
  };
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init': {
        const { config } = buildConfig(msg.overlays);
        const cap = config.sim.capacity;
        const sink = msg.transport === 'shared' && msg.control && msg.slots
          ? sharedSink(msg.control, msg.slots, cap)
          : copySink(cap);
        idleDelay = config.sim.idleDelay;
        // Helper threads need shared memory and Atomics.waitAsync; otherwise step on this thread alone.
        const threads = threadCount(config, navigator.hardwareConcurrency || 1);
        const canShare = globalThis.crossOriginIsolated && typeof Atomics.waitAsync === 'function';
        stepper = canShare && threads > 1
          ? new ParallelStepper(
            Array.from({ length: threads - 1 }, () => new Worker(new URL('./sim-helper.worker.ts', import.meta.url), { type: 'module' })),
            config.sim.minAgentsPerThread,
            (message) => post({ type: 'error', message }),
          )
          : null;
        runner = new SimRunner(config, sink, wallNow, stepper);
        post({ type: 'ready', capacity: cap, seed: config.sim.seed, threads: stepper?.threads ?? 1 });
        post({ type: 'field', info: runner.fieldInfo() });
        post({ type: 'nest', info: runner.nestInfo() });
        schedule(true);
        break;
      }
      case 'reset': {
        if (!runner) break;
        runner.reset(buildConfig(msg.overlays).config);
        post({ type: 'field', info: runner.fieldInfo() });
        post({ type: 'nest', info: runner.nestInfo() });
        schedule(true);
        break;
      }
      case 'setSpeed':
        runner?.setSpeed(msg.scale);
        schedule(true);
        break;
      case 'pause':
        runner?.setPaused(msg.paused);
        schedule(true);
        break;
      case 'step':
        runner?.requestStep();
        schedule(true);
        break;
      case 'hash':
        if (runner) post({ type: 'hash', id: msg.id, tick: runner.world.tick, hash: formatHash(runner.world.stateHash()) });
        break;
      case 'determinismCheck': {
        if (!runner) break;
        const t0 = performance.now();
        const live = runner.world;
        const r = checkDeterminism(live.config, msg.ticks);
        const liveHash = formatHash(live.stateHash());
        const liveHeadlessHash = formatHash(runHeadless(live.config, live.tick).stateHash());
        post({
          type: 'determinismCheck',
          id: msg.id,
          report: {
            ...r,
            liveTick: live.tick,
            liveHash,
            liveHeadlessHash,
            liveMatchesHeadless: liveHash === liveHeadlessHash,
            ms: performance.now() - t0,
          },
        });
        break;
      }
      case 'inspect':
        post({ type: 'inspect', id: msg.id, info: runner ? runner.inspect(msg.slot) : null });
        break;
      case 'states': {
        const data = runner ? runner.states() : new Uint8Array(0);
        post({ type: 'states', id: msg.id, data }, [data.buffer]);
        break;
      }
      case 'returnBuffer':
        break; // handled by copySink
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
