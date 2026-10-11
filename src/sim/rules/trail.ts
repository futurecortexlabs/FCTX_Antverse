/**
 * Trail following (osmotropotaxis) and homing bias.
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
 * takes precedence over chemical or navigational steering.
 *
 * Foragers also keep a heading towards their goal (ASM-NAV-001): the nest
 * when returning with food, the remembered food site when going out again.
 * This stands in for path integration until Phase 4 models the vectors and
 * their errors. Where the walkway first leads away from the goal, this bias
 * presses the ant against the edge, so it either follows the edge round or
 * turns back. Foragers walking away from their goal also make U-turns, more
 * often the larger the error (ASM-NAV-002) — as on the long branch of the
 * double bridge where it leads away from the nest (Beckers et al. 1992).
 */

import { datan2, dcos, dsin, PI } from '../../core/dmath.ts';
import { rand, Stream } from '../../core/rng.ts';
import { AgentFlag, AgentState } from '../agents/store.ts';
import type { World } from '../world.ts';

export function trail(world: World, from: number, to: number): void {
  const field = world.pheromone;
  const { config } = world;
  const a = world.agents.a;
  const tc = config.trail;
  const L = config.ant.workerBodyLength;
  const ahead = tc.sensorAhead * L, side = tc.sensorSide * L;
  const bridge = world.bridge;
  const vector = config.forage.vectorGain;
  const uturn = config.forage.uturnRate * config.sim.dt;

  for (let s = from; s < to; s++) {
    if ((a.flags[s]! & AgentFlag.ALIVE) === 0) continue;
    const x = a.posX[s]!, z = a.posZ[s]!;
    let h = a.heading[s]!;
    let steer = 0;
    if (field) {
      const fx = dcos(h), fz = -dsin(h), rx = dsin(h), rz = dcos(h);
      const cl = field.sample(x + fx * ahead - rx * side, z + fz * ahead - rz * side);
      const cr = field.sample(x + fx * ahead + rx * side, z + fz * ahead + rz * side);
      // Left turns are positive heading changes (towards −Z when facing +X).
      if (cl + cr > 0) steer += tc.gain * ((cl - cr) / (cl + cr + tc.floor));
    }
    if (bridge && a.state[s] !== AgentState.REST) {
      const goal = a.state[s] === AgentState.RETURN ? bridge.nest : (a.flags[s]! & AgentFlag.KNOWS_FOOD) !== 0 ? bridge.feeder : null;
      if (goal) {
        // Heading pointing at the goal: forward (cos h, −sin h) ∥ (goal − pos).
        let err = datan2(-(goal.z - z), goal.x - x) - h;
        if (err > PI) err -= 2 * PI; else if (err < -PI) err += 2 * PI;
        if (rand(world.seed, Stream.UTURN, s, world.tick) < uturn * (1 - dcos(err)) / 2) {
          h += h > 0 ? -PI : PI;
          a.heading[s] = h;
          a.turnRate[s] = 0;
          steer = 0;
        } else {
          steer += vector * err;
        }
      }
    }
    a.steer[s] = steer;
  }
}

/**
 * Lay pheromone for the distance just walked (applied by World.completeStep,
 * in slot order). Trail is laid between nest and food, not inside the nest
 * or feeding arenas (ASM-PHE-003): those stand for the nest interior / food
 * site, where a trail would only lead ants in circles.
 */
export function layTrail(world: World, from: number, to: number): void {
  if (!world.pheromone) return;
  const a = world.agents.a;
  const pc = world.config.pheromone;
  const bridge = world.bridge;
  for (let s = from; s < to; s++) {
    if ((a.flags[s]! & AgentFlag.ALIVE) === 0) { a.deposit[s] = 0; continue; }
    const x = a.posX[s]!, z = a.posZ[s]!;
    if (bridge && (bridge.inNest(x, z) || bridge.inFeeder(x, z))) { a.deposit[s] = 0; continue; }
    const rate = a.state[s] === AgentState.RETURN ? pc.depositReturn : pc.depositSearch;
    a.deposit[s] = rate * a.lastStep[s]!;
  }
}
