import { describe, expect, it } from 'vitest';
import { datan, datan2, dcos, dexp, dlog, dsin, ldexp, PI, wrapAngle } from './dmath.ts';

const TOL = 1e-13;
const relErr = (a: number, b: number): number => Math.abs(a - b) / Math.max(1, Math.abs(b));

function sweep(lo: number, hi: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

describe('dmath accuracy vs Math.*', () => {
  it('sin / cos on [-1000, 1000]', () => {
    for (const x of sweep(-1000, 1000, 100001)) {
      expect(relErr(dsin(x), Math.sin(x))).toBeLessThan(TOL);
      expect(relErr(dcos(x), Math.cos(x))).toBeLessThan(TOL);
    }
  });

  it('atan / atan2 over all quadrants', () => {
    for (const x of sweep(-50, 50, 20001)) expect(relErr(datan(x), Math.atan(x))).toBeLessThan(TOL);
    for (const a of sweep(-PI, PI, 3601)) {
      for (const r of [1e-6, 1, 1e6]) {
        const y = r * Math.sin(a), x = r * Math.cos(a);
        expect(relErr(datan2(y, x), Math.atan2(y, x))).toBeLessThan(TOL);
      }
    }
    expect(datan2(0, 0)).toBe(0);
    expect(datan2(1, 0)).toBe(PI / 2);
    expect(datan2(-1, 0)).toBe(-PI / 2);
  });

  it('exp on [-700, 700] (relative)', () => {
    for (const x of sweep(-700, 700, 70001)) {
      const e = Math.exp(x);
      expect(Math.abs(dexp(x) - e) / e).toBeLessThan(TOL);
    }
    expect(dexp(0)).toBe(1);
    expect(dexp(800)).toBe(Infinity);
    expect(dexp(-800)).toBe(0);
  });

  it('log over many decades including subnormals', () => {
    for (let k = -1074; k <= 1023; k += 1) {
      for (const m of [1, 1.3, 1.7, 1.999]) {
        const x = ldexp(m, k);
        if (x === 0 || !Number.isFinite(x)) continue;
        expect(Math.abs(dlog(x) - Math.log(x))).toBeLessThan(TOL * Math.max(1, Math.abs(Math.log(x))));
      }
    }
    expect(dlog(1)).toBe(0);
    expect(dlog(0)).toBe(-Infinity);
    expect(Number.isNaN(dlog(-1))).toBe(true);
  });

  it('ldexp is exact', () => {
    expect(ldexp(1, 10)).toBe(1024);
    expect(ldexp(3, -2)).toBe(0.75);
    expect(ldexp(1, -1074)).toBe(Number.MIN_VALUE);
  });

  it('wrapAngle maps to [-pi, pi)', () => {
    for (const a of sweep(-100, 100, 10001)) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThanOrEqual(-PI);
      expect(w).toBeLessThan(PI);
      expect(Math.abs(dsin(w) - dsin(a))).toBeLessThan(1e-12);
    }
  });

  it('golden bit patterns are stable (cross-engine reproducibility contract)', () => {
    const xs = [0.1, 1, 2.5, -3.7, 123.456];
    const bits = (v: number): string => {
      const b = new DataView(new ArrayBuffer(8));
      b.setFloat64(0, v);
      return b.getBigUint64(0).toString(16);
    };
    expect(xs.map((x) => [dsin(x), dcos(x), dexp(x / 10), dlog(Math.abs(x)), datan2(x, 1.5)].map(bits))).toMatchSnapshot();
  });
});
