/**
 * Fixed-timestep clock with time scaling (fast-forward / slow motion).
 *
 * Real (wall-clock) time is accumulated, multiplied by `timeScale`, and
 * consumed in exact steps of `dt`. The simulation therefore only ever sees
 * a sequence of identical steps: its state at tick N does not depend on the
 * frame rate, on the time scale, or on how wall time was sliced.
 *
 * When the host cannot keep up (heavy load or a large time scale), the
 * caller drops the backlog with `dropBacklog()` instead of trying to catch
 * up forever (the "spiral of death"). Dropping only changes how fast
 * simulated time advances relative to wall time — never the results.
 */

import type { Sec } from './units.ts';

export class FixedStepClock {
  readonly dt: Sec;
  /** Number of completed steps. */
  tick = 0;
  /** Scaled wall time not yet consumed, in seconds. */
  private accumulator: Sec = 0;
  private singleSteps = 0;
  timeScale = 1;
  paused = false;

  constructor(dt: Sec) {
    if (!(dt > 0)) throw new Error(`FixedStepClock: dt must be > 0 (got ${dt})`);
    this.dt = dt;
  }

  /** Feed elapsed wall-clock time. Ignored while paused. */
  advance(realDt: Sec): void {
    if (this.paused || !(realDt > 0)) return;
    this.accumulator += realDt * this.timeScale;
  }

  /** Request exactly one step (works while paused; used for frame-by-frame). */
  requestSingleStep(): void {
    this.singleSteps++;
  }

  /** True if a step is due; consumes it. Call `completeStep()` after stepping. */
  consumeStep(): boolean {
    if (this.singleSteps > 0) {
      this.singleSteps--;
      return true;
    }
    if (this.accumulator >= this.dt) {
      this.accumulator -= this.dt;
      return true;
    }
    return false;
  }

  completeStep(): void {
    this.tick++;
  }

  /** Steps currently owed. */
  backlog(): number {
    return Math.floor(this.accumulator / this.dt);
  }

  /**
   * Discard owed steps beyond `keep` (the sub-step remainder is always kept).
   * Returns the number of steps dropped.
   */
  dropBacklog(keep = 0): number {
    const n = Math.max(0, this.backlog() - Math.max(0, Math.floor(keep)));
    this.accumulator -= n * this.dt;
    return n;
  }

  /** Fraction of the next step already accumulated, in [0, 1). */
  alpha(): number {
    return this.accumulator / this.dt;
  }

  simTime(): Sec {
    return this.tick * this.dt;
  }
}
