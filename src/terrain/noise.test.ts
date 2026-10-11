import { describe, expect, it } from 'vitest';
import { bandWeight, fbmAdd, gradNoise, hurstAmplitudes, newSample, type FbmSpec } from './noise.ts';
import { NOISE_BOUND } from './terrain.ts';

const SALT = 0x1234;

describe('gradient noise', () => {
  it('is zero on lattice points and bounded by √2/2', () => {
    const s = newSample();
    for (let i = -5; i <= 5; i++) { gradNoise(i, -i, SALT, s); expect(s.v).toBe(0); }
    let max = 0;
    for (let k = 0; k < 20000; k++) { gradNoise(k * 0.0173 - 50, k * 0.0291 - 80, SALT, s); max = Math.max(max, Math.abs(s.v)); }
    expect(max).toBeLessThanOrEqual(NOISE_BOUND);
  });

  it('analytic derivatives match finite differences', () => {
    const s = newSample(), a = newSample(), b = newSample();
    const e = 1e-6;
    for (let k = 0; k < 2000; k++) {
      const x = k * 0.137 - 40, z = k * 0.071 + 13;
      gradNoise(x, z, SALT, s);
      gradNoise(x + e, z, SALT, a); gradNoise(x - e, z, SALT, b);
      expect(s.dx).toBeCloseTo((a.v - b.v) / (2 * e), 5);
      gradNoise(x, z + e, SALT, a); gradNoise(x, z - e, SALT, b);
      expect(s.dz).toBeCloseTo((a.v - b.v) / (2 * e), 5);
    }
  });

  it('is continuous across lattice cells', () => {
    const a = newSample(), b = newSample();
    for (let i = -3; i <= 3; i++) {
      gradNoise(i - 1e-9, 0.37, SALT, a); gradNoise(i + 1e-9, 0.37, SALT, b);
      expect(Math.abs(a.v - b.v)).toBeLessThan(1e-7);
    }
  });
});

describe('band limiting', () => {
  it('bandWeight: 0 at λ ≤ 2h, 1 at λ ≥ 4h, 1 for h = 0', () => {
    expect(bandWeight(2, 1)).toBe(0);
    expect(bandWeight(4, 1)).toBe(1);
    expect(bandWeight(3, 1)).toBeCloseTo(0.5, 12);
    expect(bandWeight(0.001, 0)).toBe(1);
  });

  it('fbm with h small enough equals full detail', () => {
    const spec: FbmSpec = { wavelength: 16, octaves: 5, lacunarity: 2, amps: hurstAmplitudes(16, 5, 2, 0.05, 0.6), salts: [1, 2, 3, 4, 5] };
    const a = newSample(), b = newSample();
    fbmAdd(3.3, -7.1, spec, 0, a);
    fbmAdd(3.3, -7.1, spec, 0.25, b); // shortest λ = 1 = 4h
    expect(b.v).toBe(a.v);
  });

  it('hurst amplitudes: hurst 1 keeps amplitude/wavelength constant, hurst < 1 is rougher at small scales', () => {
    const self = hurstAmplitudes(16, 5, 2, 0.05, 1);
    self.forEach((amp, i) => expect(amp / (16 / 2 ** i)).toBeCloseTo(0.05, 12));
    const rough = hurstAmplitudes(16, 5, 2, 0.05, 0.6);
    expect(rough[4]! / 1).toBeGreaterThan(self[4]! / 1);
  });
});
