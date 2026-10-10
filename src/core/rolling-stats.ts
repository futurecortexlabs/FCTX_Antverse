/** Rolling window of per-frame measurements with percentile queries. */

export class RollingStats {
  private readonly buf: Float64Array;
  private n = 0;
  private i = 0;
  private sorted: Float64Array;
  readonly size: number;

  constructor(size: number) {
    this.size = size;
    this.buf = new Float64Array(size);
    this.sorted = new Float64Array(size);
  }

  push(v: number): void {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.size;
    if (this.n < this.size) this.n++;
  }

  get count(): number {
    return this.n;
  }

  reset(): void {
    this.n = 0;
    this.i = 0;
  }

  mean(): number {
    if (this.n === 0) return 0;
    let s = 0;
    for (let k = 0; k < this.n; k++) s += this.buf[k]!;
    return s / this.n;
  }

  /** q in [0, 1], nearest-rank. */
  percentile(q: number): number {
    if (this.n === 0) return 0;
    const view = this.sorted.subarray(0, this.n);
    view.set(this.buf.subarray(0, this.n));
    view.sort();
    const rank = Math.min(this.n - 1, Math.max(0, Math.ceil(q * this.n) - 1));
    return view[rank]!;
  }
}
