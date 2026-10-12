/**
 * Reproduction tests for the environment's effects on the ants (Phase 7):
 * walking speed and development by temperature (BIO-ENV-001, ASM-ENV-002),
 * foraging by day only (BIO-ENV-002).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildConfig, type Overlay } from '../../config/load.ts';
import { AgentFlag, AgentState, Caste, Task } from '../agents/store.ts';
import { BroodStage } from '../colony/brood.ts';
import { World } from '../world.ts';

const colony = JSON.parse(readFileSync('config/presets/colony.json', 'utf8')) as Overlay;
const flat: Overlay = { terrain: { pebbleDensity: 0, leafDensity: 0, grainDensity: 0 } };
/** A constant temperature T all day. */
const at = (T: number, extra: Overlay = {}): Overlay => ({ env: { enabled: true, meanTemp: T, surfaceAmplitude: 0, startHour: 10 }, ...extra });

describe('temperature', () => {
  it('ants walk twice as far per second 10 °C warmer (below the optimum)', () => {
    const walked = (T: number): number => {
      const w = new World(buildConfig([flat, { population: { count: 50 } }, at(T)]).config);
      let d = 0;
      for (let t = 0; t < 600; t++) { w.step(); for (let s = 0; s < 50; s++) d += w.agents.a.lastStep[s]!; }
      return d;
    };
    expect(walked(30) / walked(20)).toBeCloseTo(2, 1);
  });

  it('brood develops faster where it is warmer', () => {
    const left = (T: number): number => {
      const w = new World(buildConfig([colony, { population: { count: 20 }, soil: { size: [128, 256, 128] } }, at(T, { env: { enabled: true, meanTemp: T, surfaceAmplitude: 0, startHour: 10, dampingDepth: 100 } })]).config);
      const b = w.colony!.brood;
      const i = b.add(BroodStage.EGG, w.agents.a.cell[w.colony!.queen]!, 1e6);
      for (let t = 0; t < 600; t++) w.step();
      return 1e6 - b.timer[i]!;
    };
    expect(left(30) / left(20)).toBeCloseTo(2, 1);
  });
});

describe('day and night', () => {
  it('after dark nobody sets out to forage, and those out come home', { timeout: 600000 }, () => {
    // From 18:20 solar time (light falls below foragingLight near 18:50 in July at 35.7° N): run past dusk.
    const w = new World(buildConfig([colony, { population: { count: 60 }, soil: { size: [128, 256, 128] }, colony: { engageRate: 0.05 } },
      { env: { enabled: true, startHour: 18.33 } }]).config);
    const a = w.agents.a;
    const out = (): number => {
      let n = 0;
      for (let s = 0; s < w.agents.highWater; s++) if ((a.flags[s]! & (AgentFlag.ALIVE | AgentFlag.UNDERGROUND)) === AgentFlag.ALIVE && a.state[s] === AgentState.SEARCH) n++;
      return n;
    };
    let before = 0;
    for (let t = 0; t < 60 * 900; t++) { w.step(); before = Math.max(before, out()); }
    expect(before).toBeGreaterThan(0); // foraging in the evening light
    // Dusk has passed by 19:00: no searchers, nobody climbing out.
    for (let t = 0; t < 60 * 1500; t++) w.step();
    expect(w.climate.foraging).toBe(false);
    let exiting = 0;
    for (let k = 0; k < 600; k++) {
      w.step();
      for (let s = 0; s < w.agents.highWater; s++) if (a.caste[s] === Caste.WORKER && (a.state[s] === AgentState.EXIT || (a.task[s] === Task.FORAGE && a.state[s] === AgentState.SEARCH))) exiting++;
    }
    expect(exiting).toBe(0);
  });
});
