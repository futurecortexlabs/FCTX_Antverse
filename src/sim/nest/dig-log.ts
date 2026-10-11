/**
 * Every voxel dug since the world began, in the order dug (Phase 6). The
 * coordinating thread appends in World.completeStep; helper threads, whose
 * Worlds carry their own copy of the soil, replay what they have not applied
 * yet before stepping their slice — so all threads walk the same tunnels.
 * Digging only happens in completeStep (between ticks), so a replay at the
 * start of a tick is always complete.
 *
 * Layout (Int32Array): [0] = number of entries, then the voxel indices.
 */

export class DigLog {
  readonly data: Int32Array;
  private applied = 0;

  constructor(capacity: number, buffer?: SharedArrayBuffer) {
    this.data = new Int32Array(buffer ?? new SharedArrayBuffer((capacity + 1) * Int32Array.BYTES_PER_ELEMENT));
  }

  get buffer(): SharedArrayBuffer {
    return this.data.buffer as SharedArrayBuffer;
  }

  get count(): number {
    return this.data[0]!;
  }

  append(voxel: number): void {
    const n = this.data[0]!;
    if (n + 1 >= this.data.length) throw new Error('DigLog: full (raise soil.digLog)');
    this.data[n + 1] = voxel;
    this.data[0] = n + 1;
  }

  /** Call `apply` for each entry not yet applied by this reader. */
  replay(apply: (voxel: number) => void): void {
    const n = this.data[0]!;
    for (let k = this.applied; k < n; k++) apply(this.data[k + 1]!);
    this.applied = n;
  }
}
