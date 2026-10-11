/**
 * Reproduction tests for navigation by path integration (Phase 4):
 * ASM-NAV-001 (goal from the estimate), ASM-NAV-002 (U-turns),
 * ASM-NAV-003 (compass and odometer errors), ASM-NAV-004 (vector end and
 * nest search), ASM-NAV-005 (nest recognised on contact), ASM-FOR-002 (giving up).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dcos, dexp, dhypot, PI } from '../../core/dmath.ts';
import { buildConfig, type Overlay } from '../../config/load.ts';
import { AgentFlag, AgentState, CarryKind } from '../agents/store.ts';
import { World } from '../world.ts';
import { forage } from './forage.ts';
import { navigate, pathIntegrate, startTrip } from './navigate.ts';

const preset = JSON.parse(readFileSync('config/presets/homing.json', 'utf8')) as Overlay;
const make = (extra: Overlay = {}, count = 1): World => new World(buildConfig([preset, { population: { count } }, extra]).config);

/** Release ant s from the nest now. */
function release(w: World, s = 0): void {
  w.agents.a.state[s] = AgentState.SEARCH;
  startTrip(w, s);
}

describe('path integration', () => {
  it('without compass or odometer error the estimate is the true position relative to the nest', () => {
    const w = make({ forage: { compassSd: 0, odometerSd: 0, giveUp: [1e6, 1e6] } });
    const a = w.agents.a, nest = w.nest!;
    release(w);
    let walked = 0;
    for (let t = 0; t < 60 * 60; t++) { w.step(); walked += a.lastStep[0]!; }
    expect(walked).toBeGreaterThan(500);
    expect(a.state[0]).toBe(AgentState.SEARCH);
    // float32 state: allow a small accumulated rounding error
    expect(Math.abs(a.piX[0]! - (a.posX[0]! - nest.x))).toBeLessThan(0.05);
    expect(Math.abs(a.piZ[0]! - (a.posZ[0]! - nest.z))).toBeLessThan(0.05);
  });

  it('the odometer gain of each trip is 1 ± odometerSd', () => {
    const w = make({}, 2000);
    const a = w.agents.a, n = w.agents.highWater, sd = w.config.forage.odometerSd;
    for (let s = 0; s < n; s++) release(w, s);
    let m = 0, v = 0;
    for (let s = 0; s < n; s++) m += a.odometer[s]!;
    m /= n;
    for (let s = 0; s < n; s++) v += (a.odometer[s]! - m) ** 2;
    expect(m).toBeCloseTo(1, 2);
    expect(Math.sqrt(v / (n - 1))).toBeGreaterThan(sd * 0.9);
    expect(Math.sqrt(v / (n - 1))).toBeLessThan(sd * 1.1);
  });

  it('the compass error wanders with the configured spread and correlation time', () => {
    const w = make({ forage: { giveUp: [1e6, 1e6] } }, 400);
    const a = w.agents.a, n = w.agents.highWater, fc = w.config.forage, dt = w.config.sim.dt;
    for (let s = 0; s < n; s++) release(w, s);
    let s2 = 0, lag = 0, count = 0;
    const prev = Float64Array.from(a.compassError.subarray(0, n));
    for (let t = 0; t < 600; t++) {
      pathIntegrate(w, 0, n);
      w.tick++;
      for (let s = 0; s < n; s++) { const e = a.compassError[s]!; s2 += e * e; lag += e * prev[s]!; prev[s] = e; count++; }
    }
    expect(Math.sqrt(s2 / count)).toBeGreaterThan(fc.compassSd * 0.9);
    expect(Math.sqrt(s2 / count)).toBeLessThan(fc.compassSd * 1.1);
    expect(lag / s2).toBeCloseTo(dexp(-dt / fc.compassTau), 3);
  });

  it('a constant compass error rotates the estimate; an odometer gain scales it', () => {
    const w = make({ forage: { compassSd: 0 } });
    const a = w.agents.a;
    a.state[0] = AgentState.SEARCH;
    a.piX[0] = 0; a.piZ[0] = 0; a.odometer[0] = 1.1; a.compassError[0] = 0.2;
    // Pure decay of a constant error with compassSd = 0: e·exp(−dt/τ) per tick.
    const e = 0.2 * dexp(-w.config.sim.dt / w.config.forage.compassTau);
    a.stepX[0] = 1; a.stepZ[0] = 0;
    pathIntegrate(w, 0, 1);
    expect(dhypot(a.piX[0]!, a.piZ[0]!)).toBeCloseTo(1.1, 5);
    // Facing +x, a positive heading error reads the step as turned towards −z.
    expect(a.piX[0]!).toBeCloseTo(1.1 * dcos(e), 5);
    expect(a.piZ[0]!).toBeLessThan(0);
  });
});

describe('steering by the estimate', () => {
  it('a returning ant turns towards where its estimate puts the nest, not towards the nest', () => {
    const w = make({ forage: { uturnRate: 0 } }), a = w.agents.a;
    a.state[0] = AgentState.RETURN;
    a.posX[0] = 100; a.posZ[0] = 0; // the real nest is behind it (−x) …
    a.heading[0] = PI / 2;          // … it faces −z
    a.piX[0] = 0; a.piZ[0] = 100;   // but believes it is 100 mm along +z from the nest: home is −z, straight ahead
    a.steer[0] = 0;
    navigate(w, 0, 1);
    expect(Math.abs(a.steer[0]!)).toBeLessThan(1e-5); // heading is float32
    a.piX[0] = 100; a.piZ[0] = 0; // now it believes home is −x: a left turn from −z
    a.steer[0] = 0;
    navigate(w, 0, 1);
    expect(a.steer[0]).toBeGreaterThan(0);
  });

  it('going out again it heads for the remembered food site; a naive searcher has no goal', () => {
    const w = make({ forage: { uturnRate: 0 } }), a = w.agents.a;
    a.state[0] = AgentState.SEARCH;
    a.piX[0] = 0; a.piZ[0] = 0; a.heading[0] = PI / 2; // facing −z
    a.steer[0] = 0;
    navigate(w, 0, 1);
    expect(a.steer[0]).toBe(0);
    a.flags[0] = a.flags[0]! | AgentFlag.KNOWS_FOOD;
    a.foodX[0] = 100; a.foodZ[0] = 0; // food at +x: a right turn from −z
    navigate(w, 0, 1);
    expect(a.steer[0]).toBeLessThan(0);
  });

  it('a forager walking away from its goal turns back at uturnRate; one facing it never does', () => {
    const w = make({ forage: { vectorGain: 0 } }), a = w.agents.a;
    const rate = w.config.forage.uturnRate, dt = w.config.sim.dt;
    const count = (h0: number, ticks: number): number => {
      let turns = 0;
      for (let t = 0; t < ticks; t++) {
        a.state[0] = AgentState.RETURN;
        a.piX[0] = 100; a.piZ[0] = 0; // home is −x
        a.heading[0] = h0;
        w.tick = t;
        navigate(w, 0, 1);
        if (Math.abs(a.heading[0]! - h0) > 1) turns++;
      }
      return turns;
    };
    const ticks = 60000;
    const expected = ticks * rate * dt;
    expect(Math.abs(count(0, ticks) - expected)).toBeLessThan(4 * Math.sqrt(expected)); // facing +x: error π
    const half = expected * (1 - dcos(PI / 2)) / 2;
    expect(Math.abs(count(PI / 2, ticks) - half)).toBeLessThan(4 * Math.sqrt(half));
    expect(count(PI, ticks)).toBe(0); // facing home
  });

  it('nest search: loops out to the search radius and back through the centre; the radius grows with search time', () => {
    const w = make({ forage: { uturnRate: 0 } }), a = w.agents.a, fc = w.config.forage;
    a.state[0] = AgentState.NEST_SEARCH;
    a.heading[0] = 0; // facing +x, away from the estimated nest
    a.searchTime[0] = 0;
    const steerAt = (px: number): number => { a.piX[0] = px; a.piZ[0] = 1; a.steer[0] = 0; navigate(w, 0, 1); return a.steer[0]!; };
    expect(steerAt(fc.searchRadius * 0.5)).toBe(0);                // out on a loop: free
    expect(Math.abs(steerAt(fc.searchRadius * 2))).toBeGreaterThan(0); // beyond the radius: head back …
    expect(a.flags[0]! & AgentFlag.LOOP_BACK).not.toBe(0);
    expect(Math.abs(steerAt(fc.searchRadius * 1.5))).toBeGreaterThan(0); // … all the way to the centre
    expect(steerAt(fc.searchRadius * 0.5)).toBe(0);                // close to the centre: the next loop starts
    expect(a.flags[0]! & AgentFlag.LOOP_BACK).toBe(0);
    a.searchTime[0] = (fc.searchRadius * 2) / fc.searchGrowth;     // later the loops reach farther
    expect(steerAt(fc.searchRadius * 2)).toBe(0);
  });
});

describe('trip transitions', () => {
  it('leaving the nest sets the estimate from the nest and draws the trip', () => {
    const w = make(), a = w.agents.a, nest = w.nest!;
    a.posX[0] = nest.x + 1.5; a.posZ[0] = nest.z - 2;
    release(w);
    expect(a.piX[0]).toBeCloseTo(1.5, 5);
    expect(a.piZ[0]).toBeCloseTo(-2, 5);
    const [lo, hi] = w.config.forage.giveUp as [number, number];
    expect(a.giveUp[0]).toBeGreaterThanOrEqual(lo);
    expect(a.giveUp[0]).toBeLessThanOrEqual(hi);
  });

  it('finding food stores the food vector from the estimate; giving up heads home without food', () => {
    const w = make(), a = w.agents.a, f = w.feeder!;
    release(w);
    a.posX[0] = f.x; a.posZ[0] = f.z; a.piX[0] = f.x + 7; a.piZ[0] = f.z - 3; // estimate off by (7, −3)
    forage(w, 0, 1);
    expect(a.state[0]).toBe(AgentState.RETURN);
    expect(a.carryKind[0]).toBe(CarryKind.FOOD);
    expect(a.foodX[0]).toBeCloseTo(f.x + 7, 3);
    expect(a.foodZ[0]).toBeCloseTo(f.z - 3, 3);
    const w2 = make(), b = w2.agents.a;
    release(w2);
    b.posX[0] = 200; b.posZ[0] = 200;
    b.tripTime[0] = b.giveUp[0]!;
    forage(w2, 0, 1);
    expect(b.state[0]).toBe(AgentState.RETURN);
    expect(b.carryKind[0]).toBe(CarryKind.NONE);
  });

  it('when the home vector runs off away from the nest the ant searches; at the nest it goes in and resets', () => {
    const w = make(), a = w.agents.a, fc = w.config.forage, nest = w.nest!;
    release(w);
    a.state[0] = AgentState.RETURN;
    a.posX[0] = 40; a.posZ[0] = 25; // really 47 mm from the nest
    a.piX[0] = fc.vectorEnd * 0.5; a.piZ[0] = 0; // but the vector says "here"
    forage(w, 0, 1);
    expect(a.state[0]).toBe(AgentState.NEST_SEARCH);
    forage(w, 0, 1);
    expect(a.searchTime[0]).toBeGreaterThan(0);
    a.posX[0] = nest.x + nest.r * 0.5; a.posZ[0] = nest.z;
    forage(w, 0, 1);
    expect(a.state[0]).toBe(AgentState.SEARCH);
    expect(a.piX[0]).toBeCloseTo(nest.r * 0.5, 5); // reset to the truth at the nest
    expect(a.piZ[0]).toBeCloseTo(0, 5);
  });
});
