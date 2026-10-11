/**
 * Reduced Phase 4 homing experiment (the acceptance run is
 * scripts/experiment-homing.ts: 50 trials × 2 conditions). No pheromone:
 * foragers get home by path integration alone, and a displaced forager
 * searches where its vector says the nest is, not where the nest is.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildConfig, type Overlay } from '../../src/config/load.ts';
import { runHomingTrial } from '../../src/sim/experiments/homing.ts';
import { World } from '../../src/sim/world.ts';

const preset = JSON.parse(readFileSync('config/presets/homing.json', 'utf8')) as Overlay;
const SEEDS = [1, 2, 3, 4, 5, 6];
const cfg = (seed: number) => buildConfig([preset, { population: { count: 1 }, sim: { seed } }]).config;

describe('homing by path integration (reduced)', () => {
  it('there is no pheromone on open ground: no field, nothing to lay or follow', () => {
    const w = new World(cfg(1));
    expect(w.pheromone).toBeNull();
    expect(w.nest).not.toBeNull();
  });

  it('foragers return to the nest after a tortuous outward search', { timeout: 120_000 }, () => {
    for (const seed of SEEDS) {
      const r = runHomingTrial(cfg(seed), false);
      expect(r.reached, `seed ${seed}`).toBe(true);
      // The way out was much longer than the way home.
      expect(r.outboundLength, `seed ${seed}`).toBeGreaterThan(2 * r.homeDistance);
    }
  });

  it('regressions found while developing Phase 4', { timeout: 120_000 }, () => {
    // 2036: rocked left–right in place in front of an obstacle whose two sides looked alike.
    const rocking = runHomingTrial(cfg(2036), false);
    expect(rocking.reached).toBe(true);
    // 3038: the vector ended 5 mm from the nest, but the search skimmed the rim of its radius and never came back.
    const skimming = runHomingTrial(cfg(3038), false);
    expect(skimming.reached).toBe(true);
    expect(skimming.timeToNest).toBeLessThan(120);
  });

  it('displaced foragers search at the fictive nest', { timeout: 120_000 }, () => {
    let near = 0;
    for (const seed of SEEDS) {
      const r = runHomingTrial(cfg(seed), true);
      const c = cfg(seed).experiment;
      if (r.searchCentreToFictive !== null && r.searchCentreToFictive <= c.searchTolerance && r.searchCentreToFictive < r.searchCentreToReal!) near++;
    }
    expect(near).toBeGreaterThanOrEqual(SEEDS.length - 1);
  });
});
