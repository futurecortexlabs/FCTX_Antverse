/**
 * Foraging trips between a nest and a feeder (Phase 3, Phase 4):
 * - resting ants leave the nest one by one at a constant rate (ASM-FOR-001);
 * - a searching ant that reaches the feeder takes food, remembers the site
 *   by its path-integration estimate and turns back;
 * - a searching ant that has found nothing gives up after a while and heads
 *   home (ASM-FOR-002); one that has run off its food vector without finding
 *   the food searches around that point meanwhile (searchTime > 0);
 * - a returning ant whose home vector has run off without the nest in reach
 *   starts a systematic search (ASM-NAV-004);
 * - an ant that reaches the nest unloads, resets its estimate there and goes
 *   out again.
 * The true nest and feeder are only used for *contact*: an ant knows it is at
 * the nest or at the food when it is there (ASM-NAV-005). Without a nest
 * (open ground before Phase 6) this rule does nothing.
 */

import { PI } from '../../core/dmath.ts';
import { rand, Stream } from '../../core/rng.ts';
import { AgentFlag, AgentState, CarryKind } from '../agents/store.ts';
import type { Site, World } from '../world.ts';
import { startTrip } from './navigate.ts';

const inside = (x: number, z: number, c: Site): boolean => (x - c.x) * (x - c.x) + (z - c.z) * (z - c.z) <= c.r * c.r;

export function forage(world: World, from: number, to: number): void {
  const nest = world.nest;
  if (!nest) return;
  const feeder = world.feeder;
  const a = world.agents.a;
  const { dt } = world.config.sim;
  const fc = world.config.forage;
  const leave = fc.exitRate * dt;
  const end2 = fc.vectorEnd * fc.vectorEnd;
  for (let s = from; s < to; s++) {
    if ((a.flags[s]! & AgentFlag.ALIVE) === 0) continue;
    const state = a.state[s]!;
    if (state === AgentState.REST) {
      if (rand(world.seed, Stream.NEST_EXIT, s, world.tick) < leave) {
        a.state[s] = AgentState.SEARCH;
        startTrip(world, s);
      }
      continue;
    }
    a.tripTime[s] = a.tripTime[s]! + dt;
    const x = a.posX[s]!, z = a.posZ[s]!;
    if ((state === AgentState.RETURN || state === AgentState.NEST_SEARCH) && inside(x, z, nest)) {
      // Home: unload and go out again.
      a.state[s] = AgentState.SEARCH;
      a.carryKind[s] = CarryKind.NONE;
      a.heading[s] = a.heading[s]! + PI;
      a.turnRate[s] = 0;
      startTrip(world, s);
    } else if (state === AgentState.SEARCH && feeder && inside(x, z, feeder)) {
      a.state[s] = AgentState.RETURN;
      a.carryKind[s] = CarryKind.FOOD;
      a.flags[s] = a.flags[s]! | AgentFlag.KNOWS_FOOD;
      a.foodX[s] = a.piX[s]!;
      a.foodZ[s] = a.piZ[s]!;
      a.searchTime[s] = 0;
      a.flags[s] = a.flags[s]! & ~AgentFlag.LOOP_BACK;
      a.heading[s] = a.heading[s]! + PI;
      a.turnRate[s] = 0;
    } else if (state === AgentState.SEARCH && a.tripTime[s]! > a.giveUp[s]!) {
      a.state[s] = AgentState.RETURN; // nothing found: home without food
      a.searchTime[s] = 0;
      a.flags[s] = a.flags[s]! & ~AgentFlag.LOOP_BACK;
    } else if (state === AgentState.SEARCH && (a.flags[s]! & AgentFlag.KNOWS_FOOD) !== 0) {
      if (a.searchTime[s]! > 0) a.searchTime[s] = a.searchTime[s]! + dt;
      else {
        const gx = a.foodX[s]! - a.piX[s]!, gz = a.foodZ[s]! - a.piZ[s]!;
        if (gx * gx + gz * gz < end2) a.searchTime[s] = dt; // food vector run off: start searching here
      }
    } else if (state === AgentState.RETURN && a.piX[s]! * a.piX[s]! + a.piZ[s]! * a.piZ[s]! < end2) {
      a.state[s] = AgentState.NEST_SEARCH;
      a.searchTime[s] = 0;
      a.flags[s] = a.flags[s]! & ~AgentFlag.LOOP_BACK;
    } else if (state === AgentState.NEST_SEARCH) {
      a.searchTime[s] = a.searchTime[s]! + dt;
    }
  }
}
