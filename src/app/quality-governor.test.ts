import { describe, expect, it } from 'vitest';
import { buildConfig } from '../config/load.ts';
import { QualityGovernor } from './quality-governor.ts';

const { config } = buildConfig([{ quality: { auto: true } }]);
const q = config.quality;
const BASE = { pixelRatio: 1.25, maxScreenError: 3 };

/** Run `seconds` of frames at a fixed frame interval / CPU / GPU time; returns actions taken. */
function run(g: QualityGovernor, t0: number, seconds: number, frameMs: number, cpuMs: number, gpuMs: number | null = null): { t: number; actions: string[] } {
  const actions: string[] = [];
  let t = t0;
  for (; t < t0 + seconds * 1000; t += frameMs) {
    const a = g.sample(t, frameMs, cpuMs, gpuMs);
    if (a) actions.push(a);
  }
  return { t, actions };
}

describe('QualityGovernor', () => {
  it('does nothing while the frame rate is above the floor', () => {
    const g = new QualityGovernor(BASE, q);
    expect(run(g, 0, 30, 16.7, 10).actions).toEqual([]);
    expect(g.knobs).toEqual(BASE);
  });

  it('GPU-bound or unknown: lowers resolution first, then terrain detail, down to the limits', () => {
    const g = new QualityGovernor(BASE, q);
    const { actions } = run(g, 0, 120, 60, 55);
    expect(actions.every((a) => a === 'down')).toBe(true);
    expect(g.knobs.pixelRatio).toBeCloseTo(q.minPixelRatio, 9);
    expect(g.knobs.maxScreenError).toBeCloseTo(q.maxScreenErrorCeil, 9);
    // Resolution was exhausted before detail started to drop.
    const g2 = new QualityGovernor(BASE, q);
    run(g2, 0, q.window * 2.5, 60, 55);
    expect(g2.knobs.maxScreenError).toBe(BASE.maxScreenError);
    expect(g2.knobs.pixelRatio).toBeLessThan(BASE.pixelRatio);
  });

  it('CPU-bound (GPU time below CPU time): lowers terrain detail first', () => {
    const g = new QualityGovernor(BASE, q);
    run(g, 0, q.window * 2.5, 60, 50, 5);
    expect(g.knobs.pixelRatio).toBe(BASE.pixelRatio);
    expect(g.knobs.maxScreenError).toBeGreaterThan(BASE.maxScreenError);
    run(g, 100000, 120, 60, 50, 5);
    expect(g.knobs.maxScreenError).toBeCloseTo(q.maxScreenErrorCeil, 9);
    expect(g.knobs.pixelRatio).toBeCloseTo(q.minPixelRatio, 9);
  });

  it('restores quality when the load goes away, never above the tier settings', () => {
    const g = new QualityGovernor(BASE, q);
    const slow = run(g, 0, 60, 60, 55);
    expect(g.degraded()).toBe(true);
    run(g, slow.t, 300, 16.7, 4);
    expect(g.knobs.pixelRatio).toBeCloseTo(BASE.pixelRatio, 9);
    expect(g.knobs.maxScreenError).toBeCloseTo(BASE.maxScreenError, 9);
    expect(g.degraded()).toBe(false);
  });

  it('does not restore while frame work is still heavy (no oscillation)', () => {
    const g = new QualityGovernor(BASE, q);
    const slow = run(g, 0, 10, 60, 55);
    expect(g.degraded()).toBe(true);
    // Frames are fast enough but the work is close to the budget: never step back up.
    const hold = run(g, slow.t, 60, 25, 20);
    expect(hold.actions).not.toContain('up');
    expect(g.degraded()).toBe(true);
  });
});
