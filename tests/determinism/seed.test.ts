/**
 * Phase 0 acceptance: seed reproducibility.
 * Same seed -> bit-identical state; different seed -> different state;
 * splitting a run into chunks changes nothing.
 */

import { describe, expect, it } from 'vitest';
import { buildConfig } from '../../src/config/load.ts';
import { checkDeterminism, runHeadless } from '../../src/sim/headless.ts';
import { World } from '../../src/sim/world.ts';

const { config } = buildConfig();
const TICKS = config.sim.determinismCheckTicks;

describe(`seed reproducibility (${config.debugWalk.count} agents, ${TICKS} ticks)`, () => {
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
