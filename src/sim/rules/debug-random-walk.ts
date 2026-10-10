/**
 * DEBUG FIXTURE — not a behavioural rule. (ENG-DBG-001)
 *
 * Correlated random walk inside a square arena, used in Phase 0 only to
 * exercise the pipeline (fixed step, seeded RNG, worker snapshots, instanced
 * rendering, benchmarks). It makes no biological claim and is removed when
 * Phase 2 introduces real locomotion.
 */

import { dcos, dsin, PI } from '../../core/dmath.ts';
import { rand, randNormal, Stream } from '../../core/rng.ts';
import { writeYawQuat } from '../../core/units.ts';
import { AgentFlag, Caste } from '../agents/store.ts';
import type { World } from '../world.ts';

export function spawnDebugWalkers(world: World, count: number): void {
  const { agents, seed } = world;
  const half = world.config.world.arenaSize * 0.5;
  const speed = world.config.debugWalk.speed;
  for (let i = 0; i < count; i++) {
    const s = agents.spawn(Caste.WORKER);
    const a = agents.a;
    a.posX[s] = (rand(seed, Stream.DEBUG_WALK_INIT, s, 0, 0) * 2 - 1) * half;
    a.posZ[s] = (rand(seed, Stream.DEBUG_WALK_INIT, s, 0, 1) * 2 - 1) * half;
    a.heading[s] = (rand(seed, Stream.DEBUG_WALK_INIT, s, 0, 2) * 2 - 1) * PI;
    a.gaitPhase[s] = rand(seed, Stream.DEBUG_WALK_INIT, s, 0, 3);
    a.speed[s] = speed;
    writeYawQuat(a.heading[s]!, a.rot, s * 4);
  }
}

export function debugRandomWalk(world: World): void {
  const { agents, seed, tick } = world;
  const a = agents.a;
  const dt = world.config.sim.dt;
  const half = world.config.world.arenaSize * 0.5;
  const { turnNoise, strideLength } = world.config.debugWalk;
  const turnSd = turnNoise * Math.sqrt(dt);

  for (let s = 0; s < agents.highWater; s++) {
    if ((a.flags[s]! & AgentFlag.ALIVE) === 0) continue;
    let h = a.heading[s]! + turnSd * randNormal(seed, Stream.DEBUG_WALK_STEP, s, tick);
    const step = a.speed[s]! * dt;
    let x = a.posX[s]! + step * dcos(h);
    let z = a.posZ[s]! - step * dsin(h);
    // Mirror at the arena walls.
    if (x > half) { x = 2 * half - x; h = PI - h; }
    else if (x < -half) { x = -2 * half - x; h = PI - h; }
    if (z > half) { z = 2 * half - z; h = -h; }
    else if (z < -half) { z = -2 * half - z; h = -h; }
    if (h > PI) h -= 2 * PI;
    else if (h < -PI) h += 2 * PI;

    a.posX[s] = x;
    a.posZ[s] = z;
    a.heading[s] = h;
    const phase = a.gaitPhase[s]! + step / strideLength;
    a.gaitPhase[s] = phase - Math.floor(phase);
    writeYawQuat(h, a.rot, s * 4);
  }
}
