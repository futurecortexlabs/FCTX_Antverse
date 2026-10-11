/**
 * Deterministic 2D gradient noise with analytic derivatives, and band-limited
 * fractal sums. Integer hashing + IEEE arithmetic only (see core/dmath.ts),
 * so the sim worker, the renderer and Node tests evaluate identical terrain.
 */

import { dcos, dpow, dsin, TAU } from '../core/dmath.ts';
import { mix32 } from '../core/rng.ts';

const GRAD_COUNT = 16;
const GX = new Float64Array(GRAD_COUNT);
const GZ = new Float64Array(GRAD_COUNT);
for (let i = 0; i < GRAD_COUNT; i++) {
  GX[i] = dcos((TAU * i) / GRAD_COUNT);
  GZ[i] = dsin((TAU * i) / GRAD_COUNT);
}
const GRAD_MASK = GRAD_COUNT - 1;
const PX = 0x27d4eb2d;
const PZ = 0x165667b1;

/** Result holder: value and partial derivatives. Reused to avoid allocation. */
export interface Sample {
  v: number;
  dx: number;
  dz: number;
}

export const newSample = (): Sample => ({ v: 0, dx: 0, dz: 0 });

function gidx(ix: number, iz: number, salt: number): number {
  return mix32((Math.imul(ix, PX) ^ Math.imul(iz, PZ) ^ salt) >>> 0) & GRAD_MASK;
}

/**
 * Gradient noise at (x, z) in lattice units, quintic fade (C2-continuous).
 * Writes value (≈[-0.7, 0.7]) and derivatives into `out`.
 */
export function gradNoise(x: number, z: number, salt: number, out: Sample): void {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = x - x0, fz = z - z0;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const du = 30 * fx * fx * (fx * (fx - 2) + 1);
  const dv = 30 * fz * fz * (fz * (fz - 2) + 1);
  const g00 = gidx(x0, z0, salt), g10 = gidx(x0 + 1, z0, salt);
  const g01 = gidx(x0, z0 + 1, salt), g11 = gidx(x0 + 1, z0 + 1, salt);
  const ax = GX[g00]!, az = GZ[g00]!, bx = GX[g10]!, bz = GZ[g10]!;
  const cx = GX[g01]!, cz = GZ[g01]!, ex = GX[g11]!, ez = GZ[g11]!;
  const n00 = ax * fx + az * fz;
  const n10 = bx * (fx - 1) + bz * fz;
  const n01 = cx * fx + cz * (fz - 1);
  const n11 = ex * (fx - 1) + ez * (fz - 1);
  const k1 = n10 - n00, k2 = n01 - n00, k3 = n00 - n10 - n01 + n11;
  out.v = n00 + u * k1 + v * k2 + u * v * k3;
  out.dx = ax + u * (bx - ax) + v * (cx - ax) + u * v * (ax - bx - cx + ex) + du * (k1 + k3 * v);
  out.dz = az + u * (bz - az) + v * (cz - az) + u * v * (az - bz - cz + ez) + dv * (k2 + k3 * u);
}

/**
 * Weight of an octave of wavelength `lambda` when sampled with spacing `h`:
 * 1 when lambda >= 4h, 0 when lambda <= 2h, smooth in between. h = 0 means
 * "full detail" (simulation queries). Removing sub-Nyquist octaves is what
 * keeps distant terrain from shimmering.
 */
export function bandWeight(lambda: number, h: number): number {
  if (h <= 0) return 1;
  const t = (lambda / h - 2) * 0.5;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

export interface FbmSpec {
  /** Longest wavelength (mm). */
  wavelength: number;
  octaves: number;
  /** Wavelength ratio between consecutive octaves (> 1). */
  lacunarity: number;
  /** Amplitude of each octave (mm). */
  amps: readonly number[];
  /** Per-octave hash salts. */
  salts: readonly number[];
}

/**
 * Octave amplitudes for a relief whose amplitude scales as λ^hurst:
 * amp_i = slope × λ0 × (λ_i/λ0)^hurst. hurst = 1 is self-similar (constant
 * slope); hurst < 1 is rougher at small scales, as natural soil surfaces are.
 */
export function hurstAmplitudes(wavelength: number, octaves: number, lacunarity: number, slope: number, hurst: number): number[] {
  const amps: number[] = [];
  let lambda = wavelength;
  for (let i = 0; i < octaves; i++) {
    amps.push(slope * wavelength * dpow(lambda / wavelength, hurst));
    lambda /= lacunarity;
  }
  return amps;
}

const tmp = newSample();

/** Band-limited fractal sum; accumulates into `out` (caller zeroes it). */
export function fbmAdd(x: number, z: number, spec: FbmSpec, h: number, out: Sample): void {
  let lambda = spec.wavelength;
  for (let i = 0; i < spec.octaves; i++) {
    const w = bandWeight(lambda, h);
    if (w === 0) break; // later octaves are shorter still
    const inv = 1 / lambda;
    gradNoise(x * inv, z * inv, spec.salts[i]!, tmp);
    const amp = spec.amps[i]! * w;
    out.v += amp * tmp.v;
    out.dx += amp * inv * tmp.dx;
    out.dz += amp * inv * tmp.dz;
    lambda /= spec.lacunarity;
  }
}

/** Shortest wavelength of a spec. */
export function minWavelength(spec: FbmSpec): number {
  let l = spec.wavelength;
  for (let i = 1; i < spec.octaves; i++) l /= spec.lacunarity;
  return l;
}
