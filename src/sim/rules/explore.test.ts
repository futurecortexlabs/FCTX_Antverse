/**
 * Reproduction tests for the exploration rule (ASM-BEH-001, ASM-SEN-002, ASM-LOC-008).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { dexp } from '../../core/dmath.ts';
import { buildConfig } from '../../config/load.ts';
import { strideLength } from '../../locomotion/morphology.ts';
import { AgentState } from '../agents/store.ts';
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
  it('does not walk up a pebble side steeper than maxSlope and taller than maxClimb; walks around it instead', () => {
    const T = world.terrain, P = T.pebbles, ex = config.explore;
    const probe = ex.probeDistance * config.ant.workerBodyLength;
    // The tallest pebble whose side, approached along +X, rises more than maxClimb and more steeply than maxSlope over one probe distance.
    const steepRise = (cx: number, cz: number, r: number): number => {
      let worst = 0;
      for (let x = cx - r - probe; x < cx; x += 0.25) worst = Math.max(worst, T.supportHeight(x + probe, cz) - T.supportHeight(x, cz));
      return worst;
    };
    let k = -1, best = 0;
    for (let i = 0; i < P.count; i++) {
      const cx = P.center[3 * i]!, cz = P.center[3 * i + 2]!, h = T.supportHeight(cx, cz) - T.groundHeight(cx, cz);
      if (h > best && steepRise(cx, cz, P.radii[3 * i]!) > Math.max(ex.maxClimb, ex.maxSlope * probe)) { best = h; k = i; }
    }
    expect(k).toBeGreaterThanOrEqual(0);
    const cx = P.center[3 * k]!, cz = P.center[3 * k + 2]!, r = P.radii[3 * k]!;
    const sx = cx - (r + 12), sz = cz;
    place(world, sx, sz, 0); // heading 0 = +X, straight at the pebble
    const a = world.agents.a;
    let maxRise = 0;
    for (let t = 0; t < 4 / dt; t++) {
      world.step();
      maxRise = Math.max(maxRise, T.supportHeight(a.posX[0]!, a.posZ[0]!) - T.groundHeight(a.posX[0]!, a.posZ[0]!));
    }
    // It may climb the gentler foot of the pebble, but not the steep side to the top.
    expect(maxRise).toBeLessThan(0.6 * best);
    // It kept walking (around), not stuck facing the pebble.
    expect(Math.hypot(a.posX[0]! - sx, a.posZ[0]! - sz)).toBeGreaterThan(20);
  });

  it('walks up a slope higher than maxClimb but no steeper than maxSlope (a pile of loose soil)', () => {
    const cfg = buildConfig([{ population: { count: 1 }, scenario: { digging: true }, explore: { turnRateSd: 0 } }]).config;
    const w = new World(cfg);
    const m = w.mound!;
    // A pile at the angle of repose (mound.repose < explore.maxSlope), several maxClimb high.
    for (let k = 0; k < 4000; k++) m.drop(40, 0, cfg.soil.pellet);
    const peak = m.heightAt(40, 0);
    expect(peak).toBeGreaterThan(3 * cfg.explore.maxClimb);
    const a = w.agents.a;
    a.state[0] = AgentState.DIG; // on the surface with no goal: just walks (no foraging or homing)
    a.posX[0] = 40 - peak / cfg.mound.repose - 8; a.posZ[0] = 0; a.heading[0] = 0; a.turnRate[0] = 0;
    let top = 0;
    for (let t = 0; t < 4 / cfg.sim.dt; t++) { w.step(); top = Math.max(top, m.heightAt(a.posX[0]!, a.posZ[0]!)); }
    expect(top).toBeGreaterThan(0.8 * peak);
  });

  it('climbs down from an object it could not climb up (drops up to maxDrop are walkable)', () => {
    const w = new World(config); // its own world: the other tests depend on the shared one's tick
    const T = w.terrain, P = T.pebbles, ex = config.explore;
    // A pebble whose top is well above maxClimb but within maxDrop.
    let k = -1;
    for (let i = 0; i < P.count && k < 0; i++) {
      const top = T.supportHeight(P.center[3 * i]!, P.center[3 * i + 2]!) - T.groundHeight(P.center[3 * i]!, P.center[3 * i + 2]!);
      if (top > 2 * ex.maxClimb && top < ex.maxDrop * 0.8) k = i;
    }
    expect(k).toBeGreaterThanOrEqual(0);
    const cx = P.center[3 * k]!, cz = P.center[3 * k + 2]!;
    place(w, cx, cz, 0);
    const a = w.agents.a;
    for (let t = 0; t < 4 / dt; t++) w.step();
    // Off the pebble, back on the ground.
    expect(T.supportHeight(a.posX[0]!, a.posZ[0]!) - T.groundHeight(a.posX[0]!, a.posZ[0]!)).toBeLessThan(ex.maxClimb);
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
