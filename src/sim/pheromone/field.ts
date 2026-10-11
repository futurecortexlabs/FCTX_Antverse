/**
 * Trail pheromone on the ground plane. docs/ARCHITECTURE.md §4.2
 *
 * A dense grid of cells (cell × cell mm) over a rectangle, updated only where
 * there is pheromone: the grid is split into tiles, and evaporation and
 * diffusion run on active tiles (and their neighbours) only. Deposits are
 * splatted bilinearly; samples are read bilinearly.
 *
 *   evaporation  c ← c·exp(−Δt/τ)       (τ = pheromone.lifetime, BIO-PHE-002)
 *   diffusion    explicit 5-point, D·Δt/cell² ≤ 1/4 checked at construction
 *
 * The grid may live in shared memory so helper threads can *read* it while
 * stepping their agents; only the coordinating thread writes it, between
 * ticks, so every thread sees the same field during a tick (determinism).
 */

import { dexp } from '../../core/dmath.ts';

export interface FieldSpec {
  x0: number;
  z0: number;
  width: number;
  depth: number;
  cell: number;
  /** Mean lifetime (s) */
  lifetime: number;
  /** Diffusion coefficient (mm²/s) */
  diffusion: number;
  /** Seconds between field updates */
  dt: number;
  /** Below this a tile is considered empty and deactivated */
  epsilon: number;
}

export const TILE = 32;
const STABILITY = 0.25;

export class PheromoneField {
  readonly x0: number;
  readonly z0: number;
  readonly cell: number;
  readonly nx: number;
  readonly nz: number;
  readonly data: Float32Array;
  private readonly next: Float32Array;
  private readonly tilesX: number;
  private readonly tilesZ: number;
  private readonly active: Uint8Array;
  private readonly decay: number;
  private readonly kappa: number;
  private readonly epsilon: number;

  constructor(spec: FieldSpec, shared = false, buffer?: SharedArrayBuffer) {
    this.x0 = spec.x0;
    this.z0 = spec.z0;
    this.cell = spec.cell;
    this.nx = Math.ceil(spec.width / spec.cell) + 1;
    this.nz = Math.ceil(spec.depth / spec.cell) + 1;
    const n = this.nx * this.nz;
    this.data = buffer ? new Float32Array(buffer) : shared ? new Float32Array(new SharedArrayBuffer(n * 4)) : new Float32Array(n);
    this.next = new Float32Array(n);
    this.tilesX = Math.ceil(this.nx / TILE);
    this.tilesZ = Math.ceil(this.nz / TILE);
    this.active = new Uint8Array(this.tilesX * this.tilesZ);
    this.decay = dexp(-spec.dt / spec.lifetime);
    this.kappa = (spec.diffusion * spec.dt) / (spec.cell * spec.cell);
    if (this.kappa > STABILITY) throw new Error(`PheromoneField: unstable diffusion (D·dt/cell² = ${this.kappa} > ${STABILITY})`);
    this.epsilon = spec.epsilon;
  }

  get buffer(): ArrayBufferLike {
    return this.data.buffer;
  }

  /** Bilinear sample at (x, z); 0 outside the grid. */
  sample(x: number, z: number): number {
    const fx = (x - this.x0) / this.cell, fz = (z - this.z0) / this.cell;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= this.nx - 1 || j >= this.nz - 1) return 0;
    const a = fx - i, b = fz - j, o = j * this.nx + i, d = this.data;
    return (1 - b) * ((1 - a) * d[o]! + a * d[o + 1]!) + b * ((1 - a) * d[o + this.nx]! + a * d[o + this.nx + 1]!);
  }

  /** Add `amount` at (x, z), spread bilinearly over the 4 surrounding cells. */
  deposit(x: number, z: number, amount: number): void {
    const fx = (x - this.x0) / this.cell, fz = (z - this.z0) / this.cell;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= this.nx - 1 || j >= this.nz - 1) return;
    const a = fx - i, b = fz - j, o = j * this.nx + i, d = this.data;
    d[o] = d[o]! + amount * (1 - a) * (1 - b);
    d[o + 1] = d[o + 1]! + amount * a * (1 - b);
    d[o + this.nx] = d[o + this.nx]! + amount * (1 - a) * b;
    d[o + this.nx + 1] = d[o + this.nx + 1]! + amount * a * b;
    this.activate(i, j);
    this.activate(i + 1, j + 1);
  }

  private activate(i: number, j: number): void {
    const ti = Math.min(this.tilesX - 1, Math.floor(i / TILE)), tj = Math.min(this.tilesZ - 1, Math.floor(j / TILE));
    this.active[tj * this.tilesX + ti] = 1;
  }

  /** One field update: diffusion then evaporation on active tiles; empty tiles go idle. */
  step(): void {
    const { nx, nz, data, next, tilesX, tilesZ, active, decay, kappa } = this;
    // Tiles to process: active ones and their 4 neighbours (diffusion spreads one cell per update).
    const work = new Uint8Array(active.length);
    for (let t = 0; t < active.length; t++) {
      if (!active[t]) continue;
      const ti = t % tilesX, tj = (t - ti) / tilesX;
      work[t] = 1;
      if (ti > 0) work[t - 1] = 1;
      if (ti < tilesX - 1) work[t + 1] = 1;
      if (tj > 0) work[t - tilesX] = 1;
      if (tj < tilesZ - 1) work[t + tilesX] = 1;
    }
    for (let t = 0; t < work.length; t++) {
      if (!work[t]) continue;
      const ti = t % tilesX, tj = (t - ti) / tilesX;
      const i0 = ti * TILE, j0 = tj * TILE, i1 = Math.min(nx, i0 + TILE), j1 = Math.min(nz, j0 + TILE);
      for (let j = j0; j < j1; j++) {
        for (let i = i0; i < i1; i++) {
          const o = j * nx + i;
          const c = data[o]!;
          // Zero-flux boundary: missing neighbours count as equal to the cell.
          const l = i > 0 ? data[o - 1]! : c, r = i < nx - 1 ? data[o + 1]! : c;
          const u = j > 0 ? data[o - nx]! : c, dn = j < nz - 1 ? data[o + nx]! : c;
          next[o] = (c + kappa * (l + r + u + dn - 4 * c)) * decay;
        }
      }
    }
    for (let t = 0; t < work.length; t++) {
      if (!work[t]) continue;
      const ti = t % tilesX, tj = (t - ti) / tilesX;
      const i0 = ti * TILE, j0 = tj * TILE, i1 = Math.min(nx, i0 + TILE), j1 = Math.min(nz, j0 + TILE);
      let max = 0;
      for (let j = j0; j < j1; j++) {
        for (let i = i0; i < i1; i++) {
          const o = j * nx + i;
          const v = next[o]!;
          data[o] = v;
          if (v > max) max = v;
        }
      }
      if (max > this.epsilon) active[t] = 1;
      else {
        // Going idle: clear the remainder so it does not linger un-evaporated.
        active[t] = 0;
        for (let j = j0; j < j1; j++) data.fill(0, j * nx + i0, j * nx + i1);
      }
    }
  }

  /** Remove all pheromone (an experimenter wiping the substrate). */
  clear(): void {
    this.data.fill(0);
    this.active.fill(0);
  }

  /** Total pheromone (for tests). */
  total(): number {
    let s = 0;
    for (let k = 0; k < this.data.length; k++) s += this.data[k]!;
    return s;
  }

  activeTiles(): number {
    let n = 0;
    for (const a of this.active) n += a;
    return n;
  }
}
