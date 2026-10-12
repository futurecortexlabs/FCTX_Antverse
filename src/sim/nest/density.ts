/**
 * How many workers are underground in each densityCell³ block of the soil
 * region, and how much of the block is dug-out space (Phase 5). The digging
 * rule reads them as how crowded the nest is locally (ASM-NST-002). It is rebuilt once per tick by the coordinating
 * thread (World.completeStep) from the positions at the end of the tick, and
 * only read during the next tick — by every thread, from shared memory if
 * the step is split — so the result does not depend on the order in which
 * agents move.
 */

import type { Soil } from '../../soil/soil.ts';

/**
 * Who is where (colony, Phase 6): the underground agents of each cell, in
 * slot order, with their positions at the end of the last tick — so that a
 * worker can find the nestmates touching it without reading positions other
 * threads are writing. Entries of cell k are [start[k], start[k] + counts[k]);
 * start[k] = −1 for an empty cell. Shared with helper threads.
 */
export interface ContactIndex {
  start: Int32Array;
  slots: Int32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** Brood demand per cell (brood units, colony.ts), rebuilt with the index. */
  demand: Float32Array;
}

/** Buffers of a ContactIndex, in field order (for helper threads). */
export type ContactBuffers = [SharedArrayBuffer, SharedArrayBuffer, SharedArrayBuffer, SharedArrayBuffer, SharedArrayBuffer, SharedArrayBuffer];

const buf = (bytes: number, shared: boolean): ArrayBuffer | SharedArrayBuffer => (shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes));

export class DensityGrid {
  readonly cell: number;
  readonly cx: number;
  readonly cd: number;
  readonly cz: number;
  readonly counts: Uint16Array;
  /** Open (dug) voxels per cell, kept up to date as the soil is dug. */
  readonly open: Uint16Array;
  /** Cells set in the last rebuild (cleared at the next one). */
  private touched: number[] = [];
  /** Contact index (colony scenario only). */
  readonly contacts: ContactIndex | null = null;
  private cursor: Int32Array | null = null;
  private demandTouched: number[] = [];

  constructor(soil: Soil, cell: number, shared = false, buffer?: SharedArrayBuffer) {
    this.cell = cell;
    this.cx = Math.ceil(soil.nx / cell);
    this.cd = Math.ceil(soil.nd / cell);
    this.cz = Math.ceil(soil.nz / cell);
    const n = this.cx * this.cd * this.cz;
    this.counts = buffer ? new Uint16Array(buffer) : shared ? new Uint16Array(new SharedArrayBuffer(n * 2)) : new Uint16Array(n);
    this.open = new Uint16Array(n);
  }

  /** Add the contact index (capacity = agent slots); attach to a coordinator's buffers in a helper. */
  withContacts(capacity: number, shared: boolean, buffers?: ContactBuffers): this {
    const n = this.counts.length;
    const b = buffers ?? [buf(n * 4, shared), buf(capacity * 4, shared), buf(capacity * 4, shared), buf(capacity * 4, shared), buf(capacity * 4, shared), buf(n * 4, shared)];
    const c: ContactIndex = {
      start: new Int32Array(b[0]), slots: new Int32Array(b[1]), x: new Float32Array(b[2]), y: new Float32Array(b[3]), z: new Float32Array(b[4]),
      demand: new Float32Array(b[5]),
    };
    if (!buffers) c.start.fill(-1);
    (this as { contacts: ContactIndex | null }).contacts = c;
    this.cursor = new Int32Array(n);
    return this;
  }

  contactBuffers(): ContactBuffers | null {
    const c = this.contacts;
    if (!c) return null;
    const out = [c.start.buffer, c.slots.buffer, c.x.buffer, c.y.buffer, c.z.buffer, c.demand.buffer];
    if (!out.every((b) => b instanceof SharedArrayBuffer)) return null;
    return out as ContactBuffers;
  }

  /**
   * After the counts are rebuilt: lay out the cells' entries (in the order the
   * cells were first counted) — then place(k, slot, x, y, z) for every agent
   * counted, in the same order as add().
   */
  layout(): void {
    const c = this.contacts!, cur = this.cursor!;
    let offset = 0;
    for (const k of this.touched) { c.start[k] = offset; cur[k] = offset; offset += this.counts[k]!; }
  }

  place(ix: number, d: number, iz: number, slot: number, x: number, y: number, z: number): void {
    const c = this.contacts!, k = this.key(ix, d, iz);
    const e = this.cursor![k]!;
    this.cursor![k] = e + 1;
    c.slots[e] = slot; c.x[e] = x; c.y[e] = y; c.z[e] = z;
  }

  /** Brood demand: clear, then addDemand for every hungry larva. */
  clearDemand(): void {
    const dm = this.contacts!.demand;
    for (const k of this.demandTouched) dm[k] = 0;
    this.demandTouched = [];
  }

  addDemand(ix: number, d: number, iz: number, units: number): void {
    const dm = this.contacts!.demand, k = this.key(ix, d, iz);
    if (dm[k] === 0) this.demandTouched.push(k);
    dm[k] = dm[k]! + units;
  }

  /** Brood demand summed over the cell of (ix, d, iz) and its 26 neighbours. */
  demandAround(ix: number, d: number, iz: number): number {
    const c = this.cell, dm = this.contacts!.demand;
    const cx = Math.floor(ix / c), cd = Math.floor(d / c), cz = Math.floor(iz / c);
    let s = 0;
    for (let z = Math.max(0, cz - 1); z <= Math.min(this.cz - 1, cz + 1); z++) {
      for (let y = Math.max(0, cd - 1); y <= Math.min(this.cd - 1, cd + 1); y++) {
        for (let x = Math.max(0, cx - 1); x <= Math.min(this.cx - 1, cx + 1); x++) s += dm[(z * this.cd + y) * this.cx + x]!;
      }
    }
    return s;
  }

  /** Brood demand of the single cell containing (ix, d, iz). */
  demandAt(ix: number, d: number, iz: number): number {
    return this.contacts!.demand[this.key(ix, d, iz)]!;
  }

  get buffer(): ArrayBufferLike {
    return this.counts.buffer;
  }

  key(ix: number, d: number, iz: number): number {
    const c = this.cell;
    return (Math.floor(iz / c) * this.cd + Math.floor(d / c)) * this.cx + Math.floor(ix / c);
  }

  countAt(ix: number, d: number, iz: number): number {
    return this.counts[this.key(ix, d, iz)]!;
  }

  openAt(ix: number, d: number, iz: number): number {
    return this.open[this.key(ix, d, iz)]!;
  }

  /**
   * Workers and open voxels summed over the cell of (ix, d, iz) and its 26
   * neighbour cells, written into out[0], out[1].
   */
  around(ix: number, d: number, iz: number, out: Float64Array): void {
    const c = this.cell;
    const cx = Math.floor(ix / c), cd = Math.floor(d / c), cz = Math.floor(iz / c);
    let n = 0, o = 0;
    for (let z = Math.max(0, cz - 1); z <= Math.min(this.cz - 1, cz + 1); z++) {
      for (let y = Math.max(0, cd - 1); y <= Math.min(this.cd - 1, cd + 1); y++) {
        for (let x = Math.max(0, cx - 1); x <= Math.min(this.cx - 1, cx + 1); x++) {
          const k = (z * this.cd + y) * this.cx + x;
          n += this.counts[k]!; o += this.open[k]!;
        }
      }
    }
    out[0] = n; out[1] = o;
  }

  /** A voxel of this cell has been dug. */
  dug(ix: number, d: number, iz: number): void {
    const k = this.key(ix, d, iz);
    this.open[k] = this.open[k]! + 1;
  }

  /** Start a rebuild: clear the cells set last time. */
  clear(): void {
    const c = this.contacts;
    for (const k of this.touched) { this.counts[k] = 0; if (c) c.start[k] = -1; }
    this.touched = [];
  }

  add(ix: number, d: number, iz: number): void {
    const k = this.key(ix, d, iz);
    if (this.counts[k] === 0) this.touched.push(k);
    this.counts[k] = this.counts[k]! + 1;
  }
}
