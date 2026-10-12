/**
 * Who is where on the surface (Phase 7): the agents walking on the ground,
 * sorted into square cells over the arena with their positions and headings
 * at the end of the last tick. Rebuilt in World.completeStep by the
 * coordinating thread and read during the next tick by every thread (shared
 * memory), so collision avoidance never reads positions another thread is
 * writing. Entries of cell k are [start[k], start[k] + count[k]).
 */

const buf = (bytes: number, shared: boolean): ArrayBuffer | SharedArrayBuffer => (shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes));

/** Buffers of a SurfaceGrid in field order (count, start, slots, x, z, heading). */
export type SurfaceBuffers = SharedArrayBuffer[];

export class SurfaceGrid {
  readonly cell: number;
  readonly n: number;
  readonly x0: number;
  readonly count: Uint16Array;
  readonly start: Int32Array;
  readonly slots: Int32Array;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly heading: Float32Array;
  private touched: number[] = [];
  private readonly cursor: Int32Array;

  /** A square of side `size` centred on the origin, cells of side `cell`; room for `capacity` agents. */
  constructor(size: number, cell: number, capacity: number, shared: boolean, buffers?: SurfaceBuffers) {
    this.cell = cell;
    this.n = Math.max(1, Math.ceil(size / cell));
    this.x0 = -(this.n * cell) / 2;
    const n2 = this.n * this.n;
    const b = buffers ?? [buf(n2 * 2, shared), buf(n2 * 4, shared), buf(capacity * 4, shared), buf(capacity * 4, shared), buf(capacity * 4, shared), buf(capacity * 4, shared)];
    this.count = new Uint16Array(b[0]!);
    this.start = new Int32Array(b[1]!);
    this.slots = new Int32Array(b[2]!);
    this.x = new Float32Array(b[3]!);
    this.z = new Float32Array(b[4]!);
    this.heading = new Float32Array(b[5]!);
    this.cursor = new Int32Array(n2);
  }

  buffers(): SurfaceBuffers | null {
    const out = [this.count.buffer, this.start.buffer, this.slots.buffer, this.x.buffer, this.z.buffer, this.heading.buffer];
    return out.every((b) => b instanceof SharedArrayBuffer) ? (out as SharedArrayBuffer[]) : null;
  }

  /** Cell column / row of a position (clamped to the grid). */
  ci(v: number): number {
    return Math.min(this.n - 1, Math.max(0, Math.floor((v - this.x0) / this.cell)));
  }

  clear(): void {
    for (const k of this.touched) this.count[k] = 0;
    this.touched = [];
  }

  /** First pass: count an agent at (x, z). */
  add(x: number, z: number): void {
    const k = this.ci(z) * this.n + this.ci(x);
    if (this.count[k] === 0) this.touched.push(k);
    this.count[k] = this.count[k]! + 1;
  }

  /** Between the passes: lay out the cells' entries in the order they were first counted. */
  layout(): void {
    let offset = 0;
    for (const k of this.touched) { this.start[k] = offset; this.cursor[k] = offset; offset += this.count[k]!; }
  }

  /** Second pass, same agents in the same order as add(). */
  place(slot: number, x: number, z: number, heading: number): void {
    const k = this.ci(z) * this.n + this.ci(x);
    const e = this.cursor[k]!;
    this.cursor[k] = e + 1;
    this.slots[e] = slot; this.x[e] = x; this.z[e] = z; this.heading[e] = heading;
  }
}
