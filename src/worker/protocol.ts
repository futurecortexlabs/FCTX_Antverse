/**
 * Main thread <-> sim worker protocol and snapshot memory layout.
 *
 * Render-facing data travels as snapshots. With cross-origin isolation the
 * snapshots live in three SharedArrayBuffer slots exchanged lock-free
 * (triple buffering: the writer never blocks, the reader always gets the
 * newest complete snapshot). Without isolation, snapshots are copied and
 * transferred with postMessage — same layout, same reader code.
 *
 * This module must not import simulation internals: the renderer depends on it.
 */

import type { Overlay } from '../config/load.ts';

// ---------------------------------------------------------------------------
// Snapshot layout

/** Per-agent float record: pos(3) rot(4) gaitPhase(1) speed(1). */
export const SNAP_FLOATS = 9;
/** Floats per brood item in a 'brood' message: x, y, z, stage, growth. */
export const BROOD_FLOATS = 5;
export const SnapF = { PX: 0, PY: 1, PZ: 2, QX: 3, QY: 4, QZ: 5, QW: 6, GAIT: 7, SPEED: 8 } as const;

/** Per-agent u32: caste | flags<<8 | carryKind<<16 | (gen & 0xff)<<24. */
export const META_FLAG_SHIFT = 8;
export const META_CARRY_SHIFT = 16;
export const META_GEN_SHIFT = 24;
export const META_BYTE = 0xff;
/** Bit in the flags byte marking a live agent (mirrors AgentFlag.ALIVE; checked by a test). */
export const SNAP_FLAG_ALIVE = 1;
/** Bit in the flags byte marking an ant in the soil (mirrors AgentFlag.UNDERGROUND). */
export const SNAP_FLAG_UNDERGROUND = 8;
/** Caste byte of the queen (mirrors Caste.QUEEN). */
export const SNAP_CASTE_QUEEN = 1;

export const SNAP_HEADER_F64 = 16;
export const SnapH = {
  SEQ: 0,
  TICK: 1,
  SIM_TIME: 2,
  /** performance.timeOrigin + performance.now() at publish (ms since epoch). */
  WALL_TIME: 3,
  /** Records in this snapshot (= agent slot high-water mark). */
  COUNT: 4,
  TIME_SCALE: 5,
  PAUSED: 6,
  ALIVE: 7,
  DT: 8,
} as const;

const HEADER_BYTES = SNAP_HEADER_F64 * 8;

export function snapshotByteLength(capacity: number): number {
  return HEADER_BYTES + capacity * SNAP_FLOATS * 4 + capacity * 4;
}

export class SnapshotView {
  readonly header: Float64Array;
  readonly floats: Float32Array;
  readonly meta: Uint32Array;
  readonly buffer: ArrayBufferLike;
  readonly capacity: number;
  constructor(buffer: ArrayBufferLike, capacity: number) {
    this.buffer = buffer;
    this.capacity = capacity;
    this.header = new Float64Array(buffer, 0, SNAP_HEADER_F64);
    this.floats = new Float32Array(buffer, HEADER_BYTES, capacity * SNAP_FLOATS);
    this.meta = new Uint32Array(buffer, HEADER_BYTES + capacity * SNAP_FLOATS * 4, capacity);
  }
}

// ---------------------------------------------------------------------------
// Lock-free triple buffer over a 1-element Int32Array in shared memory.
// middle = slotIndex | NEW. Writer owns `back`, reader owns `front`.

const NEW = 4;
const SLOT_MASK = 3;

export function initTripleBufferControl(ctrl: Int32Array): void {
  Atomics.store(ctrl, 0, 1); // writer back = 0, middle = 1, reader front = 2
}

export class TripleBufferWriter {
  back = 0;
  private readonly ctrl: Int32Array;
  constructor(ctrl: Int32Array) {
    this.ctrl = ctrl;
  }
  /** Publish the slot just written; returns the next slot to write. */
  publish(): number {
    this.back = Atomics.exchange(this.ctrl, 0, this.back | NEW) & SLOT_MASK;
    return this.back;
  }
}

export class TripleBufferReader {
  front = 2;
  private readonly ctrl: Int32Array;
  constructor(ctrl: Int32Array) {
    this.ctrl = ctrl;
  }
  /** If a newer snapshot exists, take it and return true. */
  acquire(): boolean {
    if ((Atomics.load(this.ctrl, 0) & NEW) === 0) return false;
    this.front = Atomics.exchange(this.ctrl, 0, this.front) & SLOT_MASK;
    return true;
  }
}

// ---------------------------------------------------------------------------
// Messages

export type Transport = 'shared' | 'copy';

export type ToWorker =
  | {
      type: 'init';
      overlays: Overlay[];
      transport: Transport;
      control?: SharedArrayBuffer;
      slots?: SharedArrayBuffer[];
    }
  | { type: 'reset'; overlays: Overlay[] }
  | { type: 'setSpeed'; scale: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'step' }
  | { type: 'hash'; id: number }
  | { type: 'determinismCheck'; id: number; ticks: number }
  | { type: 'returnBuffer'; buffer: ArrayBuffer };

export interface SimStats {
  tick: number;
  simTime: number;
  alive: number;
  /** Mean wall time per sim step over the last stats interval (ms). */
  msPerTick: number;
  /** Steps actually executed per wall second. */
  ticksPerSec: number;
  /** Sim seconds per wall second actually achieved. */
  achievedSpeed: number;
  targetSpeed: number;
  paused: boolean;
  droppedSteps: number;
  /** Simulation threads that stepped the last tick (1 = single-threaded). */
  threads: number;
  /**
   * In a foraging or digging scenario: agents per state, indexed like AgentState,
   * and how many carry something. Null otherwise.
   */
  foraging: { states: number[]; carrying: number } | null;
  /** In a digging world: soil dug by the workers (mm³), pellets on the mound, workers in the soil. */
  digging: { dug: number; pellets: number; underground: number } | null;
  /** In a colony: workers per task (idle, forage, nurse), brood per stage (egg, larva, pupa), food taken in (mg), mean crop fill (0–1), queen alive. */
  colony: { tasks: number[]; brood: number[]; intake: number; cropFill: number; eclosed: number; died: number; queen: boolean } | null;
}

export interface DeterminismReport {
  ticks: number;
  hashA: string;
  hashB: string;
  hashOtherSeed: string;
  identical: boolean;
  seedSensitive: boolean;
  /** The live world (driven by wall clock, speed changes, pauses) vs a headless run to the same tick. */
  liveTick: number;
  liveHash: string;
  liveHeadlessHash: string;
  liveMatchesHeadless: boolean;
  ms: number;
}

/**
 * The running world's pheromone grid (Phase 3), for display only. Node (i, j)
 * is at (x0 + i·cell, z0 + j·cell); values are row-major in j. With shared
 * memory the main thread reads the live grid; otherwise copies arrive as
 * 'fieldData' messages.
 */
export interface FieldInfo {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  shared: SharedArrayBuffer | null;
}

/**
 * The nest of a digging world (Phase 5): the mound heightfield (live with
 * shared memory, else copies in 'moundData') — the soil itself the renderer
 * rebuilds from the same config and terrain, then updates from 'soilChunks'.
 */
export interface NestInfo {
  mound: FieldInfo;
}

/** Dug flags of soil chunks changed since the last message (Soil.takeDirty). */
export interface SoilChunk {
  key: number;
  data: Uint8Array;
}

export type FromWorker =
  | { type: 'ready'; capacity: number; seed: number; threads: number }
  | { type: 'nest'; info: NestInfo | null }
  | { type: 'soilChunks'; chunks: SoilChunk[] }
  | { type: 'moundData'; data: Float32Array }
  /** Colony brood for display: [x, y, z, stage, growth (0–1)] per item. */
  | { type: 'brood'; data: Float32Array }
  | { type: 'field'; info: FieldInfo | null }
  | { type: 'fieldData'; data: Float32Array }
  | { type: 'snapshot'; buffer: ArrayBuffer }
  | { type: 'stats'; stats: SimStats }
  | { type: 'hash'; id: number; tick: number; hash: string }
  | { type: 'determinismCheck'; id: number; report: DeterminismReport }
  | { type: 'error'; message: string };
