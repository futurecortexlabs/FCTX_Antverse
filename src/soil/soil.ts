/**
 * Soil below the nest as 1 mm voxels (Phase 5). docs/ARCHITECTURE.md §4.3
 *
 * The region is a box centred on the nest entrance (the origin): sizeX × depth
 * × sizeZ mm, its top just above the highest ground point inside it. A voxel
 * is soil if its centre lies below the generated ground surface and it has
 * not been dug; everything above the ground is air. Only digging changes the
 * soil, so the state is just "dug" flags, held per 32³ chunk and allocated
 * only for chunks that have been dug into. The region's sides and bottom are
 * undiggable.
 *
 * Voxel coordinates: ix along +x, iz along +z, d = depth index (0 = the top
 * layer, increasing downwards). Voxel (ix, d, iz) spans x ∈ [x0 + ix, x0 + ix + 1),
 * z ∈ [z0 + iz, …) and y ∈ (top − d − 1, top − d].
 */

import type { Config } from '../config/params.ts';
import type { StateHasher } from '../core/statehash.ts';
import type { Terrain } from '../terrain/terrain.ts';

export const CHUNK = 32;
const CHUNK3 = CHUNK * CHUNK * CHUNK;
/** How far (voxels, per axis) a dug voxel can change a memoised property (Soil.memoGet). */
export const MEMO_REACH = 2;

export class Soil {
  readonly nx: number;
  readonly nd: number;
  readonly nz: number;
  readonly x0: number;
  readonly z0: number;
  /** World y of the region's top face. */
  readonly top: number;
  /** Per column (ix + iz·nx): the number of air voxels above the ground surface. */
  readonly airTop: Int16Array;
  private readonly cx: number;
  private readonly cd: number;
  /** Dug flags of the chunks dug into, by chunk index; iterated in ascending key order for hashing. */
  private readonly chunks = new Map<number, Uint8Array>();
  /** Chunks changed since the last takeDirty(). */
  private readonly dirty = new Set<number>();
  /** Voxels dug so far. */
  dug = 0;

  constructor(cfg: Config, terrain: Terrain) {
    const [sx, sd, sz] = cfg.soil.size as [number, number, number];
    this.nx = sx; this.nd = sd; this.nz = sz;
    this.crust = Math.round(cfg.soil.crust);
    this.entrance = cfg.scenario.nestRadius;
    this.x0 = -sx / 2; this.z0 = -sz / 2;
    this.cx = Math.ceil(sx / CHUNK); this.cd = Math.ceil(sd / CHUNK);
    // The top: one voxel above the highest ground point over all column centres.
    let hi = -Infinity;
    const g = new Float64Array(sx * sz);
    for (let iz = 0; iz < sz; iz++) for (let ix = 0; ix < sx; ix++) {
      const h = terrain.groundHeight(this.x0 + ix + 0.5, this.z0 + iz + 0.5);
      g[ix + iz * sx] = h;
      if (h > hi) hi = h;
    }
    this.top = Math.ceil(hi) + 1;
    this.airTop = new Int16Array(sx * sz);
    // Voxel d is air if its centre (top − d − 0.5) is at or above the ground.
    for (let k = 0; k < g.length; k++) this.airTop[k] = Math.floor(this.top - 0.5 - g[k]!) + 1;
  }

  inBounds(ix: number, d: number, iz: number): boolean {
    return ix >= 0 && iz >= 0 && d >= 0 && ix < this.nx && iz < this.nz && d < this.nd;
  }

  /** Index of the chunk holding voxel (ix, d, iz). */
  chunkKeyOf(ix: number, d: number, iz: number): number {
    return this.chunkKey(ix, d, iz);
  }

  private chunkKey(ix: number, d: number, iz: number): number {
    return ((iz >> 5) * this.cd + (d >> 5)) * this.cx + (ix >> 5);
  }

  private local(ix: number, d: number, iz: number): number {
    return ((iz & 31) * CHUNK + (d & 31)) * CHUNK + (ix & 31);
  }

  /** Has this voxel been dug out? */
  isDug(ix: number, d: number, iz: number): boolean {
    if (!this.inBounds(ix, d, iz)) return false;
    const c = this.chunks.get(this.chunkKey(ix, d, iz));
    return c !== undefined && c[this.local(ix, d, iz)] === 1;
  }

  /** Is the voxel open space (air above the ground, or dug)? Outside the region: air above the top, solid elsewhere. */
  isOpen(ix: number, d: number, iz: number): boolean {
    if (d < 0) return true;
    if (!this.inBounds(ix, d, iz)) return false;
    if (d < this.airTop[ix + iz * this.nx]!) return true;
    return this.isDug(ix, d, iz);
  }

  /**
   * Can this voxel be dug: soil, inside the region and not on its walls or
   * floor, and not in the crust under the surface outside the entrance?
   */
  canDig(ix: number, d: number, iz: number): boolean {
    if (ix <= 0 || iz <= 0 || ix >= this.nx - 1 || iz >= this.nz - 1 || d >= this.nd - 1) return false;
    if (d < this.airTop[ix + iz * this.nx]! + this.crust) {
      const x = this.centreX(ix), z = this.centreZ(iz);
      if (x * x + z * z > this.entrance * this.entrance) return false;
    }
    return !this.isOpen(ix, d, iz);
  }

  /** Voxels under the surface kept intact (soil.crust), except within `entrance` of the origin. */
  private readonly crust: number;
  private readonly entrance: number;

  /**
   * Memo of derived per-voxel properties that depend only on the soil within
   * MEMO_REACH voxels (burrow.ts: standable, nearWall), as 8 bits per voxel
   * (0 = not yet computed). Cleared around every dug voxel, so it is a pure
   * cache: results never depend on what was asked before.
   */
  private readonly memo = new Map<number, Uint8Array>();

  memoGet(ix: number, d: number, iz: number): number {
    if (!this.inBounds(ix, d, iz)) return 0;
    const m = this.memo.get(this.chunkKey(ix, d, iz));
    return m === undefined ? 0 : m[this.local(ix, d, iz)]!;
  }

  memoSet(ix: number, d: number, iz: number, value: number): void {
    if (!this.inBounds(ix, d, iz)) return;
    const key = this.chunkKey(ix, d, iz);
    let m = this.memo.get(key);
    if (!m) { m = new Uint8Array(CHUNK3); this.memo.set(key, m); }
    m[this.local(ix, d, iz)] = value;
  }

  private forgetAround(ix: number, d: number, iz: number): void {
    for (let dz = -MEMO_REACH; dz <= MEMO_REACH; dz++) for (let dd = -MEMO_REACH; dd <= MEMO_REACH; dd++) for (let dx = -MEMO_REACH; dx <= MEMO_REACH; dx++) {
      const x = ix + dx, y = d + dd, z = iz + dz;
      if (!this.inBounds(x, y, z)) continue;
      const m = this.memo.get(this.chunkKey(x, y, z));
      if (m) m[this.local(x, y, z)] = 0;
    }
  }

  /** Remove the soil of one voxel. Returns false if there was none to dig. */
  dig(ix: number, d: number, iz: number): boolean {
    if (!this.canDig(ix, d, iz)) return false;
    const key = this.chunkKey(ix, d, iz);
    let c = this.chunks.get(key);
    if (!c) { c = new Uint8Array(CHUNK3); this.chunks.set(key, c); }
    c[this.local(ix, d, iz)] = 1;
    this.forgetAround(ix, d, iz);
    this.dirty.add(key);
    this.dug++;
    return true;
  }

  // --- coordinates ---------------------------------------------------------

  voxelX(x: number): number { return Math.floor(x - this.x0); }
  voxelZ(z: number): number { return Math.floor(z - this.z0); }
  voxelD(y: number): number { return Math.floor(this.top - y); }
  centreX(ix: number): number { return this.x0 + ix + 0.5; }
  centreZ(iz: number): number { return this.z0 + iz + 0.5; }
  centreY(d: number): number { return this.top - d - 0.5; }

  /** Linear voxel index (for compact per-agent storage) and back. */
  index(ix: number, d: number, iz: number): number { return (iz * this.nd + d) * this.nx + ix; }
  unindex(k: number, out: Int32Array): void {
    out[0] = k % this.nx;
    const r = (k - out[0]) / this.nx;
    out[1] = r % this.nd;
    out[2] = (r - out[1]) / this.nd;
  }

  // --- state ---------------------------------------------------------------

  /** Feed the dug state into a state hash (chunks in ascending key order). */
  hashInto(h: StateHasher): void {
    h.word(this.dug).word(this.chunks.size);
    for (const key of [...this.chunks.keys()].sort((a, b) => a - b)) h.word(key).view(this.chunks.get(key)!);
  }

  /** Chunks changed since the last call: their keys and a copy of their dug flags (for the renderer). */
  takeDirty(): { key: number; data: Uint8Array }[] {
    const out = [...this.dirty].sort((a, b) => a - b).map((key) => ({ key, data: this.chunks.get(key)!.slice() }));
    this.dirty.clear();
    return out;
  }

  /** Apply chunks from takeDirty() (the renderer's mirror). */
  applyChunk(key: number, data: Uint8Array): void {
    const had = this.chunks.get(key);
    let n = 0;
    for (let i = 0; i < data.length; i++) n += data[i]!;
    let before = 0;
    if (had) for (let i = 0; i < had.length; i++) before += had[i]!;
    this.chunks.set(key, data);
    this.dug += n - before;
  }

  /** Chunk index → voxel origin of the chunk. */
  chunkOrigin(key: number): [number, number, number] {
    const ix = (key % this.cx) * CHUNK;
    const r = Math.floor(key / this.cx);
    const d = (r % this.cd) * CHUNK;
    const iz = Math.floor(r / this.cd) * CHUNK;
    return [ix, d, iz];
  }

  chunkKeys(): number[] {
    return [...this.chunks.keys()].sort((a, b) => a - b);
  }
}
