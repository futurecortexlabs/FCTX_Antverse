/**
 * Deterministic math.
 *
 * ECMAScript fixes +,-,*,/ and Math.sqrt to IEEE-754 correctly rounded
 * results, but leaves Math.sin/cos/exp/log/atan2/pow "implementation-
 * approximated" — they can differ between browsers. Simulation code
 * (src/core, src/sim) must use these functions instead so that a given
 * seed produces bit-identical state on every engine.
 * An architecture test forbids the non-deterministic Math.* functions there.
 *
 * Accuracy target: |error| < 1e-13 relative over the working ranges
 * (verified in dmath.test.ts against Math.*).
 */

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

// ---------------------------------------------------------------------------
// Bit helpers for exact scaling by powers of two.
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
// Little-endian is universal on every platform that runs a browser engine;
// detect anyway so the code is correct on big-endian hosts.
const LO = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 0 : 1;
const HI = 1 - LO;

/** Exactly 2^k for integer k in [-1022, 1023]. */
function pow2(k: number): number {
  u32[LO] = 0;
  u32[HI] = ((k + 1023) << 20) >>> 0;
  return f64[0]!;
}

/** x * 2^k, exact unless the result over/underflows. */
export function ldexp(x: number, k: number): number {
  while (k > 1023) { x *= pow2(1023); k -= 1023; }
  while (k < -1022) { x *= pow2(-1022); k += 1022; }
  return x * pow2(k);
}

// ---------------------------------------------------------------------------
// sin / cos — Cody–Waite reduction by pi/2 (fdlibm constants) + Taylor kernels.
const INV_PIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_3 = 2.02226624871116645580e-21;

const S1 = -1 / 6, S2 = 1 / 120, S3 = -1 / 5040, S4 = 1 / 362880;
const S5 = -1 / 39916800, S6 = 1 / 6227020800, S7 = -1 / 1307674368000;
const C1 = -1 / 2, C2 = 1 / 24, C3 = -1 / 720, C4 = 1 / 40320;
const C5 = -1 / 3628800, C6 = 1 / 479001600, C7 = -1 / 87178291200, C8 = 1 / 20922789888000;

function kSin(r: number): number {
  const s = r * r;
  return r + r * s * (S1 + s * (S2 + s * (S3 + s * (S4 + s * (S5 + s * (S6 + s * S7))))));
}
function kCos(r: number): number {
  const s = r * r;
  return 1 + s * (C1 + s * (C2 + s * (C3 + s * (C4 + s * (C5 + s * (C6 + s * (C7 + s * C8)))))));
}

/** Reduce x to r in [-pi/4, pi/4]; returns quadrant in 0..3 via `quadrant`. */
let quadrant = 0;
function reduce(x: number): number {
  const n = Math.round(x * INV_PIO2);
  quadrant = ((n % 4) + 4) % 4;
  return ((x - n * PIO2_1) - n * PIO2_2) - n * PIO2_3;
}

export function dsin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const r = reduce(x);
  switch (quadrant) {
    case 0: return kSin(r);
    case 1: return kCos(r);
    case 2: return -kSin(r);
    default: return -kCos(r);
  }
}

export function dcos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const r = reduce(x);
  switch (quadrant) {
    case 0: return kCos(r);
    case 1: return -kSin(r);
    case 2: return -kCos(r);
    default: return kSin(r);
  }
}

// ---------------------------------------------------------------------------
// atan / atan2 — two argument halvings (|t| <= tan(pi/16)) + odd series.
const A_TERMS = 11; // up to t^23: 0.199^23/23 < 1e-17
const A_COEF: number[] = [];
for (let i = 0; i <= A_TERMS; i++) A_COEF.push((i % 2 === 0 ? 1 : -1) / (2 * i + 1));

function atanKernel(x: number): number {
  // |x| <= 1
  let t = x / (1 + Math.sqrt(1 + x * x));
  t = t / (1 + Math.sqrt(1 + t * t));
  const s = t * t;
  let p = A_COEF[A_TERMS]!;
  for (let i = A_TERMS - 1; i >= 0; i--) p = A_COEF[i]! + s * p;
  return 4 * t * p;
}

export function datan(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const a = Math.abs(x);
  if (a <= 1) return atanKernel(x);
  const r = HALF_PI - atanKernel(1 / a);
  return x < 0 ? -r : r;
}

export function datan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

// ---------------------------------------------------------------------------
// exp — reduction by ln2 (fdlibm split) + Taylor to r^14.
const LN2_HI = 6.93147180369123816490e-01;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700e+00;
const EXP_OVERFLOW = 709.782712893384;
const EXP_UNDERFLOW = -745.1332191019411;
const E_TERMS = 14;
const E_COEF: number[] = [1];
for (let i = 1; i <= E_TERMS; i++) E_COEF.push(E_COEF[i - 1]! / i);

export function dexp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > EXP_OVERFLOW) return Infinity;
  if (x < EXP_UNDERFLOW) return 0;
  const k = Math.round(x * INV_LN2);
  const r = (x - k * LN2_HI) - k * LN2_LO;
  let p = E_COEF[E_TERMS]!;
  for (let i = E_TERMS - 1; i >= 0; i--) p = E_COEF[i]! + r * p;
  return ldexp(p, k);
}

// ---------------------------------------------------------------------------
// log — split mantissa/exponent from the bits, then 2*atanh(s) series.
const SQRT2 = 1.4142135623730951;
const TWO54 = 18014398509481984;
const L_TERMS = 10; // up to s^21: 0.1716^21 < 1e-16
const L_COEF: number[] = [];
for (let i = 0; i <= L_TERMS; i++) L_COEF.push(2 / (2 * i + 1));

export function dlog(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let e = 0;
  if (x < 2.2250738585072014e-308) { x *= TWO54; e -= 54; } // subnormal
  f64[0] = x;
  const hi = u32[HI]!;
  e += ((hi >>> 20) & 0x7ff) - 1023;
  u32[HI] = (hi & 0x000fffff) | 0x3ff00000; // exponent 0 -> m in [1,2)
  let m = f64[0]!;
  if (m > SQRT2) { m *= 0.5; e += 1; }
  const s = (m - 1) / (m + 1);
  const z = s * s;
  let p = L_COEF[L_TERMS]!;
  for (let i = L_TERMS - 1; i >= 0; i--) p = L_COEF[i]! + z * p;
  return e * LN2_HI + (e * LN2_LO + s * p);
}

// ---------------------------------------------------------------------------
// Helpers

/** Wrap an angle to [-pi, pi). */
export function wrapAngle(a: number): number {
  return a - TAU * Math.floor((a + PI) / TAU);
}
