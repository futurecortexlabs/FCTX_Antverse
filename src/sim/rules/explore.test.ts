/**
 * Reproduction tests for the exploration rule (ASM-BEH-001, ASM-SEN-002, ASM-LOC-008).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { dexp } from '../../core/dmath.ts';
import { buildConfig } from '../../config/load.ts';
import { strideLength } from '../../locomotion/morphology.ts';
import { World } from '../world.ts';
import { bodyPoseRange } from './body-pose.ts';

const { config } = buildConfig([{ population: { count: 1 }, world: { arenaSize: 1800 } }]);
const dt = config.sim.dt;
let world: World;

beforeAll(() => { world = new World(config); });

/** Put the single ant at (x, z) with heading h and settle its body. */
function place(w: World, x: number, z: number, h: number): void {
  const a = w.agents.a;
  a.posX[0] = x; a.posZ[0] = z; a.heading[0] = h; a.turnRate[0] = 0;
  bodyPoseRange(w, 0, 1, 1);
}

describe('exploration: turning is a smooth correlated random walk', () => {
  it('the turning rate has the configured spread and correlation time (OU process)', () => {
    const cfg = buildConfig([{ population: { count: 400 } }]).config;
    const w = new World(cfg);
    const a = w.agents.a, n = w.agents.highWater;
    for (let t = 0; t < 120; t++) w.step(); // forget the zero start
    let s2 = 0, lag = 0, count = 0;
    const prev = Float64Array.from(a.turnRate.subarray(0, n));
    for (let t = 0; t < 600; t++) {
      w.step();
      for (let i = 0; i < n; i++) {
        const v = a.turnRate[i]!;
        s2 += v * v; lag += v * prev[i]!; prev[i] = v; count++;
      }
    }
    const sd = Math.sqrt(s2 / count), rho = lag / s2;
    expect(sd).toBeGreaterThan(cfg.explore.turnRateSd * 0.9);
    expect(sd).toBeLessThan(cfg.explore.turnRateSd * 1.1);
    expect(rho).toBeCloseTo(dexp(-dt / cfg.explore.turnTau), 2);
  });

  it('advances the gait phase by distance walked / stride length', () => {
    place(world, 0, 0, 0.3);
    const a = world.agents.a;
    const x0 = a.posX[0]!, z0 = a.posZ[0]!, p0 = a.gaitPhase[0]!;
    world.step();
    const d = Math.sqrt((a.posX[0]! - x0) ** 2 + (a.posZ[0]! - z0) ** 2);
    const dp = (a.gaitPhase[0]! - p0 + 1) % 1;
    expect(d).toBeCloseTo(a.speed[0]! * dt, 4); // positions are float32
    expect(dp).toBeCloseTo(d / strideLength(config, a.speed[0]!), 5); // gaitPhase is float32
  });
});

describe('exploration: obstacles and arena edge', () => {
  it('does not walk onto a pebble taller than maxClimb; walks around it instead', () => {
    const T = world.terrain, P = T.pebbles;
    // The tallest pebble, approached head-on from 12 mm outside its rim.
    let k = 0;
    for (let i = 1; i < P.count; i++) if (P.center[3 * i + 1]! - T.groundHeight(P.center[3 * i]!, P.center[3 * i + 2]!) > P.center[3 * k + 1]! - T.groundHeight(P.center[3 * k]!, P.center[3 * k + 2]!)) k = i;
    const cx = P.center[3 * k]!, cz = P.center[3 * k + 2]!, r = P.radii[3 * k]!;
    expect(T.supportHeight(cx, cz) - T.groundHeight(cx, cz)).toBeGreaterThan(config.explore.maxClimb);
    const sx = cx - (r + 12), sz = cz;
    place(world, sx, sz, 0); // heading 0 = +X, straight at the pebble
    const a = world.agents.a;
    let maxRise = 0;
    for (let t = 0; t < 4 / dt; t++) {
      world.step();
      maxRise = Math.max(maxRise, T.supportHeight(a.posX[0]!, a.posZ[0]!) - T.groundHeight(a.posX[0]!, a.posZ[0]!));
    }
    expect(maxRise).toBeLessThanOrEqual(config.explore.maxClimb);
    // It kept walking (around), not stuck facing the pebble.
    expect(Math.hypot(a.posX[0]! - sx, a.posZ[0]! - sz)).toBeGreaterThan(20);
  });

  it('turns back at the arena edge and never leaves the arena', () => {
    const half = config.world.arenaSize / 2;
    place(world, half - 3, 0, 0); // facing straight out
    const a = world.agents.a;
    let path = 0;
    for (let t = 0; t < 3 / dt; t++) {
      const x = a.posX[0]!, z = a.posZ[0]!;
      world.step();
      path += Math.hypot(a.posX[0]! - x, a.posZ[0]! - z);
      expect(Math.abs(a.posX[0]!)).toBeLessThanOrEqual(half);
      expect(Math.abs(a.posZ[0]!)).toBeLessThanOrEqual(half);
    }
    // It turned away from the edge and kept walking (along or away from it), not stuck facing out.
    expect(Math.cos(a.heading[0]!)).toBeLessThan(0.9);
    expect(path).toBeGreaterThan(30);
  });
});

describe('initial placement', () => {
  it('places every worker in the arena and never on an object taller than maxClimb', () => {
    const cfg = buildConfig([{ population: { count: 2000 }, world: { arenaSize: 1800 } }]).config;
    const w = new World(cfg);
    const a = w.agents.a, T = w.terrain, half = cfg.world.arenaSize / 2;
    expect(w.agents.alive).toBe(2000);
    for (let i = 0; i < w.agents.highWater; i++) {
      expect(Math.abs(a.posX[i]!)).toBeLessThanOrEqual(half);
      expect(T.supportHeight(a.posX[i]!, a.posZ[i]!) - T.groundHeight(a.posX[i]!, a.posZ[i]!)).toBeLessThanOrEqual(cfg.explore.maxClimb);
      expect(a.speed[i]!).toBeGreaterThanOrEqual(cfg.locomotion.speed * (1 - cfg.locomotion.speedSpread) - 1e-9);
      expect(a.speed[i]!).toBeLessThanOrEqual(cfg.locomotion.speed * (1 + cfg.locomotion.speedSpread) + 1e-9);
    }
  });
});
