/**
 * The brood of the colony (Phase 6): eggs, larvae and pupae lying in the
 * nest. Brood does not move or decide anything; it develops, and larvae eat
 * what nurses give them. It lives only in the coordinating thread's World
 * and is changed only in World.completeStep (feeding requests are granted
 * there in slot order); helper threads see it only through the brood-demand
 * grid (BroodDemand), which is rebuilt there too.
 *
 * Slots are reused LIFO like agent slots, so the store is deterministic.
 */

export const BroodStage = { NONE: 0, EGG: 1, LARVA: 2, PUPA: 3 } as const;

const INITIAL = 256;

export class BroodStore {
  /** BroodStage (NONE = free slot). */
  stage = new Uint8Array(INITIAL);
  /** Soil voxel the item lies in (Soil.index). */
  cell = new Int32Array(INITIAL);
  /** Time left in the stage (s): egg and pupa; for a larva, the time left of its minimum larval period. */
  timer = new Float64Array(INITIAL);
  /** Larva: food eaten so far, food in its gut (mg), time its gut has been empty (s). */
  eaten = new Float64Array(INITIAL);
  gut = new Float64Array(INITIAL);
  hungry = new Float64Array(INITIAL);
  /** Agent slot carrying the item, −1 when it lies in the nest (Phase 7). */
  carrier = new Int32Array(INITIAL);
  highWater = 0;
  count = 0;
  private free: number[] = [];

  add(stage: number, cell: number, timer: number): number {
    let i: number;
    if (this.free.length > 0) i = this.free.pop()!;
    else {
      if (this.highWater === this.stage.length) this.grow();
      i = this.highWater++;
    }
    this.stage[i] = stage;
    this.cell[i] = cell;
    this.timer[i] = timer;
    this.eaten[i] = 0;
    this.gut[i] = 0;
    this.hungry[i] = 0;
    this.carrier[i] = -1;
    this.count++;
    return i;
  }

  remove(i: number): void {
    if (this.stage[i] === BroodStage.NONE) return;
    this.stage[i] = BroodStage.NONE;
    this.free.push(i);
    this.count--;
  }

  countStage(stage: number): number {
    let n = 0;
    for (let i = 0; i < this.highWater; i++) if (this.stage[i] === stage) n++;
    return n;
  }

  /** Views over the used range plus the free list (for state hashing). */
  views(): ArrayBufferView[] {
    const n = this.highWater;
    return [
      this.stage.subarray(0, n), this.cell.subarray(0, n), this.timer.subarray(0, n),
      this.eaten.subarray(0, n), this.gut.subarray(0, n), this.hungry.subarray(0, n), this.carrier.subarray(0, n), Int32Array.from(this.free),
    ];
  }

  private grow(): void {
    const n = this.stage.length * 2;
    const g = <T extends Uint8Array | Int32Array | Float64Array>(a: T): T => {
      const b = new (a.constructor as new (n: number) => T)(n);
      b.set(a);
      return b;
    };
    this.stage = g(this.stage); this.cell = g(this.cell); this.timer = g(this.timer);
    this.eaten = g(this.eaten); this.gut = g(this.gut); this.hungry = g(this.hungry); this.carrier = g(this.carrier);
  }
}
