/**
 * The mound of excavated soil around the nest entrance (Phase 5).
 *
 * A heightfield on a cell grid around the entrance. Each pellet dropped by a
 * worker adds its volume to the cell it lands in; wherever the pile becomes
 * steeper than the angle of repose of loose soil, material slides to the
 * lower neighbour until the pile is stable again (PHY-SOIL-002; a sandpile
 * rule). Workers do not drop pellets into the entrance, but soil sliding
 * down the pile can cover it: the mound becomes a cone round the entrance.
 * (The way into the nest is the entrance position, not a hole in the
 * heightfield.)
 *
 * Volumes are tracked exactly as pellet counts; the heights are their
 * (floating-point) distribution on the ground.
 */

import type { HeightOverlay } from '../terrain/terrain.ts';

/** Height differences within this of the repose step count as stable (float rounding; mm). */
const SETTLE_EPS = 1e-4;
/** 4-neighbourhood offsets (dx, dz). */
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export interface MoundSpec {
  /** Centre (the nest entrance) and half-extent of the grid (mm). */
  cx: number;
  cz: number;
  radius: number;
  cell: number;
  /** Largest stable height difference between neighbouring cells, as a slope (tan of the angle of repose). */
  repose: number;
  /** Radius around the centre where pellets are not dropped (the entrance). */
  open: number;
}

export class Mound implements HeightOverlay {
  readonly x0: number;
  readonly z0: number;
  readonly cell: number;
  readonly n: number;
  readonly heights: Float32Array;
  /** Cells where pellets are not dropped (the entrance). */
  private readonly blocked: Uint8Array;
  private readonly maxStep: number;
  /** Pellets dropped so far. */
  pellets = 0;
  /** Bumped on every change (renderer and caches). */
  version = 0;

  constructor(spec: MoundSpec, buffer?: SharedArrayBuffer, shared = false) {
    this.cell = spec.cell;
    this.n = Math.ceil((2 * spec.radius) / spec.cell) + 1;
    this.x0 = spec.cx - ((this.n - 1) * spec.cell) / 2;
    this.z0 = spec.cz - ((this.n - 1) * spec.cell) / 2;
    const n2 = this.n * this.n;
    this.heights = buffer ? new Float32Array(buffer) : shared ? new Float32Array(new SharedArrayBuffer(n2 * 4)) : new Float32Array(n2);
    this.blocked = new Uint8Array(n2);
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const dx = this.x0 + i * this.cell - spec.cx, dz = this.z0 + j * this.cell - spec.cz;
      if (dx * dx + dz * dz <= spec.open * spec.open) this.blocked[j * this.n + i] = 1;
    }
    this.maxStep = spec.repose * spec.cell;
  }

  get buffer(): ArrayBufferLike {
    return this.heights.buffer;
  }

  /** Bilinear height at (x, z); 0 outside the grid. */
  heightAt(x: number, z: number): number {
    const fx = (x - this.x0) / this.cell, fz = (z - this.z0) / this.cell;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= this.n - 1 || j >= this.n - 1) return 0;
    const a = fx - i, b = fz - j, o = j * this.n + i, h = this.heights;
    return (1 - b) * ((1 - a) * h[o]! + a * h[o + 1]!) + b * ((1 - a) * h[o + this.n]! + a * h[o + this.n + 1]!);
  }

  /** Can a pellet be dropped at (x, z) (on the grid and outside the entrance)? */
  canDrop(x: number, z: number): boolean {
    const i = Math.round((x - this.x0) / this.cell), j = Math.round((z - this.z0) / this.cell);
    return i > 0 && j > 0 && i < this.n - 1 && j < this.n - 1 && this.blocked[j * this.n + i] === 0;
  }

  /** Drop one pellet of `volume` mm³ at (x, z) and let the pile settle. */
  drop(x: number, z: number, volume: number): void {
    const i = Math.round((x - this.x0) / this.cell), j = Math.round((z - this.z0) / this.cell);
    const o = j * this.n + i;
    this.heights[o] = this.heights[o]! + volume / (this.cell * this.cell);
    this.pellets++;
    this.settle(o);
    this.version++;
  }

  /**
   * Avalanche from cell `start` until no neighbouring pair is steeper than the
   * repose slope. Deterministic: cells are processed first-in first-out.
   */
  private settle(start: number): void {
    const n = this.n, h = this.heights, maxStep = this.maxStep;
    const queue: number[] = [start];
    for (let q = 0; q < queue.length; q++) {
      const o = queue[q]!;
      const i = o % n, j = (o - i) / n;
      for (const [dx, dz] of NEIGHBOURS) {
        const ni = i + dx, nj = j + dz;
        if (ni <= 0 || nj <= 0 || ni >= n - 1 || nj >= n - 1) continue; // the grid edge holds nothing
        const no = nj * n + ni;
        // Either way: down to the neighbour, or (if this cell has been lowered) down from it.
        const diff = h[o]! - h[no]!;
        if (Math.abs(diff) > maxStep + SETTLE_EPS) {
          // Move half the excess: both cells end exactly at the repose slope.
          const move = ((Math.abs(diff) - maxStep) / 2) * Math.sign(diff);
          h[o] = h[o]! - move;
          h[no] = h[no]! + move;
          queue.push(no, o);
        }
      }
    }
  }

  /** Total volume on the ground (mm³), for checks. */
  volume(): number {
    let v = 0;
    for (let k = 0; k < this.heights.length; k++) v += this.heights[k]!;
    return v * this.cell * this.cell;
  }
}
