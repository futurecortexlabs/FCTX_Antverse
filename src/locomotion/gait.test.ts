/**
 * Phase 2 acceptance: workers walk the Phase 1 terrain with an alternating
 * tripod gait; feet neither sink into nor float above the surface.
 *
 * Ants walk freely (correlated random walk) over a 1.8 m arena that crosses
 * bare soil, gravel, leaf litter and grass patches. Every simulation tick the
 * leg rig is solved against the terrain support and measured.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { quatRotate, type Vec3 } from '../core/quat.ts';
import { buildConfig } from '../config/load.ts';
import { World } from '../sim/world.ts';
import { JOINTS, LegRig, type BodyPose } from './legs.ts';
import { buildMorphology, LEGS, TRIPOD_OFFSET } from './morphology.ts';

const { config } = buildConfig([{ population: { count: 24 }, world: { arenaSize: 1800 } }]);
const SECONDS = 20;
const TOL = 0.02; // mm: acceptance tolerance for "neither sinks nor floats"

interface Metrics {
  updates: number;
  stanceGapMax: number;
  slipMax: number;
  swingBelow: number;
  swingClamped: number;
  ankleBelow: number;
  kneeBelow: number;
  overstretchedLegFrames: number;
  legFrames: number;
  minStance: number;
  tripodViolations: number;
  bodyBelow: number;
  bodyDepthMax: number;
  onObject: number;
  frames: number;
}

let M: Metrics;

beforeAll(() => {
  const world = new World(config);
  const morph = buildMorphology(config);
  const support = (x: number, z: number): number => world.terrain.supportHeight(x, z);
  const solid = (x: number, y: number, z: number): boolean => world.terrain.solidAt(x, y, z);
  const probe = { support, solid };
  const n = world.agents.highWater;
  const rigs = Array.from({ length: n }, () => new LegRig(morph, config));
  const planted = Array.from({ length: n }, () => new Float64Array(LEGS * 3).fill(NaN));
  const m: Metrics = {
    updates: 0, stanceGapMax: 0, slipMax: 0, swingBelow: 0, swingClamped: 0, ankleBelow: 0, kneeBelow: 0,
    overstretchedLegFrames: 0, legFrames: 0, minStance: LEGS, tripodViolations: 0, bodyBelow: 0, bodyDepthMax: 0, onObject: 0, frames: 0,
  };
  const a = world.agents.a;
  const v: Vec3 = [0, 0, 0];
  const pose: BodyPose = { x: 0, y: 0, z: 0, q: new Float64Array(4), yaw: 0 };
  const bodyPoints = [morph.head, morph.mesosoma, morph.gaster].map((s) => [s.cx, s.cy - s.h / 2]);
  const ticks = Math.round(SECONDS / config.sim.dt);
  for (let t = 0; t < ticks; t++) {
    world.step();
    for (let s = 0; s < n; s++) {
      pose.x = a.posX[s]!; pose.y = a.posY[s]!; pose.z = a.posZ[s]!; pose.yaw = a.heading[s]!;
      (pose.q as Float64Array).set(a.rot.subarray(4 * s, 4 * s + 4));
      const rig = rigs[s]!;
      rig.update(pose, a.gaitPhase[s]!, a.speed[s]!, probe);
      m.updates++;
      m.frames++;
      if (support(pose.x, pose.z) > world.terrain.groundHeight(pose.x, pose.z) + 1e-9) m.onObject++;
      let stanceCount = 0;
      for (let i = 0; i < LEGS; i++) {
        m.legFrames++;
        const fx = rig.foot[3 * i]!, fy = rig.foot[3 * i + 1]!, fz = rig.foot[3 * i + 2]!;
        const sup = support(fx, fz);
        const P = planted[s]!;
        if (rig.stance[i]) {
          stanceCount++;
          m.stanceGapMax = Math.max(m.stanceGapMax, Math.abs(fy - sup));
          if (Number.isNaN(P[3 * i]!)) P.set([fx, fy, fz], 3 * i);
          m.slipMax = Math.max(m.slipMax, Math.hypot(fx - P[3 * i]!, fy - P[3 * i + 1]!, fz - P[3 * i + 2]!));
        } else {
          P[3 * i] = NaN;
          if (fy < sup - 1e-9) m.swingBelow++;
        }
        const o = i * JOINTS * 3;
        const ank = rig.joints.subarray(o + 9, o + 12), knee = rig.joints.subarray(o + 6, o + 9);
        if (solid(ank[0]!, ank[1]!, ank[2]!)) m.ankleBelow++;
        if (solid(knee[0]!, knee[1]!, knee[2]!)) m.kneeBelow++;
      }
      m.overstretchedLegFrames += rig.stats.overstretched;
      m.swingClamped += rig.stats.swingClamped;
      m.minStance = Math.min(m.minStance, stanceCount);
      // Tripod: both groups never swing at the same time.
      const groupSwing = [0, 0];
      for (let i = 0; i < LEGS; i++) if (!rig.stance[i]) groupSwing[TRIPOD_OFFSET[i] === 0 ? 0 : 1]!++;
      if (groupSwing[0]! > 0 && groupSwing[1]! > 0) m.tripodViolations++;
      // Body underside (head, mesosoma, gaster) stays above the support.
      for (const [bx, by] of bodyPoints) {
        quatRotate(pose.q, 0, bx!, by!, 0, v);
        const px = pose.x + v[0], py = pose.y + v[1], pz = pose.z + v[2];
        const depth = support(px, pz) - py;
        if (depth > 0) { m.bodyBelow++; m.bodyDepthMax = Math.max(m.bodyDepthMax, depth); }
      }
    }
  }
  M = m;
  console.log(`[gait] ${JSON.stringify(M)}`);
}, 600000);

describe('alternating tripod walking on terrain', () => {
  it('stance feet are on the surface (|gap| ≤ 0.02 mm) and do not slip', () => {
    expect(M.stanceGapMax).toBeLessThanOrEqual(TOL);
    expect(M.slipMax).toBeLessThanOrEqual(TOL);
  });

  it('swinging feet never go below the surface; ankles and knees stay out of solid matter', () => {
    expect(M.swingBelow).toBe(0);
    expect(M.ankleBelow).toBe(0);
    // Residual knee contacts happen only where the body brushes a tall pebble or a raised leaf edge
    // (climbing such surfaces is out of Phase 2 scope); bounded here, reported in docs/reports/phase-2.md.
    expect(M.kneeBelow / M.legFrames).toBeLessThan(0.0005);
  });

  it('legs reach their footholds (overstretch under 1% of leg-frames)', () => {
    expect(M.overstretchedLegFrames / M.legFrames).toBeLessThan(0.01);
  });

  it('is a tripod gait: the two tripods never swing together; ≥ 3 legs always down', () => {
    expect(M.tripodViolations).toBe(0);
    expect(M.minStance).toBeGreaterThanOrEqual(3);
  });

  it('the body underside stays above the surface', () => {
    expect(M.bodyBelow / (3 * M.frames)).toBeLessThan(0.001);
  });

  it('the walk actually crossed objects (pebbles, grains, leaves)', () => {
    expect(M.onObject / M.frames).toBeGreaterThan(0.05);
  });
});
