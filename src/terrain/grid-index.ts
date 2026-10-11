/**
 * Static uniform-grid index of items with circular footprints on the ground
 * plane (compressed-row layout). Built once; queried by point.
 */

export class GridIndex {
  readonly cell: number;
  readonly min: number;
  readonly dim: number;
  private readonly start: Int32Array;
  private readonly items: Int32Array;

  /** Items are given as centres (x, z) and footprint radii; the grid spans [min, min + dim*cell). */
  constructor(xs: ArrayLike<number>, zs: ArrayLike<number>, radii: ArrayLike<number>, min: number, size: number, cell: number) {
    this.cell = cell;
    this.min = min;
    this.dim = Math.max(1, Math.ceil(size / cell));
    const n = xs.length;
    const cells = this.dim * this.dim;
    const counts = new Int32Array(cells + 1);
    const visit = (i: number, fn: (c: number) => void): void => {
      const r = radii[i]!;
      const x0 = this.clampCell(xs[i]! - r), x1 = this.clampCell(xs[i]! + r);
      const z0 = this.clampCell(zs[i]! - r), z1 = this.clampCell(zs[i]! + r);
      for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) fn(cz * this.dim + cx);
    };
    for (let i = 0; i < n; i++) visit(i, (c) => { counts[c + 1]!++; });
    for (let c = 0; c < cells; c++) counts[c + 1]! += counts[c]!;
    this.start = counts;
    this.items = new Int32Array(counts[cells]!);
    const fill = counts.slice(0, cells);
    for (let i = 0; i < n; i++) visit(i, (c) => { this.items[fill[c]!++] = i; });
  }

  private clampCell(v: number): number {
    const c = Math.floor((v - this.min) / this.cell);
    return c < 0 ? 0 : c >= this.dim ? this.dim - 1 : c;
  }

  /**
   * Cell containing (x, z) as [begin, end) into `itemList`, or [0, 0] outside.
   * Allocation-free alternative to forEachAt for hot paths.
   */
  range(x: number, z: number, out: Int32Array): void {
    const cx = Math.floor((x - this.min) / this.cell);
    const cz = Math.floor((z - this.min) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.dim || cz >= this.dim) { out[0] = 0; out[1] = 0; return; }
    const c = cz * this.dim + cx;
    out[0] = this.start[c]!;
    out[1] = this.start[c + 1]!;
  }

  get itemList(): Int32Array {
    return this.items;
  }

  /** Calls fn(itemIndex) for every item whose footprint cell contains (x, z). Order is ascending index. */
  forEachAt(x: number, z: number, fn: (i: number) => void): void {
    const cx = Math.floor((x - this.min) / this.cell);
    const cz = Math.floor((z - this.min) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.dim || cz >= this.dim) return;
    const c = cz * this.dim + cx;
    for (let k = this.start[c]!; k < this.start[c + 1]!; k++) fn(this.items[k]!);
  }
}
