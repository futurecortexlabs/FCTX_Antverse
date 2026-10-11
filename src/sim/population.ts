/**
 * Initial placement of workers (until the colony life cycle of Phase 6):
 * uniformly in the arena — but not on top of objects taller than an ant can
 * step down from (explore.maxClimb) — with random heading and gait phase,
 * individual walking speed spread around the mean (ASM-LOC-001), and the body
 * settled onto the terrain.
 */

import { PI } from '../core/dmath.ts';
import { rand, Stream } from '../core/rng.ts';
import { Caste } from './agents/store.ts';
import { bodyPoseRange } from './rules/body-pose.ts';
import type { World } from './world.ts';

const K = { X: 0, Z: 1, HEADING: 2, PHASE: 3, SPEED: 4 } as const;
/** Placement attempts per worker (sub-keys 8, 10, 12, … for x and 9, 11, 13, … for z). */
const PLACE_TRIES = 16;
const PLACE_KEY = 8;

export function spawnWorkers(world: World, count: number): void {
  const { agents, seed, config } = world;
  const half = config.world.arenaSize / 2;
  const lc = config.locomotion;
  const first = agents.highWater;
  for (let i = 0; i < count; i++) {
    const s = agents.spawn(Caste.WORKER);
    const a = agents.a;
    const r = (k: number): number => rand(seed, Stream.AGENT_INIT, s, 0, k);
    let x = (r(K.X) * 2 - 1) * half, z = (r(K.Z) * 2 - 1) * half;
    for (let k = 0; k < PLACE_TRIES && world.terrain.supportHeight(x, z) - world.terrain.groundHeight(x, z) > config.explore.maxClimb; k++) {
      x = (r(PLACE_KEY + 2 * k) * 2 - 1) * half;
      z = (r(PLACE_KEY + 2 * k + 1) * 2 - 1) * half;
    }
    a.posX[s] = x;
    a.posZ[s] = z;
    a.heading[s] = (r(K.HEADING) * 2 - 1) * PI;
    a.gaitPhase[s] = r(K.PHASE);
    a.speed[s] = lc.speed * (1 + lc.speedSpread * (r(K.SPEED) * 2 - 1));
  }
  // Settle twice: the second pass samples the support where the first pass's pitch put the segments.
  bodyPoseRange(world, first, agents.highWater, 1);
  bodyPoseRange(world, first, agents.highWater, 1);
}
