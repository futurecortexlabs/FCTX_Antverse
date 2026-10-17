/**
 * Reduced Phase 5 excavation experiment (the acceptance run is
 * scripts/experiment-digging.ts: 4 group sizes × 5 seeds × 12 h). Here:
 * two group sizes for 3 h in a smaller soil region (2 h before the nest-shape
 * rules: tunnels by a minority of excavators make the first hours slower).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildConfig, type Overlay } from '../../src/config/load.ts';
import { runDiggingTrial } from '../../src/sim/experiments/digging.ts';

const preset = JSON.parse(readFileSync('config/presets/digging.json', 'utf8')) as Overlay;
const run = (workers: number) => runDiggingTrial(buildConfig([preset, {
  population: { count: workers }, soil: { size: [160, 256, 160] }, sim: { seed: 7 },
  experiment: { digDuration: 10800, digBin: 600 },
}]).config);

describe('nest excavation (reduced)', () => {
  it('digging slows down, the nest is one connected space, every pellet is accounted for, and more workers dig more', { timeout: 300_000 }, () => {
    const small = run(20), large = run(40);
    for (const r of [small, large]) {
      expect(r.disconnected).toBe(0);
      expect(r.unaccounted).toBe(0);
      expect(r.lateRate).toBeLessThan(0.5 * r.peakRate);
    }
    expect(large.volume).toBeGreaterThan(1.4 * small.volume);
    // Top-heavy: more of the nest in the top 10 mm than in the next 10 mm.
    expect(large.byDepth[0]!).toBeGreaterThan(large.byDepth[1] ?? 0);
  });
});
