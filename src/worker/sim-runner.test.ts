import { describe, expect, it } from 'vitest';
import { buildConfig } from '../config/load.ts';
import { runHeadless } from '../sim/headless.ts';
import { SnapshotView, snapshotByteLength, SnapH } from './protocol.ts';
import { SimRunner, type SnapshotSink } from './sim-runner.ts';

const { config } = buildConfig([{ debugWalk: { count: 100 } }, { sim: { capacity: 128 } }]);

function fakeTime() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function sink(): SnapshotSink & { view: SnapshotView; commits: number } {
  const view = new SnapshotView(new ArrayBuffer(snapshotByteLength(config.sim.capacity)), config.sim.capacity);
  const s = { view, commits: 0, target: () => view, commit: () => { s.commits++; } };
  return s;
}

describe('SimRunner', () => {
  it('state depends only on tick count, not on frame timing, speed changes or pauses', () => {
    const clock = fakeTime();
    const r = new SimRunner(config, null, clock.now);
    r.iterate();
    const pattern = [16.7, 3, 40, 8, 100, 1, 16.7];
    for (let i = 0; i < 200; i++) {
      clock.advance(pattern[i % pattern.length]!);
      if (i === 50) r.setSpeed(8);
      if (i === 90) r.setPaused(true);
      if (i === 110) r.setPaused(false);
      if (i === 150) r.setSpeed(0.25);
      r.iterate();
    }
    const tick = r.world.tick;
    expect(tick).toBeGreaterThan(0);
    expect(r.world.stateHash()).toBe(runHeadless(config, tick).stateHash());
  });

  it('fast-forward runs proportionally more steps per wall second', () => {
    const clock = fakeTime();
    const r = new SimRunner(config, null, clock.now);
    r.setSpeed(16);
    r.iterate();
    for (let i = 0; i < 60; i++) { clock.advance(1000 / 60); r.iterate(); }
    expect(Math.abs(r.world.tick - 16 * 60)).toBeLessThanOrEqual(1);
  });

  it('publishes a snapshot after stepping, with header fields filled', () => {
    const clock = fakeTime();
    const s = sink();
    const r = new SimRunner(config, s, clock.now);
    r.iterate(); // initial publish (dirty)
    clock.advance(100);
    r.iterate();
    expect(s.commits).toBeGreaterThanOrEqual(2);
    expect(s.view.header[SnapH.TICK]).toBe(r.world.tick);
    expect(s.view.header[SnapH.COUNT]).toBe(100);
    expect(s.view.header[SnapH.ALIVE]).toBe(100);
  });

  it('single step advances exactly one tick while paused', () => {
    const clock = fakeTime();
    const r = new SimRunner(config, null, clock.now);
    r.setPaused(true);
    r.iterate();
    clock.advance(1000);
    r.iterate();
    expect(r.world.tick).toBe(0);
    r.requestStep();
    r.iterate();
    expect(r.world.tick).toBe(1);
  });
});
