/**
 * Drives a World from wall-clock time: fixed steps, time scaling, a per-
 * iteration time budget, snapshot publishing and statistics. Free of worker
 * APIs (time source and snapshot sink are injected) so it runs in Node tests.
 */

import { FixedStepClock } from '../core/clock.ts';
import { MS_PER_S } from '../core/units.ts';
import type { Config } from '../config/params.ts';
import { World } from '../sim/world.ts';
import type { SimStats, SnapshotView } from './protocol.ts';
import { writeSnapshot } from './snapshot-writer.ts';

export interface SnapshotSink {
  /** Snapshot to write into now. */
  target(): SnapshotView;
  /** Make the written snapshot visible to the reader. */
  commit(): void;
}

export class SimRunner {
  world: World;
  clock: FixedStepClock;
  private config: Config;
  private seq = 0;
  private lastNow: number | null = null;
  private dirty = true;
  // stats window
  private statStart: number;
  private statSteps = 0;
  private statStepMs = 0;
  private statSimStart = 0;
  private dropped = 0;

  private readonly sink: SnapshotSink | null;
  private readonly now: () => number;

  constructor(config: Config, sink: SnapshotSink | null, now: () => number) {
    this.sink = sink;
    this.now = now;
    this.config = config;
    this.world = new World(config);
    this.clock = new FixedStepClock(config.sim.dt);
    this.clock.timeScale = config.time.initialSpeed;
    this.statStart = now();
  }

  /** Rebuild the world (e.g. new agent count) keeping speed and pause state. */
  reset(config: Config): void {
    const { timeScale, paused } = this.clock;
    this.config = config;
    this.world = new World(config);
    this.clock = new FixedStepClock(config.sim.dt);
    this.clock.timeScale = timeScale;
    this.clock.paused = paused;
    this.lastNow = null;
    this.statSimStart = 0;
    this.dirty = true;
  }

  setSpeed(scale: number): void {
    this.clock.timeScale = scale;
    this.dirty = true;
  }

  setPaused(paused: boolean): void {
    this.clock.paused = paused;
    this.lastNow = null;
    this.dirty = true;
  }

  requestStep(): void {
    this.clock.requestSingleStep();
  }

  /**
   * Run due steps within the time budget and publish if anything changed.
   * Returns true if steps are still owed (caller should reschedule at once).
   */
  iterate(): boolean {
    const t0 = this.now();
    if (this.lastNow !== null) this.clock.advance((t0 - this.lastNow) / MS_PER_S);
    this.lastNow = t0;

    const budget = this.config.sim.loopBudget;
    let steps = 0;
    let t = t0;
    while (this.clock.consumeStep()) {
      this.world.step();
      this.clock.completeStep();
      steps++;
      t = this.now();
      if (t - t0 > budget) break; // yield so commands and snapshots stay responsive
    }
    // Owed steps beyond `maxCatchUp` of wall time cannot be caught up: drop them.
    const keep = (this.config.sim.maxCatchUp / MS_PER_S) * this.clock.timeScale / this.clock.dt;
    this.dropped += this.clock.dropBacklog(keep);
    if (steps > 0) {
      this.statSteps += steps;
      this.statStepMs += t - t0;
    }
    if (steps > 0 || this.dirty) this.publish(t);
    return this.clock.backlog() > 0;
  }

  private publish(wallTime: number): void {
    if (!this.sink) return;
    writeSnapshot(this.world, this.sink.target(), ++this.seq, wallTime, this.clock.timeScale, this.clock.paused);
    this.sink.commit();
    this.dirty = false;
  }

  /** Statistics since the previous call, or null if the interval has not elapsed. */
  takeStats(): SimStats | null {
    const now = this.now();
    const elapsed = now - this.statStart;
    if (elapsed < this.config.sim.statsInterval) return null;
    const simNow = this.world.simTime();
    const stats: SimStats = {
      tick: this.world.tick,
      simTime: simNow,
      alive: this.world.agents.alive,
      msPerTick: this.statSteps > 0 ? this.statStepMs / this.statSteps : 0,
      ticksPerSec: (this.statSteps * MS_PER_S) / elapsed,
      achievedSpeed: ((simNow - this.statSimStart) * MS_PER_S) / elapsed,
      targetSpeed: this.clock.timeScale,
      paused: this.clock.paused,
      droppedSteps: this.dropped,
    };
    this.statStart = now;
    this.statSteps = 0;
    this.statStepMs = 0;
    this.statSimStart = simNow;
    return stats;
  }
}
