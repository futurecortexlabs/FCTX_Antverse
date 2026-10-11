/**
 * Foraging trips in an apparatus with a nest and a feeder (Phase 3):
 * resting ants leave the nest one by one at a constant rate (ASM-FOR-001),
 * a searching ant that reaches the feeder takes food and turns back;
 * a returning ant that reaches the nest unloads and goes out again.
 * The about-turn is the U-turn every forager makes at either end.
 * Outside a scenario with a feeder (open ground) this rule does nothing yet.
 */

import { PI } from '../../core/dmath.ts';
import { rand, Stream } from '../../core/rng.ts';
import { AgentFlag, AgentState, CarryKind } from '../agents/store.ts';
import type { World } from '../world.ts';

export function forage(world: World, from: number, to: number): void {
  const bridge = world.bridge;
  if (!bridge) return;
  const a = world.agents.a;
  const leave = world.config.forage.exitRate * world.config.sim.dt;
  for (let s = from; s < to; s++) {
    if ((a.flags[s]! & AgentFlag.ALIVE) === 0) continue;
    const x = a.posX[s]!, z = a.posZ[s]!;
    if (a.state[s] === AgentState.REST) {
      if (rand(world.seed, Stream.NEST_EXIT, s, world.tick) < leave) a.state[s] = AgentState.SEARCH;
    } else if (a.state[s] === AgentState.SEARCH && bridge.inFeeder(x, z)) {
      a.state[s] = AgentState.RETURN;
      a.carryKind[s] = CarryKind.FOOD;
      a.flags[s] = a.flags[s]! | AgentFlag.KNOWS_FOOD;
      a.heading[s] = a.heading[s]! + PI;
      a.turnRate[s] = 0;
    } else if (a.state[s] === AgentState.RETURN && bridge.inNest(x, z)) {
      a.state[s] = AgentState.SEARCH;
      a.carryKind[s] = CarryKind.NONE;
      a.heading[s] = a.heading[s]! + PI;
      a.turnRate[s] = 0;
    }
  }
}
