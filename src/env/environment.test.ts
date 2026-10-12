/**
 * Reproduction tests for the environment model (PHY-ENV-001/002,
 * BIO-ENV-001, ASM-ENV-001/002).
 */

import { describe, expect, it } from 'vitest';
import { buildConfig, type Overlay } from '../config/load.ts';
import { Environment, type Sun } from './environment.ts';

const make = (env: Overlay['env'] = {}): Environment => new Environment(buildConfig([{ env: { enabled: true, ...(env as object) } }]).config);
const H = 3600;
const sun: Sun = { elevation: 0, azimuth: 0, x: 0, y: 0, z: 0 };
const deg = (r: number): number => (r * 180) / Math.PI;

describe('sun', () => {
  it('at the June solstice in Tokyo the noon sun stands about 78° high, in the south', () => {
    const e = make({ dayOfYear: 172, startHour: 0 });
    e.sun(12 * H, sun);
    expect(deg(sun.elevation)).toBeCloseTo(90 - 35.7 + 23.44, 0);
    expect(deg(sun.azimuth)).toBeCloseTo(180, 0);
    expect(sun.z).toBeGreaterThan(0); // south is +Z (north is −Z)
    expect(Math.hypot(sun.x, sun.y, sun.z)).toBeCloseTo(1, 9);
  });

  it('rises in the east, sets in the west; dark at midnight, dim at twilight', () => {
    const e = make({ dayOfYear: 200, startHour: 0 });
    e.sun(7 * H, sun);
    expect(sun.x).toBeGreaterThan(0);
    e.sun(17 * H, sun);
    expect(sun.x).toBeLessThan(0);
    expect(e.light(0)).toBe(0);
    expect(e.light(12 * H)).toBeGreaterThan(0.9);
    // Sunrise near 4:45 solar time in July at 35.7° N: dim before, bright an hour later.
    expect(e.light(4.5 * H)).toBeLessThan(0.02);
    expect(e.light(6 * H)).toBeGreaterThan(0.15);
  });
});

describe('temperature', () => {
  it('the surface is warmest at peakHour; in the soil the wave is damped by e^(−z/D) and delayed', () => {
    const e = make({ startHour: 0, meanTemp: 20, surfaceAmplitude: 10, peakHour: 14, dampingDepth: 100 });
    expect(e.surfaceTemp(14 * H)).toBeCloseTo(30, 9);
    expect(e.surfaceTemp(2 * H)).toBeCloseTo(10, 9);
    let hi = -Infinity, lo = Infinity, at = 0;
    for (let t = 0; t < 24 * H; t += 60) {
      const T = e.soilTemp(100, t);
      if (T > hi) { hi = T; at = t; }
      lo = Math.min(lo, T);
    }
    expect((hi - lo) / 2).toBeCloseTo(10 * Math.exp(-1), 2);
    // One radian of a day is about 3.8 h: the maximum at 100 mm comes near 17:50.
    expect(at / H).toBeCloseTo(14 + 24 / (2 * Math.PI), 1);
  });

  it('rates double per 10 °C up to the optimum, fall above it, and stop outside the critical limits', () => {
    const e = make();
    expect(e.rate(25)).toBeCloseTo(1, 12);
    expect(e.rate(35)).toBeCloseTo(2, 12);
    expect(e.rate(15)).toBeCloseTo(0.5, 12);
    expect(e.rate(40)).toBeCloseTo(1, 12);
    expect(e.rate(46)).toBe(0.02);
    expect(e.rate(4)).toBe(0.02);
  });

  it('switched off: constant noon at the reference temperature', () => {
    const e = new Environment(buildConfig([]).config);
    expect(e.light(0)).toBe(1);
    expect(e.soilTemp(50, 1234)).toBe(25);
    expect(e.rate(10)).toBe(1);
  });
});
