/**
 * Reduced double-bridge experiment (Phase 3 acceptance runs in
 * scripts/experiment-double-bridge.ts: 50 trials × 30 min). Here: a few
 * shorter trials must already route most traffic over the short branch, and
 * the counting must agree with the apparatus.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildConfig, type Overlay } from '../../src/config/load.ts';
import { runBridgeTrial } from '../../src/sim/experiments/double-bridge.ts';

const preset = JSON.parse(readFileSync('config/presets/double-bridge.json', 'utf8')) as Overlay;

describe('double bridge (reduced)', () => {
  it('traffic concentrates on the short branch', { timeout: 300_000 }, () => {
    for (const seed of [1, 2]) {
      const { config } = buildConfig([preset, { sim: { seed }, experiment: { duration: 600, window: 120 } }]);
      const r = runBridgeTrial(config);
      const trips = r.bins.reduce((t, b) => t + b.trips, 0);
      expect(trips, `seed ${seed}: food deliveries`).toBeGreaterThan(500);
      expect(r.finalShare, `seed ${seed}: short share in the last 2 min`).toBeGreaterThan(0.7);
    }
  });
});
