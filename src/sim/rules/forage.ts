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
 * In a colony (Phase 6) there are several feeders; a forager fills its crop
 * there (a FILL request), and back at the entrance it goes down into the
 * nest to pass the food on (UNLOAD, tend.ts); one climbing out of the nest
 * to forage (EXIT) starts its trip on reaching the surface.
 * The true nest and feeder are only used for *contact*: an ant knows it is at
 * the nest or at the food when it is there (ASM-NAV-005). Without a nest
 * (open ground before Phase 6) this rule does nothing.
 */

import { PI } from '../../core/dmath.ts';
import { rand, Stream } from '../../core/rng.ts';
import { AgentFlag, AgentState, CarryKind, Request } from '../agents/store.ts';
import type { Site, World } from '../world.ts';
import { enterSoil } from './burrow.ts';
import { startTrip } from './navigate.ts';

const inside = (x: number, z: number, c: Site): boolean => (x - c.x) * (x - c.x) + (z - c.z) * (z - c.z) <= c.r * c.r;

function atFeeder(x: number, z: number, feeders: readonly Site[]): boolean {
  for (const f of feeders) if (inside(x, z, f)) return true;
  return false;
}

export function forage(world: World, from: number, to: number): void {
  const nest = world.nest;
  if (!nest) return;
  const feeders = world.colony ? world.colony.feeders : world.feeder ? [world.feeder] : [];
  const colony = world.colony !== null;
  const soil = world.soil;
  const a = world.agents.a;
  const { dt } = world.config.sim;
  const fc = world.config.forage;
  const leave = fc.exitRate * dt;
  const end2 = fc.vectorEnd * fc.vectorEnd;
  for (let s = from; s < to; s++) {
    if ((a.flags[s]! & AgentFlag.ALIVE) === 0 || (a.flags[s]! & AgentFlag.UNDERGROUND) !== 0) continue;
    const state = a.state[s]!;
    if (state === AgentState.EXIT) {
      // Out of the nest: start a foraging trip from here.
      a.state[s] = AgentState.SEARCH;
      startTrip(world, s);
      continue;
    }
    if (state === AgentState.REST) {
      if (rand(world.seed, Stream.NEST_EXIT, s, world.tick) < leave) {
        // Out to forage — or, where the nest is being dug, off to the entrance to start digging.
        a.state[s] = world.soil ? AgentState.REENTER : AgentState.SEARCH;
        startTrip(world, s);
      }
      continue;
    }
    a.tripTime[s] = a.tripTime[s]! + dt;
    const x = a.posX[s]!, z = a.posZ[s]!;
    if ((state === AgentState.RETURN || state === AgentState.NEST_SEARCH) && inside(x, z, nest) && colony) {
      // Home: down into the nest to pass the crop's food on.
      const ix = soil!.voxelX(nest.x), iz = soil!.voxelZ(nest.z);
      const loaded = a.carryKind[s] === CarryKind.FOOD;
      enterSoil(world, s, ix, soil!.airTop[ix + iz * soil!.nx]!, iz);
      a.state[s] = AgentState.UNLOAD;
      a.carryKind[s] = CarryKind.NONE;
      // searchTime times the unloading; back without food there is nothing to unload.
      a.searchTime[s] = loaded ? 0 : world.config.colony.unloadTime;
    } else if ((state === AgentState.RETURN || state === AgentState.NEST_SEARCH) && inside(x, z, nest)) {
      // Home: unload and go out again.
      a.state[s] = AgentState.SEARCH;
      a.carryKind[s] = CarryKind.NONE;
      a.heading[s] = a.heading[s]! + PI;
      a.turnRate[s] = 0;
      startTrip(world, s);
    } else if (state === AgentState.SEARCH && atFeeder(x, z, feeders)) {
      if (colony) a.request[s] = Request.FILL;
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
