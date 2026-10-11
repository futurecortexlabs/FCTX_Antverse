/**
 * Reproduction tests for the pheromone field (ARCHITECTURE §4.2;
 * BIO-PHE-002 evaporation, ASM-PHE-001 diffusion).
 */

import { describe, expect, it } from 'vitest';
import { dexp } from '../../core/dmath.ts';
import { PheromoneField, type FieldSpec } from './field.ts';

const spec = (o: Partial<FieldSpec> = {}): FieldSpec => ({
  x0: 0, z0: 0, width: 100, depth: 100, cell: 1, lifetime: 60, diffusion: 0, dt: 0.1, epsilon: 1e-6, ...o,
});

describe('pheromone field', () => {
  it('evaporates exponentially with the configured mean lifetime', () => {
    const f = new PheromoneField(spec());
    f.deposit(50, 50, 10);
    const steps = 600; // 60 s = one lifetime
    for (let k = 0; k < steps; k++) f.step();
    expect(f.sample(50, 50)).toBeCloseTo(10 * dexp(-1), 3);
  });

  it('diffusion spreads pheromone but conserves it (no evaporation)', () => {
    const f = new PheromoneField(spec({ lifetime: 1e12, diffusion: 0.5 }));
    f.deposit(50, 50, 100);
    const before = f.total();
    for (let k = 0; k < 500; k++) f.step();
    expect(f.total()).toBeCloseTo(before, 2);
    expect(f.sample(50, 50)).toBeLessThan(100);
    expect(f.sample(53, 50)).toBeGreaterThan(0);
    // Symmetric spread.
    expect(f.sample(53, 50)).toBeCloseTo(f.sample(47, 50), 6);
    expect(f.sample(50, 53)).toBeCloseTo(f.sample(50, 47), 6);
  });

  it('diffusion matches the Gaussian variance 2·D·t per axis', () => {
    const D = 0.5, steps = 400, dt = 0.1;
    // No idle threshold here: clearing faint fringe tiles would trim the tails.
    const f = new PheromoneField(spec({ lifetime: 1e12, diffusion: D, dt, epsilon: 0 }));
    f.deposit(50, 50, 1);
    for (let k = 0; k < steps; k++) f.step();
    let m = 0, v = 0;
    for (let i = 0; i < f.nx; i++) for (let j = 0; j < f.nz; j++) {
      const c = f.data[j * f.nx + i]!;
      m += c; v += c * (i - 50) * (i - 50);
    }
    expect(v / m).toBeCloseTo(2 * D * steps * dt, 1);
  });

  it('deposit then sample at the same point returns the amount at a cell node, bilinear in between', () => {
    const f = new PheromoneField(spec());
    f.deposit(10, 10, 4);
    expect(f.sample(10, 10)).toBeCloseTo(4, 6);
    f.deposit(20.5, 20, 4); // split over two nodes
    expect(f.sample(20, 20)).toBeCloseTo(2, 6);
    expect(f.sample(21, 20)).toBeCloseTo(2, 6);
    expect(f.sample(20.5, 20)).toBeCloseTo(2, 6);
    expect(f.sample(-5, 10)).toBe(0); // outside
  });

  it('only tiles with pheromone are updated; empty tiles go idle and are cleared', () => {
    const f = new PheromoneField(spec({ lifetime: 1, epsilon: 1e-3 }));
    expect(f.activeTiles()).toBe(0);
    f.deposit(10, 10, 1);
    expect(f.activeTiles()).toBe(1);
    for (let k = 0; k < 200; k++) f.step(); // 20 lifetimes
    expect(f.activeTiles()).toBe(0);
    expect(f.total()).toBe(0);
  });

  it('refuses an unstable diffusion step', () => {
    expect(() => new PheromoneField(spec({ diffusion: 10, dt: 0.1 }))).toThrow(/unstable/);
  });
});
