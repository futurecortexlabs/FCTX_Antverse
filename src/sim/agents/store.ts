/**
 * Agent pool (Structure of Arrays). docs/ARCHITECTURE.md §4.1
 *
 * Slots are reused after death; a per-slot generation counter makes stale
 * references detectable: ref = (gen << SLOT_BITS) | slot.
 *
 * Only fields needed by the current phase are allocated. Later phases append
 * fields to AGENT_SCHEMA (appending keeps earlier state hashes meaningful).
 */

import { allocSoA, attachSoA, field, soaBuffers, soaViews, type SoA } from '../../core/soa.ts';

export const SLOT_BITS = 20;
export const MAX_CAPACITY = 1 << SLOT_BITS;
const GEN_MASK = (1 << (32 - SLOT_BITS)) - 1;

export const AgentFlag = {
  ALIVE: 1 << 0,
  /** Has found food before and remembers where (until Phase 4: the feeder of the apparatus). */
  KNOWS_FOOD: 1 << 1,
} as const;

export const Caste = {
  WORKER: 0,
  QUEEN: 1,
  MALE: 2,
  GYNE: 3,
} as const;

export const AGENT_SCHEMA = {
  // --- shared with the renderer (copied into snapshots) ---
  posX: field('f32'),
  posY: field('f32'),
  posZ: field('f32'),
  /** Orientation quaternion (x, y, z, w). */
  rot: field('f32', 4),
  /** Tripod-gait phase in [0, 1); advanced by distance / stride length. */
  gaitPhase: field('f32'),
  caste: field('u8'),
  flags: field('u8'),
  carryKind: field('u8'),
  // --- simulation only ---
  gen: field('u16'),
  speed: field('f32'),
  /** Yaw on the ground plane (rad). */
  heading: field('f32'),
  /** Body pitch (nose up +) and roll (right side down +), following the terrain (rad). */
  pitch: field('f32'),
  roll: field('f32'),
  /** Angular velocity of the heading (rad/s). */
  turnRate: field('f32'),
  /** Foraging state (AgentState). */
  state: field('u8'),
  /** Distance walked this tick (mm). */
  lastStep: field('f32'),
  /** Pheromone to lay at the current position at the end of this tick (u). */
  deposit: field('f32'),
  /** Turning rate requested by guidance rules (trail, homing) this tick (rad/s); explore applies it unless blocked. */
  steer: field('f32'),
};

export const AgentState = {
  /** Searching / walking out from the nest. */
  SEARCH: 0,
  /** Carrying food back to the nest. */
  RETURN: 1,
  /** Inside the nest, not foraging (stands still). */
  REST: 2,
} as const;

export const CarryKind = { NONE: 0, FOOD: 1 } as const;

export type AgentSoA = SoA<typeof AGENT_SCHEMA>;

export class AgentStore {
  readonly capacity: number;
  readonly a: AgentSoA;
  /** One past the highest slot ever used; iterate [0, highWater). */
  highWater = 0;
  alive = 0;
  private free: number[] = [];

  /**
   * shared: allocate fields in SharedArrayBuffers (for multi-threaded stepping).
   * buffers: attach to another thread's shared fields instead of allocating.
   * Slot bookkeeping (highWater, alive, free list) belongs to the owning thread.
   */
  constructor(capacity: number, opts: { shared?: boolean; buffers?: Record<string, SharedArrayBuffer> } = {}) {
    if (capacity > MAX_CAPACITY) throw new Error(`AgentStore: capacity ${capacity} > ${MAX_CAPACITY}`);
    this.capacity = capacity;
    this.a = opts.buffers ? attachSoA(AGENT_SCHEMA, opts.buffers) : allocSoA(AGENT_SCHEMA, capacity, opts.shared === true);
  }

  sharedBuffers(): Record<string, SharedArrayBuffer> {
    return soaBuffers(this.a);
  }

  /** Allocate a slot. Reuses the most recently freed slot (deterministic LIFO). */
  spawn(caste: number): number {
    let slot: number;
    if (this.free.length > 0) slot = this.free.pop()!;
    else {
      if (this.highWater >= this.capacity) throw new Error('AgentStore: capacity exhausted');
      slot = this.highWater++;
    }
    const a = this.a;
    a.flags[slot] = AgentFlag.ALIVE;
    a.caste[slot] = caste;
    a.carryKind[slot] = 0;
    a.posX[slot] = 0;
    a.posY[slot] = 0;
    a.posZ[slot] = 0;
    a.rot.fill(0, slot * 4, slot * 4 + 4);
    a.rot[slot * 4 + 3] = 1;
    a.gaitPhase[slot] = 0;
    a.speed[slot] = 0;
    a.heading[slot] = 0;
    a.pitch[slot] = 0;
    a.roll[slot] = 0;
    a.turnRate[slot] = 0;
    a.state[slot] = 0;
    a.lastStep[slot] = 0;
    a.deposit[slot] = 0;
    a.steer[slot] = 0;
    this.alive++;
    return slot;
  }

  kill(slot: number): void {
    const a = this.a;
    if ((a.flags[slot]! & AgentFlag.ALIVE) === 0) return;
    a.flags[slot] = 0;
    a.gen[slot] = (a.gen[slot]! + 1) & GEN_MASK;
    this.free.push(slot);
    this.alive--;
  }

  isAlive(slot: number): boolean {
    return (this.a.flags[slot]! & AgentFlag.ALIVE) !== 0;
  }

  ref(slot: number): number {
    return ((this.a.gen[slot]! << SLOT_BITS) | slot) >>> 0;
  }

  /** Resolve a ref to its slot, or -1 if the agent has since died. */
  resolve(ref: number): number {
    const slot = ref & (MAX_CAPACITY - 1);
    const gen = ref >>> SLOT_BITS;
    return slot < this.highWater && this.isAlive(slot) && this.a.gen[slot] === gen ? slot : -1;
  }

  /** Slots awaiting reuse, in pop order from the end. Part of the hashed state. */
  freeSlots(): readonly number[] {
    return this.free;
  }

  /** Field views over the used range, in schema order (for state hashing). */
  views(): ArrayBufferView[] {
    return soaViews(AGENT_SCHEMA, this.a, this.highWater);
  }
}
