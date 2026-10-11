/**
 * The ground an ant walks on (Phase 1). docs/ARCHITECTURE.md §4.5
 *
 * Height of the soil surface = macro relief (gentle undulation, metres to
 * centimetres) + micro relief (soil roughness, centimetres to 0.25 mm), both
 * deterministic gradient-noise sums. On top lie discrete objects:
 *   - coarse sand grains (procedural per cell, never stored),
 *   - pebbles (stored), leaves draped over the soil (stored),
 *   - grass tufts made of blades (stored).
 * Patches (leaf litter, grass, gravel) come from low-frequency masks whose
 * thresholds are calibrated to the configured cover fractions; the area
 * around the nest entrance (origin) is kept bare.
 *
 * Everything is a pure function of (config, seed): the sim worker and the
 * renderer each build an identical Terrain. `supportHeight` is what a foot
 * would stand on; the renderer draws exactly these shapes.
 */

import { StateHasher } from '../core/statehash.ts';
import { hashKey, rand, Stream } from '../core/rng.ts';
import { PI, TAU, dcos, dsin } from '../core/dmath.ts';
import type { Config } from '../config/params.ts';
import { GridIndex } from './grid-index.ts';
import { bandWeight, fbmAdd, gradNoise, hurstAmplitudes, newSample, type FbmSpec, type Sample } from './noise.ts';
import {
  ellipsoidHalfHeight, ellipsoidInverse, ellipsoidSpan, ellipsoidTop, lerp, poisson, powerLawSize, smoothstep, type Ellipsoid,
} from './shapes.ts';

/** |gradient noise| never exceeds √2/2 for unit gradients. */
export const NOISE_BOUND = Math.SQRT1_2;

export const Patch = { LITTER: 0, GRASS: 1, GRAVEL: 2 } as const;
export type PatchKind = (typeof Patch)[keyof typeof Patch];
const PATCH_COUNT = 3;

/** Sub-key indices for per-object random draws (never renumber). */
const K = {
  COUNT: 0, X: 1, Z: 2, SIZE: 3, ELONG: 4, FLAT: 5, YAW: 6, TILT: 7, EMBED: 8, COLOR: 9,
  LEN: 10, WIDTH: 11, CURL: 12, BLADES: 13, LEAN: 14, DROOP: 15, RADIUS: 16, ANGLE: 17,
} as const;

/**
 * Leaf outline: half-width at position s ∈ [0,1] along the midrib (base → tip),
 * as a fraction of W/2. An ellipse tilted by `taper` so it is widest towards
 * the base (ovate).
 */
export function leafHalfWidthFactor(s: number, taper: number): number {
  if (s <= 0 || s >= 1) return 0;
  return Math.sqrt(4 * s * (1 - s)) * (1 - taper * (s - 0.5));
}

/** Floats per cached grain: cx cy cz a b c yaw tilt tone, then 9 inverse-transform numbers. */
export const GRAIN_STRIDE = 18;
const EMPTY = new Float64Array(0);

export interface ParticleSet {
  count: number;
  /** cx, cy, cz per particle */
  center: Float64Array;
  /** a, b, c radii */
  radii: Float64Array;
  yaw: Float64Array;
  tilt: Float64Array;
  /** 9 inverse-transform numbers per particle */
  inv: Float64Array;
  /** Footprint radius (largest radius) */
  bound: Float64Array;
  /** Colour selector in [0,1) */
  tone: Float64Array;
}

export interface LeafSet {
  count: number;
  cx: Float64Array; cz: Float64Array; yaw: Float64Array;
  /** cos / sin of yaw (cached) */
  cosYaw: Float64Array; sinYaw: Float64Array;
  length: Float64Array; width: Float64Array; curl: Float64Array; tone: Float64Array;
  /** Mid-surface heights on the drape grid, (nu+1)*(nv+1) per leaf, row-major in s then t. */
  heights: Float32Array;
  nu: number; nv: number;
}

export interface GrassSet {
  blades: number;
  /** Base position (x, y, z) */
  base: Float64Array;
  /** Lean direction (yaw), base lean from vertical, extra tip droop, length, width, tone */
  yaw: Float64Array; lean: Float64Array; droop: Float64Array;
  length: Float64Array; width: Float64Array; tone: Float64Array;
  tufts: number;
}

/** Extra height on top of the generated soil surface at (x, z) (mm, ≥ 0). */
export interface HeightOverlay {
  heightAt(x: number, z: number): number;
}

export class Terrain {
  readonly config: Config;
  readonly seed: number;
  /** Simulated square is [-half, half]² */
  readonly half: number;
  readonly macro: FbmSpec;
  readonly micro: FbmSpec;
  private readonly patchSpec: FbmSpec[];
  /** Calibrated mask thresholds per patch kind */
  readonly thresholds: number[];
  readonly pebbles: ParticleSet;
  readonly leaves: LeafSet;
  readonly grass: GrassSet;
  private readonly pebbleIndex: GridIndex;
  private readonly leafIndex: GridIndex;
  private readonly s = newSample();
  /** Clearance of each leaf above its smoothed soil (see reliefDeviation). */
  readonly leafMargins: Float64Array;
  /** Standard deviation of a single gradient-noise octave (measured once). */
  readonly noiseStd: number;

  constructor(config: Config) {
    this.config = config;
    const t = config.terrain;
    this.seed = config.sim.seed >>> 0;
    this.half = t.size / 2;
    const salts = (octaves: number, k: number): number[] =>
      Array.from({ length: octaves }, (_, i) => hashKey(this.seed, Stream.TERRAIN_SALT, k, i, 0));
    this.macro = {
      wavelength: t.macroWavelength, octaves: t.macroOctaves, lacunarity: t.lacunarity,
      amps: hurstAmplitudes(t.macroWavelength, t.macroOctaves, t.lacunarity, t.macroSlope, 1), salts: salts(t.macroOctaves, 0),
    };
    this.micro = {
      wavelength: t.microWavelength, octaves: t.microOctaves, lacunarity: t.lacunarity,
      amps: hurstAmplitudes(t.microWavelength, t.microOctaves, t.lacunarity, t.microSlope, t.microHurst), salts: salts(t.microOctaves, 1),
    };
    this.patchSpec = Array.from({ length: PATCH_COUNT }, (_, k) => ({
      wavelength: t.patchWavelength, octaves: 2, lacunarity: t.lacunarity,
      amps: hurstAmplitudes(t.patchWavelength, 2, t.lacunarity, 1 / t.patchWavelength, 1), salts: salts(2, 2 + k),
    }));
    this.noiseStd = measureNoiseStd(t.calibrationSamples);
    this.thresholds = [t.litterCover, t.grassCover, t.gravelCover].map((cover, k) => this.calibrate(k, cover));

    // Leaves first: pebbles and grains are not placed under leaves.
    this.leaves = this.generateLeaves();
    const lb = new Float64Array(this.leaves.count);
    for (let i = 0; i < lb.length; i++) lb[i] = this.leaves.length[i]! / 2;
    this.leafIndex = new GridIndex(this.leaves.cx, this.leaves.cz, lb, -this.half, t.size, t.leafCell);
    this.leafMargins = new Float64Array(this.leaves.count);
    this.drapeLeaves();

    this.pebbles = this.generatePebbles();
    const px = new Float64Array(this.pebbles.count), pz = new Float64Array(this.pebbles.count);
    for (let i = 0; i < px.length; i++) { px[i] = this.pebbles.center[3 * i]!; pz[i] = this.pebbles.center[3 * i + 2]!; }
    this.pebbleIndex = new GridIndex(px, pz, this.pebbles.bound, -this.half, t.size, t.pebbleCell);

    this.grass = this.generateGrass();
  }

  // ---------------------------------------------------------------------------
  // Soil surface

  /** Soil height and slope at (x, z), band-limited for vertex spacing h (0 = full detail). */
  ground(x: number, z: number, h: number, out: Sample): void {
    out.v = 0; out.dx = 0; out.dz = 0;
    fbmAdd(x, z, this.macro, h, out);
    fbmAdd(x, z, this.micro, h, out);
  }

  groundHeight(x: number, z: number, h = 0): number {
    this.ground(x, z, h, this.s);
    return this.overlay ? this.s.v + this.overlay.heightAt(x, z) : this.s.v;
  }

  /** Generated soil height only, without the overlay (what grains and pebbles were laid on). */
  baseHeight(x: number, z: number, h = 0): number {
    this.ground(x, z, h, this.s);
    return this.s.v;
  }

  /**
   * Dynamic material added on top of the soil (Phase 5: the mound of excavated
   * soil around the nest entrance). Owned by the simulation state, not by the
   * generated terrain, so it is not part of digest(). Generation runs without it.
   */
  overlay: HeightOverlay | null = null;

  /** Bound on |macro + micro| (for bounding boxes). */
  reliefBound(): number {
    let a = 0;
    for (const f of [this.macro, this.micro]) for (const amp of f.amps) a += amp;
    return a * NOISE_BOUND;
  }

  // ---------------------------------------------------------------------------
  // Patches

  private rawPatch(k: number, x: number, z: number): number {
    const o = this.s;
    o.v = 0; o.dx = 0; o.dz = 0;
    fbmAdd(x, z, this.patchSpec[k]!, 0, o);
    return o.v;
  }

  private calibrate(k: number, cover: number): number {
    const n = this.config.terrain.calibrationSamples;
    const vals = new Float64Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -this.half + ((i + 0.5) / n) * 2 * this.half;
      const z = -this.half + ((j + 0.5) / n) * 2 * this.half;
      vals[j * n + i] = this.rawPatch(k, x, z);
    }
    vals.sort();
    const q = Math.min(vals.length - 1, Math.max(0, Math.floor((1 - cover) * vals.length)));
    return cover >= 1 ? -Infinity : cover <= 0 ? Infinity : vals[q]!;
  }

  /** Patch membership in [0, 1] (soft edge), zero near the nest entrance. */
  patch(kind: PatchKind, x: number, z: number): number {
    const t = this.config.terrain;
    const th = this.thresholds[kind]!;
    if (th === Infinity) return 0;
    const soft = t.patchSoftness * this.patchScale(kind);
    const m = th === -Infinity ? 1 : smoothstep(th - soft, th + soft, this.rawPatch(kind, x, z));
    const r = Math.sqrt(x * x + z * z);
    return m * smoothstep(t.nestClearRadius, 2 * t.nestClearRadius, r);
  }

  private patchScale(kind: number): number {
    // Sum of the patch-noise octave amplitudes.
    let a = 0;
    for (const amp of this.patchSpec[kind]!.amps) a += amp;
    return a;
  }

  // ---------------------------------------------------------------------------
  // Generation helpers

  private inDomain(x: number, z: number): boolean {
    return x >= -this.half && x < this.half && z >= -this.half && z < this.half;
  }

  /** Place particles of one cell; calls emit for each accepted particle. */
  private particlesInCell(
    stream: number, cell: number, ix: number, iz: number, density: number, sizeRange: readonly number[], maxTilt: number,
    accept: (x: number, z: number) => number, emit: (e: Ellipsoid, tone: number) => void,
  ): void {
    const t = this.config.terrain;
    const id = (Math.imul(ix, 0x8da6b343) ^ Math.imul(iz, 0xd8163841)) >>> 0;
    const r = (k: number, sub: number): number => rand(this.seed, stream, id, sub, k);
    const x0 = ix * cell, z0 = iz * cell;
    const cx = x0 + cell / 2, cz = z0 + cell / 2;
    const mean = density * cell * cell * accept(cx, cz);
    const n = poisson(mean, r(K.COUNT, 0));
    for (let i = 1; i <= n; i++) {
      const x = x0 + r(K.X, i) * cell;
      const z = z0 + r(K.Z, i) * cell;
      if (accept(x, z) <= 0 || this.leafCovers(x, z)) continue;
      const size = powerLawSize(r(K.SIZE, i), sizeRange[0]!, sizeRange[1]!, t.sizeExponent);
      const a = size / 2;
      const e: Ellipsoid = {
        cx: x, cy: 0, cz: z,
        a,
        b: a * lerp(t.particleElongation[0]!, t.particleElongation[1]!, r(K.ELONG, i)),
        c: a * lerp(t.particleFlatness[0]!, t.particleFlatness[1]!, r(K.FLAT, i)),
        yaw: (r(K.YAW, i) * 2 - 1) * PI,
        tilt: (r(K.TILT, i) * 2 - 1) * maxTilt,
      };
      const embed = lerp(t.embedFraction[0]!, t.embedFraction[1]!, r(K.EMBED, i));
      // On the generated soil: grains are generated lazily (grainCell), and their
      // place must not depend on when a cell is first needed, i.e. on how high
      // the mound was then. The mound buries them instead (supportHeight).
      e.cy = this.baseHeight(x, z) + ellipsoidHalfHeight(e) * (1 - 2 * embed);
      emit(e, r(K.COLOR, i));
    }
  }

  private cellRange(cell: number): [number, number] {
    return [Math.floor(-this.half / cell), Math.ceil(this.half / cell) - 1];
  }

  // ---------------------------------------------------------------------------
  // Pebbles (stored)

  private generatePebbles(): ParticleSet {
    const t = this.config.terrain;
    const list: [Ellipsoid, number][] = [];
    const [c0, c1] = this.cellRange(t.pebbleCell);
    const accept = (x: number, z: number): number => (this.inDomain(x, z) ? this.patch(Patch.GRAVEL, x, z) : 0);
    for (let iz = c0; iz <= c1; iz++) for (let ix = c0; ix <= c1; ix++) {
      this.particlesInCell(Stream.TERRAIN_PEBBLE, t.pebbleCell, ix, iz, t.pebbleDensity, t.pebbleSize, t.pebbleMaxTilt, accept, (e, tone) => list.push([e, tone]));
    }
    return packParticles(list);
  }

  // ---------------------------------------------------------------------------
  // Grains (procedural, never stored)

  private grainAccept = (x: number, z: number): number => {
    const t = this.config.terrain;
    return this.inDomain(x, z) ? t.grainBareFraction + (1 - t.grainBareFraction) * this.patch(Patch.GRAVEL, x, z) : 0;
  };

  private readonly grainCache = new Map<number, Float64Array>();

  /**
   * Grains of grid cell (ix, iz) (cell size terrain.grainCell), packed with
   * GRAIN_STRIDE floats each. Generated on demand and cached; the cache only
   * affects speed, never values.
   */
  grainCell(ix: number, iz: number): Float64Array {
    const key = (ix + 0x8000) * 0x10000 + (iz + 0x8000);
    const hit = this.grainCache.get(key);
    if (hit) return hit;
    const t = this.config.terrain;
    const list: number[] = [];
    this.particlesInCell(Stream.TERRAIN_GRAIN, t.grainCell, ix, iz, t.grainDensity, t.grainSize, t.grainMaxTilt, this.grainAccept, (e, tone) => {
      list.push(e.cx, e.cy, e.cz, e.a, e.b, e.c, e.yaw, e.tilt, tone, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    });
    const arr = list.length === 0 ? EMPTY : Float64Array.from(list);
    for (let o = 0; o < arr.length; o += GRAIN_STRIDE) {
      const e: Ellipsoid = { cx: arr[o]!, cy: arr[o + 1]!, cz: arr[o + 2]!, a: arr[o + 3]!, b: arr[o + 4]!, c: arr[o + 5]!, yaw: arr[o + 6]!, tilt: arr[o + 7]! };
      ellipsoidInverse(e, arr, o + 9);
    }
    if (this.grainCache.size >= t.grainCacheCells) this.grainCache.clear();
    this.grainCache.set(key, arr);
    return arr;
  }

  /** Highest grain surface over (x, z), or -Infinity. */
  grainTop(x: number, z: number): number {
    const t = this.config.terrain;
    const cell = t.grainCell, rmax = t.grainSize[1]! / 2;
    // Only cells whose grains can reach (x, z): grain centres lie inside their cell.
    const ix0 = Math.floor((x - rmax) / cell), ix1 = Math.floor((x + rmax) / cell);
    const iz0 = Math.floor((z - rmax) / cell), iz1 = Math.floor((z + rmax) / cell);
    let top = -Infinity;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const g = this.grainCell(ix, iz);
      for (let o = 0; o < g.length; o += GRAIN_STRIDE) {
        const a = g[o + 3]!;
        if (Math.abs(x - g[o]!) > a || Math.abs(z - g[o + 2]!) > a) continue;
        const y = ellipsoidTop(x, z, g[o]!, g[o + 1]!, g[o + 2]!, g, o + 9);
        if (y > top) top = y;
      }
    }
    return top;
  }

  pebbleTop(x: number, z: number): number {
    const p = this.pebbles;
    let top = -Infinity;
    const r = this.rng, items = this.pebbleIndex.itemList;
    this.pebbleIndex.range(x, z, r);
    for (let q = r[0]!; q < r[1]!; q++) {
      const i = items[q]!;
      const y = ellipsoidTop(x, z, p.center[3 * i]!, p.center[3 * i + 1]!, p.center[3 * i + 2]!, p.inv, 9 * i);
      if (y > top) top = y;
    }
    return top;
  }

  // ---------------------------------------------------------------------------
  // Leaves (stored, draped)

  private generateLeaves(): LeafSet {
    const t = this.config.terrain;
    const [nu, nv] = [t.leafGrid[0]!, t.leafGrid[1]!];
    const rows: number[][] = [];
    const [c0, c1] = this.cellRange(t.leafCell);
    for (let iz = c0; iz <= c1; iz++) for (let ix = c0; ix <= c1; ix++) {
      const id = (Math.imul(ix, 0x8da6b343) ^ Math.imul(iz, 0xd8163841)) >>> 0;
      const r = (k: number, sub: number): number => rand(this.seed, Stream.TERRAIN_LEAF, id, sub, k);
      const x0 = ix * t.leafCell, z0 = iz * t.leafCell;
      const m = this.inDomain(x0 + t.leafCell / 2, z0 + t.leafCell / 2) ? this.patch(Patch.LITTER, x0 + t.leafCell / 2, z0 + t.leafCell / 2) : 0;
      const n = poisson(t.leafDensity * t.leafCell * t.leafCell * m, r(K.COUNT, 0));
      for (let i = 1; i <= n; i++) {
        const x = x0 + r(K.X, i) * t.leafCell, z = z0 + r(K.Z, i) * t.leafCell;
        if (!this.inDomain(x, z) || r(K.ANGLE, i) > this.patch(Patch.LITTER, x, z)) continue;
        const len = lerp(t.leafLength[0]!, t.leafLength[1]!, r(K.LEN, i));
        rows.push([x, z, (r(K.YAW, i) * 2 - 1) * PI, len, len * lerp(t.leafWidthRatio[0]!, t.leafWidthRatio[1]!, r(K.WIDTH, i)),
          lerp(t.leafCurl[0]!, t.leafCurl[1]!, r(K.CURL, i)), r(K.COLOR, i)]);
      }
    }
    const count = rows.length;
    const col = (j: number): Float64Array => Float64Array.from(rows, (row) => row[j]!);
    const yaw = col(2);
    return {
      count, cx: col(0), cz: col(1), yaw, cosYaw: yaw.map(dcos), sinYaw: yaw.map(dsin),
      length: col(3), width: col(4), curl: col(5), tone: col(6),
      heights: new Float32Array(count * (nu + 1) * (nv + 1)), nu, nv,
    };
  }

  /** World (x, z) of drape-grid node (i, j) of leaf k. */
  leafNode(k: number, i: number, j: number): [number, number, number] {
    const L = this.leaves;
    const s = i / L.nu;
    const tt = (j / L.nv) * 2 - 1;
    const u = (s - 0.5) * L.length[k]!;
    const v = tt * leafHalfWidthFactor(s, this.config.terrain.leafTaper) * L.width[k]! * 0.5;
    const cy = L.cosYaw[k]!, sy = L.sinYaw[k]!;
    // forward = (cos yaw, -sin yaw), lateral = (sin yaw, cos yaw) on (x, z)
    return [L.cx[k]! + u * cy + v * sy, L.cz[k]! - u * sy + v * cy, tt];
  }

  /**
   * How far the full-detail soil deviates from a surface that follows the
   * soil band-limited at spacing h and is interpolated linearly between nodes
   * h apart. Each octave contributes its whole amplitude if dropped by the
   * band limit, or its linear-interpolation error amp·(πh/λ)²/2 if kept.
   *  - sigmas = Infinity: worst case (every octave at its extreme at once)
   *  - otherwise: sigmas × the standard deviation of the summed error
   *    (octaves are independent), a much tighter bound that is exceeded at a
   *    small, measurable fraction of points.
   */
  reliefDeviation(h: number, sigmas = Infinity): number {
    let worst = 0, variance = 0;
    for (const f of [this.macro, this.micro]) {
      let lambda = f.wavelength;
      for (let i = 0; i < f.octaves; i++) {
        const w = bandWeight(lambda, h);
        const r = (PI * h) / lambda;
        const e = f.amps[i]! * ((1 - w) + w * Math.min(2, (r * r) / 2));
        worst += e * NOISE_BOUND;
        variance += (e * this.noiseStd) * (e * this.noiseStd);
        lambda /= f.lacunarity;
      }
    }
    return sigmas === Infinity ? worst : Math.min(worst, sigmas * Math.sqrt(variance));
  }

  private drapeLeaves(): void {
    const t = this.config.terrain;
    const L = this.leaves;
    const stride = (L.nu + 1) * (L.nv + 1);
    for (let k = 0; k < L.count; k++) {
      // A leaf follows relief no finer than its stiffness, nor finer than its own drape grid can carry.
      // Diagonal of a drape cell: the longest span bilinear interpolation bridges.
      const spacing = Math.SQRT2 * Math.max(L.length[k]! / L.nu, L.width[k]! / L.nv);
      const hLeaf = Math.max(t.leafStiffness / 4, spacing);
      const margin = this.reliefDeviation(hLeaf, t.leafClearanceSigma);
      this.leafMargins[k] = margin;
      for (let i = 0; i <= L.nu; i++) for (let j = 0; j <= L.nv; j++) {
        const [x, z, tt] = this.leafNode(k, i, j);
        const soil = this.groundHeight(x, z, hLeaf) + margin;
        const under = Math.max(soil, this.leafTop(x, z, k));
        // Margins curl up; the lift vanishes towards base and tip where the leaf narrows.
        const lift = L.curl[k]! * L.width[k]! * tt * tt * leafHalfWidthFactor(i / L.nu, t.leafTaper);
        L.heights[k * stride + i * (L.nv + 1) + j] = under + t.leafThickness / 2 + lift;
      }
    }
  }

  private readonly loc = new Float64Array(2);

  /** Local leaf coordinates of (x, z) into this.loc: s ∈ [0,1] along, t ∈ [-1,1] across. False if outside. */
  private leafLocal(k: number, x: number, z: number): boolean {
    const L = this.leaves;
    const dx = x - L.cx[k]!, dz = z - L.cz[k]!;
    const cy = L.cosYaw[k]!, sy = L.sinYaw[k]!;
    const u = dx * cy - dz * sy;
    const s = u / L.length[k]! + 0.5;
    if (s <= 0 || s >= 1) return false;
    const v = dx * sy + dz * cy;
    const hw = leafHalfWidthFactor(s, this.config.terrain.leafTaper) * L.width[k]! * 0.5;
    if (Math.abs(v) >= hw) return false;
    this.loc[0] = s;
    this.loc[1] = v / hw;
    return true;
  }

  /** Top surface of leaf k at (x, z) (bilinear on the drape grid), or -Infinity. */
  leafTopOf(k: number, x: number, z: number): number {
    if (!this.leafLocal(k, x, z)) return -Infinity;
    const L = this.leaves;
    const fu = this.loc[0]! * L.nu, fv = ((this.loc[1]! + 1) / 2) * L.nv;
    const i = Math.min(L.nu - 1, Math.floor(fu)), j = Math.min(L.nv - 1, Math.floor(fv));
    const a = fu - i, b = fv - j;
    const base = k * (L.nu + 1) * (L.nv + 1);
    const h = (ii: number, jj: number): number => L.heights[base + ii * (L.nv + 1) + jj]!;
    const mid = (1 - a) * ((1 - b) * h(i, j) + b * h(i, j + 1)) + a * ((1 - b) * h(i + 1, j) + b * h(i + 1, j + 1));
    return mid + this.config.terrain.leafThickness / 2;
  }

  private readonly rng = new Int32Array(2);

  /** Highest leaf top at (x, z) among leaves with index < below (all when omitted). */
  leafTop(x: number, z: number, below = Infinity): number {
    let top = -Infinity;
    const r = this.rng, items = this.leafIndex.itemList;
    this.leafIndex.range(x, z, r);
    for (let q = r[0]!; q < r[1]!; q++) {
      const k = items[q]!;
      if (k >= below) continue;
      const y = this.leafTopOf(k, x, z);
      if (y > top) top = y;
    }
    return top;
  }

  leafCovers(x: number, z: number): boolean {
    const r = this.rng, items = this.leafIndex.itemList;
    this.leafIndex.range(x, z, r);
    for (let q = r[0]!; q < r[1]!; q++) if (this.leafLocal(items[q]!, x, z)) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // Grass (stored)

  private generateGrass(): GrassSet {
    const t = this.config.terrain;
    const rows: number[][] = [];
    let tufts = 0;
    const [c0, c1] = this.cellRange(t.grassCell);
    for (let iz = c0; iz <= c1; iz++) for (let ix = c0; ix <= c1; ix++) {
      const id = (Math.imul(ix, 0x8da6b343) ^ Math.imul(iz, 0xd8163841)) >>> 0;
      const r = (k: number, sub: number): number => rand(this.seed, Stream.TERRAIN_GRASS, id, sub, k);
      const x0 = ix * t.grassCell, z0 = iz * t.grassCell;
      const mc = this.inDomain(x0 + t.grassCell / 2, z0 + t.grassCell / 2) ? this.patch(Patch.GRASS, x0 + t.grassCell / 2, z0 + t.grassCell / 2) : 0;
      const n = poisson(t.tuftDensity * t.grassCell * t.grassCell * mc, r(K.COUNT, 0));
      for (let i = 1; i <= n; i++) {
        const tx = x0 + r(K.X, i) * t.grassCell, tz = z0 + r(K.Z, i) * t.grassCell;
        if (!this.inDomain(tx, tz) || r(K.ANGLE, i) > this.patch(Patch.GRASS, tx, tz)) continue;
        tufts++;
        const blades = Math.round(lerp(t.bladesPerTuft[0]!, t.bladesPerTuft[1]!, r(K.BLADES, i)));
        for (let b = 0; b < blades; b++) {
          const sub = i * 1024 + b + 1;
          const ang = r(K.ANGLE, sub) * TAU;
          const rad = Math.sqrt(r(K.RADIUS, sub)) * t.tuftRadius;
          const x = tx + rad * dcos(ang), z = tz + rad * dsin(ang);
          // Blades lean outward from the tuft centre, with scatter.
          const yaw = -ang + (r(K.YAW, sub) * 2 - 1) * t.bladeYawScatter;
          rows.push([x, this.supportHeight(x, z), z, yaw,
            lerp(t.bladeLean[0]!, t.bladeLean[1]!, r(K.LEAN, sub)),
            lerp(t.bladeDroop[0]!, t.bladeDroop[1]!, r(K.DROOP, sub)),
            lerp(t.bladeLength[0]!, t.bladeLength[1]!, r(K.LEN, sub)),
            lerp(t.bladeWidth[0]!, t.bladeWidth[1]!, r(K.WIDTH, sub)),
            r(K.COLOR, sub)]);
        }
      }
    }
    const col = (j: number): Float64Array => Float64Array.from(rows, (row) => row[j]!);
    const base = new Float64Array(rows.length * 3);
    rows.forEach((row, i) => { base[3 * i] = row[0]!; base[3 * i + 1] = row[1]!; base[3 * i + 2] = row[2]!; });
    return { blades: rows.length, base, yaw: col(3), lean: col(4), droop: col(5), length: col(6), width: col(7), tone: col(8), tufts };
  }

  /**
   * Centre line of blade i: writes (segments+1) points (x,y,z) into out.
   * The angle from vertical grows from `lean` at the base to lean+droop at the tip.
   */
  bladePoints(i: number, segments: number, out: Float64Array): void {
    const G = this.grass;
    const L = G.length[i]!, seg = L / segments;
    const fx = dcos(G.yaw[i]!), fz = -dsin(G.yaw[i]!);
    let x = G.base[3 * i]!, y = G.base[3 * i + 1]!, z = G.base[3 * i + 2]!;
    out[0] = x; out[1] = y; out[2] = z;
    for (let k = 0; k < segments; k++) {
      const sm = (k + 0.5) / segments;
      const th = G.lean[i]! + G.droop[i]! * sm * sm;
      const horiz = seg * dsin(th);
      x += horiz * fx; z += horiz * fz; y += seg * dcos(th);
      out[3 * (k + 1)] = x; out[3 * (k + 1) + 1] = y; out[3 * (k + 1) + 2] = z;
    }
  }

  // ---------------------------------------------------------------------------

  /** Height of whatever a foot would stand on at (x, z): soil, grain, pebble or leaf. */
  supportHeight(x: number, z: number): number {
    let y = this.groundHeight(x, z);
    if (!this.inDomain(x, z)) return y;
    const g = this.grainTop(x, z); if (g > y) y = g;
    const p = this.pebbleTop(x, z); if (p > y) y = p;
    const l = this.leafTop(x, z); if (l > y) y = l;
    return y;
  }

  private readonly span = new Float64Array(2);

  /**
   * Is (x, y, z) inside solid matter: below the soil, inside a grain or pebble,
   * or within a leaf's thickness? Unlike "below supportHeight", the space under
   * a curled leaf edge is open.
   */
  solidAt(x: number, y: number, z: number): boolean {
    if (y < this.groundHeight(x, z)) return true;
    if (!this.inDomain(x, z)) return false;
    const sp = this.span, rng = this.rng;
    const P = this.pebbles, pItems = this.pebbleIndex.itemList;
    this.pebbleIndex.range(x, z, rng);
    for (let q = rng[0]!; q < rng[1]!; q++) {
      const i = pItems[q]!;
      if (ellipsoidSpan(x, z, P.center[3 * i]!, P.center[3 * i + 1]!, P.center[3 * i + 2]!, P.inv, 9 * i, sp) && y >= sp[0]! && y <= sp[1]!) return true;
    }
    const t = this.config.terrain, cell = t.grainCell, rmax = t.grainSize[1]! / 2;
    for (let iz = Math.floor((z - rmax) / cell); iz <= Math.floor((z + rmax) / cell); iz++) {
      for (let ix = Math.floor((x - rmax) / cell); ix <= Math.floor((x + rmax) / cell); ix++) {
        const g = this.grainCell(ix, iz);
        for (let o = 0; o < g.length; o += GRAIN_STRIDE) {
          if (ellipsoidSpan(x, z, g[o]!, g[o + 1]!, g[o + 2]!, g, o + 9, sp) && y >= sp[0]! && y <= sp[1]!) return true;
        }
      }
    }
    const lItems = this.leafIndex.itemList;
    this.leafIndex.range(x, z, rng);
    const r0 = rng[0]!, r1 = rng[1]!;
    for (let q = r0; q < r1; q++) {
      const top = this.leafTopOf(lItems[q]!, x, z);
      if (top !== -Infinity && y <= top && y >= top - t.leafThickness) return true;
    }
    return false;
  }

  /** Hash of everything generated (for reproducibility checks). */
  digest(): number {
    const h = new StateHasher().word(this.seed);
    for (const th of this.thresholds) h.f64(th);
    const P = this.pebbles;
    h.word(P.count).view(P.center).view(P.radii).view(P.yaw).view(P.tilt);
    const L = this.leaves;
    h.word(L.count).view(L.cx).view(L.cz).view(L.yaw).view(L.length).view(L.heights);
    const G = this.grass;
    h.word(G.blades).view(G.base).view(G.yaw).view(G.length);
    const n = 32;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -this.half + ((i + 0.5) / n) * 2 * this.half, z = -this.half + ((j + 0.5) / n) * 2 * this.half;
      h.f64(this.supportHeight(x, z));
    }
    return h.digest();
  }
}

/** Standard deviation of gradNoise over an n×n lattice-spanning sample (deterministic). */
function measureNoiseStd(n: number): number {
  const s = newSample();
  let sum = 0, sum2 = 0;
  const salt = 0x5eed;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    // Irrational-ish steps so samples fall at varied positions within lattice cells.
    gradNoise(i * 0.618034 + 0.31, j * 0.754878 + 0.17, salt, s);
    sum += s.v; sum2 += s.v * s.v;
  }
  const m = sum / (n * n);
  return Math.sqrt(sum2 / (n * n) - m * m);
}

function packParticles(list: [Ellipsoid, number][]): ParticleSet {
  const n = list.length;
  const set: ParticleSet = {
    count: n,
    center: new Float64Array(3 * n), radii: new Float64Array(3 * n),
    yaw: new Float64Array(n), tilt: new Float64Array(n), inv: new Float64Array(9 * n),
    bound: new Float64Array(n), tone: new Float64Array(n),
  };
  list.forEach(([e, tone], i) => {
    set.center[3 * i] = e.cx; set.center[3 * i + 1] = e.cy; set.center[3 * i + 2] = e.cz;
    set.radii[3 * i] = e.a; set.radii[3 * i + 1] = e.b; set.radii[3 * i + 2] = e.c;
    set.yaw[i] = e.yaw; set.tilt[i] = e.tilt;
    ellipsoidInverse(e, set.inv, 9 * i);
    set.bound[i] = Math.max(e.a, e.b, e.c);
    set.tone[i] = tone;
  });
  return set;
}

export { gradNoise };
