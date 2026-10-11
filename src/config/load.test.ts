import { describe, expect, it } from 'vitest';
import { applyOverlay, buildConfig, ConfigError, overlayFromAssignment, parseUrlOptions } from './load.ts';
import { DEFAULT_PARAMS } from './params.ts';

describe('config loading', () => {
  it('defaults build and are frozen', () => {
    const { config } = buildConfig();
    expect(config.sim.dt).toBeCloseTo(1 / 60, 12);
    expect(Object.isFrozen(config.sim)).toBe(true);
  });

  it('overlays replace values but keep unit and ref', () => {
    const params = applyOverlay(DEFAULT_PARAMS, { population: { count: 42 } });
    expect(params.population.count.value).toBe(42);
    expect(params.population.count.unit).toBe('count');
    expect(params.population.count.ref).toBe(DEFAULT_PARAMS.population.count.ref);
    expect(DEFAULT_PARAMS.population.count.value).not.toBe(42); // defaults untouched
  });

  it('rejects unknown keys, wrong types, out-of-range and non-integer values', () => {
    expect(() => buildConfig([{ nope: 1 }])).toThrow(ConfigError);
    expect(() => buildConfig([{ sim: { nope: 1 } }])).toThrow(ConfigError);
    expect(() => buildConfig([{ sim: { dt: true } }])).toThrow(ConfigError);
    expect(() => buildConfig([{ sim: { dt: 0 } }])).toThrow(ConfigError);
    expect(() => buildConfig([{ population: { count: 1.5 } }])).toThrow(ConfigError);
    expect(() => buildConfig([{ sim: 3 }])).toThrow(ConfigError);
  });

  it('parses URL options', () => {
    const o = parseUrlOptions('?seed=7&preset=ants-10k&set=population.count=5000&set=render.reversedDepth=false&set=bench.counts=1,2,3');
    expect(o.preset).toBe('ants-10k');
    const { config } = buildConfig(o.overlays);
    expect(config.sim.seed).toBe(7);
    expect(config.population.count).toBe(5000);
    expect(config.render.reversedDepth).toBe(false);
    expect(config.bench.counts).toEqual([1, 2, 3]);
  });

  it('assignment to a group or unknown path is an error', () => {
    expect(() => overlayFromAssignment(DEFAULT_PARAMS, 'sim', '1')).toThrow(ConfigError);
    expect(() => overlayFromAssignment(DEFAULT_PARAMS, 'sim.nope', '1')).toThrow(ConfigError);
  });
});
