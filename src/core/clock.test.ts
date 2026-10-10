import { describe, expect, it } from 'vitest';
import { FixedStepClock } from './clock.ts';

const DT = 1 / 60;

function runFrames(clock: FixedStepClock, frames: number[]): number {
  let steps = 0;
  for (const f of frames) {
    clock.advance(f);
    while (clock.consumeStep()) { clock.completeStep(); steps++; }
  }
  return steps;
}

/** Deterministic pseudo-random frame times in [lo, hi] summing to `total` seconds. */
function irregularFrames(total: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  let sum = 0, x = 0.5;
  while (sum < total) {
    x = (x * 9301 + 49297) % 233280 / 233280;
    const f = Math.min(lo + (hi - lo) * x, total - sum);
    out.push(f);
    sum += f;
  }
  return out;
}

describe('FixedStepClock', () => {
  const SECONDS = 10;
  const expected = Math.floor(SECONDS / DT);

  it.each([
    ['30 fps', Array.from({ length: SECONDS * 30 }, () => 1 / 30)],
    ['60 fps', Array.from({ length: SECONDS * 60 }, () => 1 / 60)],
    ['144 fps', Array.from({ length: SECONDS * 144 }, () => 1 / 144)],
    ['irregular 2–50 ms', irregularFrames(SECONDS, 0.002, 0.05)],
  ])('produces the same step count regardless of frame rate (%s)', (_, frames) => {
    const steps = runFrames(new FixedStepClock(DT), frames);
    expect(Math.abs(steps - expected)).toBeLessThanOrEqual(1);
  });

  it('timeScale multiplies simulated time (fast-forward and slow motion)', () => {
    for (const scale of [0.25, 4, 64]) {
      const c = new FixedStepClock(DT);
      c.timeScale = scale;
      const steps = runFrames(c, Array.from({ length: 600 }, () => 1 / 60));
      expect(Math.abs(steps - 600 * scale)).toBeLessThanOrEqual(1);
    }
  });

  it('pause stops accumulation; single step works while paused', () => {
    const c = new FixedStepClock(DT);
    c.paused = true;
    expect(runFrames(c, [1, 1, 1])).toBe(0);
    c.requestSingleStep();
    expect(runFrames(c, [1])).toBe(1);
    expect(c.tick).toBe(1);
  });

  it('dropBacklog discards owed steps but keeps the remainder', () => {
    const c = new FixedStepClock(DT);
    c.advance(10.5 * DT);
    expect(c.backlog()).toBe(10);
    expect(c.dropBacklog()).toBe(10);
    expect(c.backlog()).toBe(0);
    expect(c.alpha()).toBeCloseTo(0.5, 9);
  });

  it('dropBacklog(keep) keeps up to `keep` owed steps', () => {
    const c = new FixedStepClock(DT);
    c.advance(10.5 * DT);
    expect(c.dropBacklog(4)).toBe(6);
    expect(c.backlog()).toBe(4);
    expect(c.dropBacklog(100)).toBe(0);
  });

  it('rejects a non-positive dt', () => {
    expect(() => new FixedStepClock(0)).toThrow();
  });
});
