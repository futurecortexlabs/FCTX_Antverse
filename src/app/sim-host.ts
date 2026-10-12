/**
 * Main-thread side of the sim worker: starts it, receives snapshots (shared
 * memory or copies), and keeps the two most recent snapshots for
 * interpolation at a smoothly advancing render time.
 */

import type { Overlay } from '../config/load.ts';
import { InterpolationState } from '../render/interpolation.ts';
import type { Config } from '../config/params.ts';
import { MS_PER_S } from '../core/units.ts';
import {
  SNAP_FLOATS, SnapH, SnapshotView, TripleBufferReader, initTripleBufferControl, snapshotByteLength,
  type DeterminismReport, type FieldInfo, type FromWorker, type NestInfo, type SimStats, type SoilChunk, type ToWorker, type Transport,
} from '../worker/protocol.ts';

const SLOT_COUNT = 3;

export interface SimHostEvents {
  onStats?: (s: SimStats) => void;
  onError?: (msg: string) => void;
}

export class SimHost {
  readonly worker: Worker;
  readonly transport: Transport;
  readonly interp: InterpolationState;
  stats: SimStats | null = null;
  /** Pheromone grid of the running world (display only; live view with shared memory, else periodic copies). */
  field: FieldInfo | null = null;
  fieldData: Float32Array | null = null;
  /** Nest of a digging world: mound heights (live or copied) and dug soil chunks not yet taken by the renderer. */
  nest: NestInfo | null = null;
  moundData: Float32Array | null = null;
  /** Bumped when the mound copy changes (shared memory changes without notice: the renderer polls it). */
  moundVersion = 0;
  soilChunks: SoilChunk[] = [];
  /** Colony brood ([x, y, z, stage, growth] per item) and a counter bumped on each update. */
  brood: Float32Array | null = null;
  broodVersion = 0;
  timeScale: number;
  paused = false;
  private reader: TripleBufferReader | null = null;
  private sharedViews: SnapshotView[] = [];
  private pendingCopy: ArrayBuffer | null = null;
  private latestWall = 0;
  private readonly lagTicks: number;
  private readonly smoothing: number;
  private nextId = 1;
  private waiters = new Map<number, (v: unknown) => void>();

  private readonly config: Config;
  private readonly events: SimHostEvents;

  constructor(config: Config, overlays: Overlay[], events: SimHostEvents = {}) {
    this.config = config;
    this.events = events;
    const cap = config.sim.capacity;
    this.interp = new InterpolationState(cap);
    this.timeScale = config.time.initialSpeed;
    this.lagTicks = config.render.interpolationLagTicks;
    this.smoothing = config.render.interpolationSmoothing;
    this.transport = globalThis.crossOriginIsolated ? 'shared' : 'copy';
    this.worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
    this.worker.onerror = (e) => this.events.onError?.(e.message);

    const init: ToWorker = { type: 'init', overlays, transport: this.transport };
    if (this.transport === 'shared') {
      const control = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
      initTripleBufferControl(new Int32Array(control));
      const slots = Array.from({ length: SLOT_COUNT }, () => new SharedArrayBuffer(snapshotByteLength(cap)));
      this.reader = new TripleBufferReader(new Int32Array(control));
      this.sharedViews = slots.map((b) => new SnapshotView(b, cap));
      init.control = control;
      init.slots = slots;
    }
    this.worker.postMessage(init);
  }

  private send(msg: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  private onMessage(msg: FromWorker): void {
    switch (msg.type) {
      case 'snapshot':
        if (this.pendingCopy) this.send({ type: 'returnBuffer', buffer: this.pendingCopy }, [this.pendingCopy]);
        this.pendingCopy = msg.buffer;
        break;
      case 'stats':
        this.stats = msg.stats;
        this.events.onStats?.(msg.stats);
        break;
      case 'hash':
      case 'determinismCheck':
        this.waiters.get(msg.id)?.(msg);
        this.waiters.delete(msg.id);
        break;
      case 'error':
        this.events.onError?.(msg.message);
        break;
      case 'field':
        this.field = msg.info;
        this.fieldData = msg.info ? (msg.info.shared ? new Float32Array(msg.info.shared) : new Float32Array(msg.info.nx * msg.info.nz)) : null;
        break;
      case 'fieldData':
        if (this.fieldData && this.fieldData.length === msg.data.length) this.fieldData.set(msg.data);
        break;
      case 'nest':
        this.nest = msg.info;
        this.soilChunks = [];
        this.moundData = msg.info ? (msg.info.mound.shared ? new Float32Array(msg.info.mound.shared) : new Float32Array(msg.info.mound.nx * msg.info.mound.nz)) : null;
        this.moundVersion++;
        break;
      case 'soilChunks':
        this.soilChunks.push(...msg.chunks);
        break;
      case 'brood':
        this.brood = msg.data;
        this.broodVersion++;
        break;
      case 'moundData':
        if (this.moundData && this.moundData.length === msg.data.length) { this.moundData.set(msg.data); this.moundVersion++; }
        break;
      case 'ready':
        break;
    }
  }

  /** Pull the newest snapshot (if any) and advance the render time. Call once per frame. */
  update(wallNow: number): void {
    let view: SnapshotView | null = null;
    if (this.reader) {
      if (this.reader.acquire()) view = this.sharedViews[this.reader.front]!;
    } else if (this.pendingCopy) {
      view = new SnapshotView(this.pendingCopy, this.config.sim.capacity);
    }
    const s = this.interp;
    if (view) {
      const h = view.header;
      const n = h[SnapH.COUNT]!;
      // Rotate buffers: curr -> prev, new -> curr.
      [s.prev, s.curr] = [s.curr, s.prev];
      [s.prevMeta, s.currMeta] = [s.currMeta, s.prevMeta];
      s.curr.set(view.floats.subarray(0, n * SNAP_FLOATS));
      s.currMeta.set(view.meta.subarray(0, n));
      if (n > s.count) s.prevMeta.fill(0, s.count, n); // newly used slots: no history
      s.count = n;
      s.prevSimTime = s.currSimTime;
      s.currSimTime = h[SnapH.SIM_TIME]!;
      s.alive = h[SnapH.ALIVE]!;
      s.tick = h[SnapH.TICK]!;
      const step = s.currSimTime - s.prevSimTime;
      if (step > 0) s.interval = s.interval === 0 ? step : s.interval + this.smoothing * (step - s.interval);
      if (step < 0) { s.prevSimTime = s.currSimTime; s.renderTime = s.currSimTime; s.interval = 0; } // reset
      this.latestWall = h[SnapH.WALL_TIME]!;
      this.paused = h[SnapH.PAUSED]! !== 0;
      this.timeScale = h[SnapH.TIME_SCALE]!;
      if (this.pendingCopy) {
        this.send({ type: 'returnBuffer', buffer: this.pendingCopy }, [this.pendingCopy]);
        this.pendingCopy = null;
      }
    }
    // Render slightly behind the newest snapshot so there is always a pair to interpolate.
    const dt = this.config.sim.dt;
    const lag = Math.max(this.lagTicks * dt, s.interval);
    const elapsed = this.paused ? 0 : ((wallNow - this.latestWall) / MS_PER_S) * this.timeScale;
    const target = Math.min(s.currSimTime, s.currSimTime + elapsed - lag);
    s.renderTime = Math.max(s.renderTime, target);
    if (this.paused) s.renderTime = s.currSimTime;
  }

  setSpeed(scale: number): void {
    this.timeScale = scale;
    this.send({ type: 'setSpeed', scale });
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.send({ type: 'pause', paused });
  }

  step(): void {
    this.send({ type: 'step' });
  }

  reset(overlays: Overlay[]): void {
    this.send({ type: 'reset', overlays });
  }

  private request<T>(make: (id: number) => ToWorker): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve) => {
      this.waiters.set(id, resolve as (v: unknown) => void);
      this.send(make(id));
    });
  }

  hash(): Promise<{ tick: number; hash: string }> {
    return this.request((id) => ({ type: 'hash', id }));
  }

  determinismCheck(ticks: number): Promise<DeterminismReport> {
    return this.request<{ report: DeterminismReport }>((id) => ({ type: 'determinismCheck', id, ticks })).then((m) => m.report);
  }
}
