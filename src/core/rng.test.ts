import { describe, expect, it } from 'vitest';
import { hashKey, rand, randNormal, Stream } from './rng.ts';

const SEED = 12345;
const N = 200000;

describe('counter-based rng', () => {
  it('is a pure function of its key', () => {
    expect(rand(SEED, Stream.TEST, 7, 99, 3)).toBe(rand(SEED, Stream.TEST, 7, 99, 3));
  });

  it('does not depend on evaluation order', () => {
    const forward = Array.from({ length: 100 }, (_, i) => rand(SEED, Stream.TEST, i, 5));
    const backward = Array.from({ length: 100 }, (_, i) => rand(SEED, Stream.TEST, 99 - i, 5)).reverse();
    expect(forward).toEqual(backward);
  });

  it('changes when any key component changes', () => {
    const base = hashKey(SEED, 1, 2, 3, 4);
    expect(hashKey(SEED + 1, 1, 2, 3, 4)).not.toBe(base);
    expect(hashKey(SEED, 2, 2, 3, 4)).not.toBe(base);
    expect(hashKey(SEED, 1, 3, 3, 4)).not.toBe(base);
    expect(hashKey(SEED, 1, 2, 4, 4)).not.toBe(base);
    expect(hashKey(SEED, 1, 2, 3, 5)).not.toBe(base);
  });

  it('is uniform on [0,1) (chi-square, 20 bins)', () => {
    const bins = 20;
    const counts = new Array<number>(bins).fill(0);
    for (let i = 0; i < N; i++) {
      const u = rand(SEED, Stream.TEST, i, 0);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      counts[Math.floor(u * bins)]!++;
    }
    const expected = N / bins;
    const chi2 = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(43.8); // df=19, p=0.001
  });

  it('consecutive ticks are uncorrelated (lag-1 correlation ~ 0)', () => {
    let sxy = 0, sx = 0, sxx = 0;
    let prev = rand(SEED, Stream.TEST, 1, 0);
    for (let t = 1; t < N; t++) {
      const u = rand(SEED, Stream.TEST, 1, t);
      sxy += prev * u; sx += u; sxx += u * u;
      prev = u;
    }
    const n = N - 1;
    const mean = sx / n;
    const corr = (sxy / n - mean * mean) / (sxx / n - mean * mean);
    expect(Math.abs(corr)).toBeLessThan(0.01);
  });

  it('normal draws have mean 0 and variance 1', () => {
    let s = 0, ss = 0;
    for (let i = 0; i < N; i++) {
      const z = randNormal(SEED, Stream.TEST, i, 0);
      s += z; ss += z * z;
    }
    const mean = s / N;
    expect(Math.abs(mean)).toBeLessThan(0.01);
    expect(Math.abs(ss / N - mean * mean - 1)).toBeLessThan(0.02);
  });

  it('golden values are stable (guards against accidental algorithm changes)', () => {
    expect([hashKey(0, 0, 0, 0, 0), hashKey(1, 2, 3, 4, 5), hashKey(0xffffffff, 1, 0, 0xffffffff, 7)]).toMatchSnapshot();
  });
});
