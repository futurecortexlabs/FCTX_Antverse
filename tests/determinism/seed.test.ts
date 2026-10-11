/**
 * Phase 0 acceptance: seed reproducibility.
 * Same seed -> bit-identical state; different seed -> different state;
 * splitting a run into chunks changes nothing.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildConfig, type Overlay } from '../../src/config/load.ts';
import { checkDeterminism, runHeadless } from '../../src/sim/headless.ts';
import { World } from '../../src/sim/world.ts';

// Reproducibility does not depend on population size; 300 workers keep the run short
// (the browser determinism check covers the default population).
const { config } = buildConfig([{ population: { count: 300 } }]);
const TICKS = config.sim.determinismCheckTicks;

describe(`seed reproducibility (${config.population.count} agents, ${TICKS} ticks)`, () => {
  it('same seed gives identical hashes; seed+1 differs', { timeout: 300000 }, () => {
    const r = checkDeterminism(config, TICKS);
    console.log(`[determinism] ${JSON.stringify(r)}`);
    expect(r.identical).toBe(true);
    expect(r.seedSensitive).toBe(true);
  });

  it('chunked stepping equals one continuous run', { timeout: 300000 }, () => {
    const a = runHeadless(config, TICKS);
    const b = new World(config);
    for (const chunk of [1, 999, 3000, TICKS - 4000]) for (let i = 0; i < chunk; i++) b.step();
    expect(b.tick).toBe(a.tick);
    expect(b.stateHash()).toBe(a.stateHash());
  });

  it('hash is sensitive to a single-bit change in agent state', () => {
    const w = runHeadless(config, 10);
    const h = w.stateHash();
    const view = new Uint32Array(w.agents.a.posX.buffer);
    view[0]! ^= 1;
    expect(w.stateHash()).not.toBe(h);
  });

  it('golden hash for the default config is stable', () => {
    // If this changes, either simulation behaviour or hashing changed on purpose:
    // update the snapshot and record why in the phase report.
    expect(checkDeterminism(config, 600).hashA).toMatchSnapshot();
  });
});

describe('seed reproducibility with the pheromone field (double bridge)', () => {
  const preset = JSON.parse(readFileSync('config/presets/double-bridge.json', 'utf8')) as Overlay;
  const bridge = buildConfig([preset]).config;
  const ticks = 3600; // one minute: ants reach the feeder and lay trail both ways

  it('same seed gives identical hashes (agents and field); seed+1 differs', { timeout: 300000 }, () => {
    const r = checkDeterminism(bridge, ticks);
    expect(r.identical).toBe(true);
    expect(r.seedSensitive).toBe(true);
  });

  it('golden hash for the double-bridge preset is stable', { timeout: 300000 }, () => {
    expect(checkDeterminism(bridge, 1200).hashA).toMatchSnapshot();
  });
});
