/**
 * Water drops sitting on leaves and stones (Phase 7). At ant scale a drop is
 * a solid-looking dome held together by surface tension: ants walk round it,
 * and one that a drop forms on is stuck until it struggles free.
 *
 * Drops form while it rains, on surfaces that do not soak water up (on bare
 * soil it infiltrates), merge when they touch, and shrink by evaporation with
 * d(r²)/dt constant (diffusion-limited evaporation, PHY-ENV-004), faster when
 * warmer and drier. They are changed only in World.completeStep; the
 * positions are in shared memory with a coarse grid, so every thread can ask
 * whether a point is under water.
 */

import { isSharedBuffer } from '../../core/soa.ts';
const buf = (bytes: number, shared: boolean): ArrayBuffer | SharedArrayBuffer => (shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes));

/** Shared buffers: [x, z, r, y, meta(count | grid count | grid start)]. */
export type DropBuffers = SharedArrayBuffer[];

export class Drops {
  readonly capacity: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
  /** Footprint radius (mm) and height of the surface it sits on (mm). */
  readonly r: Float32Array;
  readonly y: Float32Array;
  /** [0] = number of drops; then grid cell counts and starts; then the sorted drop indices. */
  private readonly meta: Int32Array;
  readonly cell: number;
  readonly n: number;
  readonly x0: number;

  constructor(capacity: number, size: number, cell: number, shared: boolean, buffers?: DropBuffers) {
    this.capacity = capacity;
    this.cell = cell;
    this.n = Math.max(1, Math.ceil(size / cell));
    this.x0 = -(this.n * cell) / 2;
    const n2 = this.n * this.n;
    const metaLen = 1 + 2 * n2 + capacity;
    const b = buffers ?? [buf(capacity * 4, shared), buf(capacity * 4, shared), buf(capacity * 4, shared), buf(capacity * 4, shared), buf(metaLen * 4, shared)];
    this.x = new Float32Array(b[0]!); this.z = new Float32Array(b[1]!); this.r = new Float32Array(b[2]!); this.y = new Float32Array(b[3]!);
    this.meta = new Int32Array(b[4]!);
  }

  buffers(): DropBuffers | null {
    const out = [this.x.buffer, this.z.buffer, this.r.buffer, this.y.buffer, this.meta.buffer];
    return out.every((b) => isSharedBuffer(b)) ? (out as SharedArrayBuffer[]) : null;
  }

  get count(): number {
    return this.meta[0]!;
  }

  private ci(v: number): number {
    return Math.min(this.n - 1, Math.max(0, Math.floor((v - this.x0) / this.cell)));
  }

  /** Add a drop (coordinator only; reindex() afterwards). Returns false when full. */
  add(x: number, z: number, r: number, y: number): boolean {
    const k = this.meta[0]!;
    if (k >= this.capacity) return false;
    this.x[k] = x; this.z[k] = z; this.r[k] = r; this.y[k] = y;
    this.meta[0] = k + 1;
    return true;
  }

  /** Remove drop k by moving the last one into its place (coordinator only). */
  remove(k: number): void {
    const last = this.meta[0]! - 1;
    this.x[k] = this.x[last]!; this.z[k] = this.z[last]!; this.r[k] = this.r[last]!; this.y[k] = this.y[last]!;
    this.meta[0] = last;
  }

  /** The largest drop radius, for the grid search reach. */
  private maxR = 0;

  /** Rebuild the grid (coordinator, after any change). */
  reindex(): void {
    const n2 = this.n * this.n, m = this.meta, cnt = 1, start = 1 + n2, idx = 1 + 2 * n2;
    m.fill(0, cnt, cnt + n2);
    let maxR = 0;
    for (let k = 0; k < m[0]!; k++) { m[cnt + this.ci(this.z[k]!) * this.n + this.ci(this.x[k]!)]!++; maxR = Math.max(maxR, this.r[k]!); }
    this.maxR = maxR;
    let off = 0;
    for (let c = 0; c < n2; c++) { m[start + c] = off; off += m[cnt + c]!; }
    const fill = new Int32Array(n2);
    for (let k = 0; k < m[0]!; k++) {
      const c = this.ci(this.z[k]!) * this.n + this.ci(this.x[k]!);
      m[idx + m[start + c]! + fill[c]!] = k;
      fill[c]!++;
    }
  }

  /** Index of a drop whose footprint covers (x, z), or −1. Readable from any thread. */
  at(x: number, z: number): number {
    if (this.meta[0] === 0) return -1;
    const n2 = this.n * this.n, m = this.meta, cnt = 1, start = 1 + n2, idx = 1 + 2 * n2;
    // Drops are smaller than a cell: the 3×3 block round the point covers every one that can reach it.
    const cx = this.ci(x), cz = this.ci(z);
    for (let j = Math.max(0, cz - 1); j <= Math.min(this.n - 1, cz + 1); j++) {
      for (let i = Math.max(0, cx - 1); i <= Math.min(this.n - 1, cx + 1); i++) {
        const c = j * this.n + i;
        for (let e = m[start + c]!; e < m[start + c]! + m[cnt + c]!; e++) {
          const k = m[idx + e]!;
          const dx = x - this.x[k]!, dz = z - this.z[k]!;
          if (dx * dx + dz * dz <= this.r[k]! * this.r[k]!) return k;
        }
      }
    }
    return -1;
  }

  views(): ArrayBufferView[] {
    const n = this.meta[0]!;
    return [this.x.subarray(0, n), this.z.subarray(0, n), this.r.subarray(0, n), this.y.subarray(0, n)];
  }

  /** Largest radius (for tests and the search reach). */
  get largest(): number {
    return this.maxR;
  }
}
