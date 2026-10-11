/**
 * Initial placement of workers (until the colony life cycle of Phase 6):
 * in a foraging scenario, resting in the nest; otherwise uniformly in the
 * arena — but not on top of objects taller than an ant can step down from
 * (explore.maxClimb). Random heading and gait phase, individual walking speed
 * spread around the mean (ASM-LOC-001), a compass error drawn from its
 * stationary spread (ASM-NAV-003), and the body settled onto the terrain.
 */

import { dcos, dsin, PI } from '../core/dmath.ts';
import { rand, randNormal, Stream } from '../core/rng.ts';
import { AgentState, Caste } from './agents/store.ts';
import { bodyPoseRange } from './rules/body-pose.ts';
import type { World } from './world.ts';

const K = { X: 0, Z: 1, HEADING: 2, PHASE: 3, SPEED: 4 } as const;
/** randNormal sub-key for the initial compass error (raw keys 40–41, clear of the placement keys). */
const COMPASS_KEY = 20;
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
    let x: number, z: number;
    if (world.nest) {
      // In a foraging scenario everyone starts resting in the nest (uniform over its disc).
      a.state[s] = AgentState.REST;
      const n = world.nest, rr = n.r * Math.sqrt(r(K.X)), ang = r(K.Z) * 2 * PI;
      x = n.x + rr * dcos(ang);
      z = n.z + rr * dsin(ang);
    } else {
      x = (r(K.X) * 2 - 1) * half;
      z = (r(K.Z) * 2 - 1) * half;
      for (let k = 0; k < PLACE_TRIES && world.terrain.supportHeight(x, z) - world.terrain.groundHeight(x, z) > config.explore.maxClimb; k++) {
        x = (r(PLACE_KEY + 2 * k) * 2 - 1) * half;
        z = (r(PLACE_KEY + 2 * k + 1) * 2 - 1) * half;
      }
    }
    a.posX[s] = x;
    a.posZ[s] = z;
    a.heading[s] = (r(K.HEADING) * 2 - 1) * PI;
    a.gaitPhase[s] = r(K.PHASE);
    a.speed[s] = lc.speed * (1 + lc.speedSpread * (r(K.SPEED) * 2 - 1));
    a.compassError[s] = config.forage.compassSd * randNormal(seed, Stream.AGENT_INIT, s, 0, COMPASS_KEY);
  }
  // Settle twice: the second pass samples the support where the first pass's pitch put the segments.
  bodyPoseRange(world, first, agents.highWater, 1);
  bodyPoseRange(world, first, agents.highWater, 1);
}
