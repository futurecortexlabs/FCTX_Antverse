/**
 * Reproduction tests for foraging trips, trail laying and trail following
 * (ASM-FOR-001, ASM-PHE-002/003, ASM-SEN-003/004, ASM-NAV-001/002) in the
 * double bridge.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dcos, dexp, PI } from '../../core/dmath.ts';
import { buildConfig, type Overlay } from '../../config/load.ts';
import { AgentFlag, AgentState, CarryKind } from '../agents/store.ts';
import { World } from '../world.ts';
import { forage } from './forage.ts';
import { layTrail, trail } from './trail.ts';

const preset = JSON.parse(readFileSync('config/presets/double-bridge.json', 'utf8')) as Overlay;
const make = (extra: Overlay = {}): World => new World(buildConfig([preset, { population: { count: 1 } }, extra]).config);

function put(w: World, x: number, z: number, h: number, state: number = AgentState.SEARCH): void {
  const a = w.agents.a;
  a.posX[0] = x; a.posZ[0] = z; a.heading[0] = h; a.state[0] = state;
}

describe('foraging trips', () => {
  it('a searching ant entering the feeder takes food, remembers the site and turns back', () => {
    const w = make(), a = w.agents.a;
    put(w, w.bridge!.feeder.x, 0, 0.2);
    forage(w, 0, 1);
    expect(a.state[0]).toBe(AgentState.RETURN);
    expect(a.carryKind[0]).toBe(CarryKind.FOOD);
    expect(a.flags[0]! & AgentFlag.KNOWS_FOOD).not.toBe(0);
    expect(a.heading[0]).toBeCloseTo(0.2 + PI, 5);
  });

  it('a returning ant entering the nest unloads and goes out again', () => {
    const w = make(), a = w.agents.a;
    put(w, w.bridge!.nest.x, 0, 3, AgentState.RETURN);
    a.carryKind[0] = CarryKind.FOOD;
    forage(w, 0, 1);
    expect(a.state[0]).toBe(AgentState.SEARCH);
    expect(a.carryKind[0]).toBe(CarryKind.NONE);
  });

  it('nothing changes on the stems and branches', () => {
    const w = make(), a = w.agents.a;
    put(w, w.bridge!.forkA - 20, 0, 0);
    forage(w, 0, 1);
    expect(a.state[0]).toBe(AgentState.SEARCH);
  });
});

describe('leaving the nest', () => {
  it('everyone starts resting in the nest; resting ants stand still and leave at exitRate', () => {
    const w = new World(buildConfig([preset, { population: { count: 400 } }]).config);
    const a = w.agents.a, n = w.agents.highWater, b = w.bridge!;
    for (let s = 0; s < n; s++) {
      expect(a.state[s]).toBe(AgentState.REST);
      expect(b.inNest(a.posX[s]!, a.posZ[s]!)).toBe(true);
    }
    const x0 = a.posX[0]!, z0 = a.posZ[0]!;
    const T = 30;
    let resting = 0, stillMoved = 0;
    for (let t = 0; t < T / w.config.sim.dt; t++) w.step();
    for (let s = 0; s < n; s++) if (a.state[s] === AgentState.REST) { resting++; if (s === 0 && (a.posX[0] !== x0 || a.posZ[0] !== z0)) stillMoved++; }
    const expected = n * dexp(-w.config.forage.exitRate * T);
    expect(Math.abs(resting - expected)).toBeLessThan(4 * Math.sqrt(expected)); // binomial, 4σ
    expect(stillMoved).toBe(0);
  });
});

describe('trail following (osmotropotaxis)', () => {
  const noVector: Overlay = { forage: { vectorGain: 0 } };

  it('turns towards the side with more pheromone, and not at all on a uniform field', () => {
    const w = make(noVector), f = w.pheromone!, a = w.agents.a;
    const x = w.bridge!.nest.x - 2;
    // Facing +x, left is −z. A trail along z = −2 lies under the left antenna.
    for (let d = -10; d <= 10; d += 0.5) f.deposit(x + d, -2, 50);
    put(w, x, 0, 0);
    trail(w, 0, 1);
    expect(a.steer[0]).toBeGreaterThan(0);
    put(w, x, -4, 0); // now the trail is on the right
    trail(w, 0, 1);
    expect(a.steer[0]).toBeLessThan(0);
  });

  it('faint trails are weak cues; strong ones are followed by their ratio (Weber law with a floor)', () => {
    const w = make(noVector), f = w.pheromone!, a = w.agents.a;
    const x = w.bridge!.nest.x;
    const steerFor = (amount: number): number => {
      f.data.fill(0);
      for (let d = -10; d <= 10; d += 0.5) f.deposit(x + d, -2, amount);
      put(w, x, 0, 0);
      trail(w, 0, 1);
      return a.steer[0]!;
    };
    const faint = steerFor(0.01), medium = steerFor(1), strong = steerFor(100), stronger = steerFor(1000);
    expect(faint).toBeGreaterThan(0);
    expect(faint).toBeLessThan(medium);
    expect(medium).toBeLessThan(strong);
    // At high concentration only the left/right ratio matters (same ratio → same turn).
    expect(stronger / strong).toBeGreaterThan(0.95);
    expect(stronger).toBeLessThanOrEqual(w.config.trail.gain);
  });

  it('a forager with a goal steers towards it (nest when returning, remembered food when out again)', () => {
    const w = make({ trail: { gain: 0 } }), a = w.agents.a, b = w.bridge!;
    // Between the forks, facing +z (h = −π/2): the nest is behind-left → turn… towards −x.
    put(w, b.forkA - 20, 0, -PI / 2, AgentState.RETURN);
    trail(w, 0, 1);
    expect(a.steer[0]).toBeLessThan(0); // −π/2 → −π (facing −x)
    put(w, b.forkA - 20, 0, -PI / 2, AgentState.SEARCH);
    trail(w, 0, 1);
    expect(a.steer[0]).toBe(0); // naive searcher: no goal
    a.flags[0] = a.flags[0]! | AgentFlag.KNOWS_FOOD;
    trail(w, 0, 1);
    expect(a.steer[0]).toBeGreaterThan(0); // −π/2 → 0 (facing +x, the feeder)
  });
});

describe('U-turns away from the goal', () => {
  it('a forager walking away from its goal turns back at uturnRate; one facing it never does', () => {
    const w = make({ trail: { gain: 0 }, forage: { vectorGain: 0 } }), a = w.agents.a, b = w.bridge!;
    const rate = w.config.forage.uturnRate, dt = w.config.sim.dt;
    const count = (h0: number, ticks: number): number => {
      let turns = 0;
      for (let t = 0; t < ticks; t++) {
        put(w, b.forkA - 20, 0, h0, AgentState.RETURN);
        w.tick = t;
        trail(w, 0, 1);
        if (Math.abs(a.heading[0]! - h0) > 1) turns++;
      }
      return turns;
    };
    const ticks = 60000;
    const away = count(0, ticks); // facing +x, the nest is at −x: error π → full rate
    const expected = ticks * rate * dt;
    expect(Math.abs(away - expected)).toBeLessThan(4 * Math.sqrt(expected));
    const sideways = count(PI / 2, ticks); // error π/2 → half rate
    expect(Math.abs(sideways - expected * (1 - dcos(PI / 2)) / 2)).toBeLessThan(4 * Math.sqrt(expected / 2));
    expect(count(PI, ticks)).toBe(0); // facing the nest
  });
});

describe('trail laying', () => {
  it('lays per mm walked: more when returning with food; none inside the arenas', () => {
    const w = make(), a = w.agents.a, pc = w.config.pheromone, b = w.bridge!;
    put(w, b.forkA - 20, 0, 0, AgentState.RETURN);
    a.lastStep[0] = 0.4;
    layTrail(w, 0, 1);
    expect(a.deposit[0]).toBeCloseTo(pc.depositReturn * 0.4, 6);
    a.state[0] = AgentState.SEARCH;
    layTrail(w, 0, 1);
    expect(a.deposit[0]).toBeCloseTo(pc.depositSearch * 0.4, 6);
    put(w, b.nest.x, 0, 0, AgentState.RETURN);
    layTrail(w, 0, 1);
    expect(a.deposit[0]).toBe(0);
  });

  it('deposits reach the field at the end of the tick, at the ant', () => {
    const w = make(), a = w.agents.a, b = w.bridge!;
    put(w, b.forkA - 20, 0, 0, AgentState.RETURN);
    w.step();
    expect(w.pheromone!.total()).toBeGreaterThan(0);
    expect(w.pheromone!.sample(a.posX[0]!, a.posZ[0]!)).toBeGreaterThan(0);
  });
});

describe('the walkway', () => {
  it('ants never leave the apparatus', () => {
    const w = new World(buildConfig([preset, { population: { count: 60 } }]).config);
    const a = w.agents.a, b = w.bridge!;
    let off = 0;
    for (let t = 0; t < 3600; t++) {
      w.step();
      for (let s = 0; s < w.agents.highWater; s++) if (!b.walkable(a.posX[s]!, a.posZ[s]!)) off++;
    }
    expect(off).toBe(0);
  });
});
