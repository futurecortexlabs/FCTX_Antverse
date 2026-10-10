/**
 * The two most recent snapshots and the sim time currently displayed.
 * Filled by the app's SimHost; read by render code.
 */

import { SNAP_FLOATS } from '../worker/protocol.ts';

/** Two consecutive snapshots and where between them to render. */
export class InterpolationState {
  prev: Float32Array;
  curr: Float32Array;
  prevMeta: Uint32Array;
  currMeta: Uint32Array;
  count = 0;
  prevSimTime = 0;
  currSimTime = 0;
  alive = 0;
  tick = 0;
  /** Seconds of sim time between the last two snapshots (smoothed). */
  interval = 0;
  /** Sim time being displayed. */
  renderTime = 0;

  constructor(capacity: number) {
    this.prev = new Float32Array(capacity * SNAP_FLOATS);
    this.curr = new Float32Array(capacity * SNAP_FLOATS);
    this.prevMeta = new Uint32Array(capacity);
    this.currMeta = new Uint32Array(capacity);
  }

  /** Interpolation factor between prev and curr in [0, 1]. */
  alpha(): number {
    const span = this.currSimTime - this.prevSimTime;
    if (span <= 0) return 1;
    const t = (this.renderTime - this.prevSimTime) / span;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }
}
