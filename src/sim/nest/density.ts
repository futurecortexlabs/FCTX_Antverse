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

  constructor(soil: Soil, cell: number, shared = false, buffer?: SharedArrayBuffer) {
    this.cell = cell;
    this.cx = Math.ceil(soil.nx / cell);
    this.cd = Math.ceil(soil.nd / cell);
    this.cz = Math.ceil(soil.nz / cell);
    const n = this.cx * this.cd * this.cz;
    this.counts = buffer ? new Uint16Array(buffer) : shared ? new Uint16Array(new SharedArrayBuffer(n * 2)) : new Uint16Array(n);
    this.open = new Uint16Array(n);
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
    for (const k of this.touched) this.counts[k] = 0;
    this.touched = [];
  }

  add(ix: number, d: number, iz: number): void {
    const k = this.key(ix, d, iz);
    if (this.counts[k] === 0) this.touched.push(k);
    this.counts[k] = this.counts[k]! + 1;
  }
}
