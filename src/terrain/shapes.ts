/**
 * Geometry shared by simulation queries and rendering, so both see the same
 * surface: resting ellipsoids (pebbles, sand grains), sampling helpers.
 */

import { dcos, dexp, dpow, dsin } from '../core/dmath.ts';

/**
 * Orientation convention (matches three.js Euler order 'YXZ' with x = tilt,
 * y = yaw): R = Ry(yaw) · Rx(tilt). Local axes: X = long radius a,
 * Y = short radius c (near vertical: particles rest flat), Z = middle radius b.
 */
export interface Ellipsoid {
  cx: number; cy: number; cz: number;
  a: number; b: number; c: number;
  yaw: number; tilt: number;
}

/** Inverse transform rows A = S⁻¹ Rᵀ, 9 numbers, for vertical-ray queries. */
export function ellipsoidInverse(e: Ellipsoid, out: Float64Array | Float32Array, o: number): void {
  const cy = dcos(e.yaw), sy = dsin(e.yaw), ct = dcos(e.tilt), st = dsin(e.tilt);
  // Columns of R: local X, local Y, local Z expressed in world space.
  const xX = cy, xY = 0, xZ = -sy;
  const yX = sy * st, yY = ct, yZ = cy * st;
  const zX = sy * ct, zY = -st, zZ = cy * ct;
  out[o] = xX / e.a; out[o + 1] = xY / e.a; out[o + 2] = xZ / e.a;
  out[o + 3] = yX / e.c; out[o + 4] = yY / e.c; out[o + 5] = yZ / e.c;
  out[o + 6] = zX / e.b; out[o + 7] = zY / e.b; out[o + 8] = zZ / e.b;
}

/** Half of the vertical extent of the ellipsoid. */
export function ellipsoidHalfHeight(e: Ellipsoid): number {
  const ct = dcos(e.tilt), st = dsin(e.tilt);
  return Math.sqrt((ct * e.c) * (ct * e.c) + (st * e.b) * (st * e.b));
}

/**
 * Top surface height of an ellipsoid along the vertical line through (x, z),
 * or -Infinity if the line misses it. `A` = ellipsoidInverse rows at offset o.
 */
export function ellipsoidTop(
  x: number, z: number,
  cx: number, cy: number, cz: number,
  A: Float64Array | Float32Array, o: number,
): number {
  const dx = x - cx, dz = z - cz;
  // q(t) = q0 + t * a1, with q0 = A·(dx,0,dz), a1 = A·(0,1,0)
  const q0x = A[o]! * dx + A[o + 2]! * dz;
  const q0y = A[o + 3]! * dx + A[o + 5]! * dz;
  const q0z = A[o + 6]! * dx + A[o + 8]! * dz;
  const a1x = A[o + 1]!, a1y = A[o + 4]!, a1z = A[o + 7]!;
  const qa = a1x * a1x + a1y * a1y + a1z * a1z;
  const qb = q0x * a1x + q0y * a1y + q0z * a1z;
  const qc = q0x * q0x + q0y * q0y + q0z * q0z - 1;
  const disc = qb * qb - qa * qc;
  if (disc < 0) return -Infinity;
  return cy + (-qb + Math.sqrt(disc)) / qa;
}

/**
 * Vertical interval [lo, hi] of an ellipsoid along the line through (x, z),
 * written to out; returns false if the line misses it.
 */
export function ellipsoidSpan(
  x: number, z: number,
  cx: number, cy: number, cz: number,
  A: Float64Array | Float32Array, o: number, out: Float64Array,
): boolean {
  const dx = x - cx, dz = z - cz;
  const q0x = A[o]! * dx + A[o + 2]! * dz;
  const q0y = A[o + 3]! * dx + A[o + 5]! * dz;
  const q0z = A[o + 6]! * dx + A[o + 8]! * dz;
  const a1x = A[o + 1]!, a1y = A[o + 4]!, a1z = A[o + 7]!;
  const qa = a1x * a1x + a1y * a1y + a1z * a1z;
  const qb = q0x * a1x + q0y * a1y + q0z * a1z;
  const qc = q0x * q0x + q0y * q0y + q0z * q0z - 1;
  const disc = qb * qb - qa * qc;
  if (disc < 0) return false;
  const r = Math.sqrt(disc);
  out[0] = cy + (-qb - r) / qa;
  out[1] = cy + (-qb + r) / qa;
  return true;
}

/** Sample from a truncated power law with cumulative N(>d) ∝ d^-k on [lo, hi]. */
export function powerLawSize(u: number, lo: number, hi: number, k: number): number {
  const a = dpow(lo, -k), b = dpow(hi, -k);
  return dpow(a - u * (a - b), -1 / k);
}

/** Poisson-distributed count with mean m from a uniform u (inverse CDF). */
export function poisson(m: number, u: number): number {
  if (m <= 0) return 0;
  let p = dexp(-m);
  let cdf = p;
  let k = 0;
  while (u > cdf && k < 1000) {
    k++;
    p *= m / k;
    cdf += p;
  }
  return k;
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
