/**
 * Trail following (osmotropotaxis) and trail laying.
 *
 * Each antenna tip samples the trail pheromone, and the ant turns towards the
 * stronger side at a rate proportional to the Weber contrast (L − R)/(L + R)
 * (Perna et al. 2012, ASM-SEN-003). A sensory floor in the denominator
 * (ASM-SEN-004) makes faint trails weak cues; it plays the part of the
 * constant k in the choice function fitted to double-bridge data
 * (Deneubourg et al. 1990), without which the first ant's faint trail would
 * already decide the colony's choice. This is the only way pheromone affects movement:
 * which branch a colony uses is not encoded anywhere — it emerges from many
 * such local turns on a field the ants themselves lay.
 *
 * The result is a turning *request* (agents.steer): explore applies it only
 * while the way ahead is walkable, so touching an edge or obstacle always
 * takes precedence over chemical or navigational steering. This rule starts
 * each tick's request; navigate.ts adds the path-integration goal to it.
 */

import { dcos, dsin } from '../../core/dmath.ts';
import { AgentFlag, AgentState, CarryKind } from '../agents/store.ts';
import type { World } from '../world.ts';

export function trail(world: World, from: number, to: number): void {
  const field = world.pheromone;
  const a = world.agents.a;
  if (!field) {
    for (let s = from; s < to; s++) a.steer[s] = 0;
    return;
  }
  const tc = world.config.trail;
  const L = world.config.ant.workerBodyLength;
  const ahead = tc.sensorAhead * L, side = tc.sensorSide * L;

  for (let s = from; s < to; s++) {
    a.steer[s] = 0;
    if ((a.flags[s]! & (AgentFlag.ALIVE | AgentFlag.UNDERGROUND)) !== AgentFlag.ALIVE) continue; // dead, or in the nest
    const x = a.posX[s]!, z = a.posZ[s]!, h = a.heading[s]!;
    const fx = dcos(h), fz = -dsin(h), rx = dsin(h), rz = dcos(h);
    const cl = field.sample(x + fx * ahead - rx * side, z + fz * ahead - rz * side);
    const cr = field.sample(x + fx * ahead + rx * side, z + fz * ahead + rz * side);
    // Left turns are positive heading changes (towards −Z when facing +X).
    if (cl + cr > 0) a.steer[s] = tc.gain * ((cl - cr) / (cl + cr + tc.floor));
  }
}

/**
 * Lay pheromone for the distance just walked (applied by World.completeStep,
 * in slot order): more when carrying food home (ASM-PHE-002). Trail is laid
 * between nest and food, not inside the nest or feeding arenas (ASM-PHE-003):
 * those stand for the nest interior / food site, where a trail would only
 * lead ants in circles.
 */
export function layTrail(world: World, from: number, to: number): void {
  if (!world.pheromone) return;
  const a = world.agents.a;
  const pc = world.config.pheromone;
  const bridge = world.bridge;
  for (let s = from; s < to; s++) {
    const st = a.state[s]!;
    // Only foraging trips lay trail (not diggers carrying soil, nor anyone in the nest).
    if ((a.flags[s]! & (AgentFlag.ALIVE | AgentFlag.UNDERGROUND)) !== AgentFlag.ALIVE
      || (st !== AgentState.SEARCH && st !== AgentState.RETURN && st !== AgentState.NEST_SEARCH)) { a.deposit[s] = 0; continue; }
    const x = a.posX[s]!, z = a.posZ[s]!;
    if (bridge && (bridge.inNest(x, z) || bridge.inFeeder(x, z))) { a.deposit[s] = 0; continue; }
    const rate = a.carryKind[s] === CarryKind.FOOD ? pc.depositReturn : pc.depositSearch;
    a.deposit[s] = rate * a.lastStep[s]!;
  }
}
