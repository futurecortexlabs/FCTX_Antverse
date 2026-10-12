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

describe('seed reproducibility with path integration (homing)', () => {
  const preset = JSON.parse(readFileSync('config/presets/homing.json', 'utf8')) as Overlay;
  const homing = buildConfig([preset, { forage: { exitRate: 0.2 } }]).config;

  it('same seed gives identical hashes; seed+1 differs', { timeout: 300000 }, () => {
    const r = checkDeterminism(homing, 3600);
    expect(r.identical).toBe(true);
    expect(r.seedSensitive).toBe(true);
  });

  it('golden hash for the homing preset is stable', { timeout: 300000 }, () => {
    expect(checkDeterminism(homing, 1200).hashA).toMatchSnapshot();
  });
});

describe('seed reproducibility with soil (nest excavation)', () => {
  const preset = JSON.parse(readFileSync('config/presets/digging.json', 'utf8')) as Overlay;
  const digging = buildConfig([preset, { population: { count: 60 }, soil: { size: [128, 256, 128] } }]).config;

  it('same seed gives identical hashes (agents, soil, mound); seed+1 differs', { timeout: 300000 }, () => {
    const r = checkDeterminism(digging, 3600);
    expect(r.identical).toBe(true);
    expect(r.seedSensitive).toBe(true);
  });

  it('golden hash for the digging preset is stable', { timeout: 300000 }, () => {
    expect(checkDeterminism(digging, 1800).hashA).toMatchSnapshot();
  });
});

describe('seed reproducibility of a colony (queen, brood, contacts, tasks)', () => {
  const colony = buildConfig([JSON.parse(readFileSync('config/presets/colony.json', 'utf8')) as Overlay, { population: { count: 120 } }]).config;

  it('same seed → same state; different seed → different state', { timeout: 300000 }, () => {
    const r = checkDeterminism(colony, 3600);
    expect(r.identical).toBe(true);
    expect(r.seedSensitive).toBe(true);
  });

  it('golden hash for the colony preset is stable', { timeout: 300000 }, () => {
    expect(checkDeterminism(colony, 1800).hashA).toMatchSnapshot();
  });
});

describe('seed reproducibility of the environment (sun, temperature, rain, drops, collisions)', () => {
  const field = buildConfig([JSON.parse(readFileSync('config/presets/field.json', 'utf8')) as Overlay,
    { population: { count: 120 }, env: { rain: [0, 0.5, 30], startHour: 9 } }]).config;

  it('same seed → same state; different seed → different state', { timeout: 300000 }, () => {
    const r = checkDeterminism(field, 3600);
    expect(r.identical).toBe(true);
    expect(r.seedSensitive).toBe(true);
  });

  it('golden hash for the field preset in rain is stable', { timeout: 300000 }, () => {
    expect(checkDeterminism(field, 1800).hashA).toMatchSnapshot();
  });
});
