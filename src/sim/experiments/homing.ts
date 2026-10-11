/**
 * Phase 4 homing experiments (observation and experimenter actions only):
 * one forager is released from the nest on open ground with no pheromone.
 * It searches (a tortuous path) until it finds the feeder or gives up, then
 * heads home by path integration.
 *
 * - normal: does it get back into the nest within experiment.homingLimit?
 * - displaced: at the moment it turns for home, the experimenter moves it by
 *   experiment.displacement in a random direction (the classic displacement
 *   test). A path integrator runs its home vector to the *fictive* nest —
 *   where the nest would be had it not been moved — and searches there.
 */

import { dcos, dhypot, dsin, PI } from '../../core/dmath.ts';
import { rand, Stream } from '../../core/rng.ts';
import type { Config } from '../../config/params.ts';
import { AgentState, CarryKind } from '../agents/store.ts';
import { startTrip } from '../rules/navigate.ts';
import { World } from '../world.ts';

/** Trajectory sample: x, z, state. */
export type Sample = [number, number, number];

export interface HomingResult {
  seed: number;
  displaced: boolean;
  foundFood: boolean;
  /** Outbound path length and the largest distance from the nest (mm). */
  outboundLength: number;
  maxDistance: number;
  /** True distance from the (fictive) nest when the return began (mm). */
  homeDistance: number;
  /** Reached the real nest, and how long after the return began (s). */
  reached: boolean;
  timeToNest: number;
  /** Where the home vector ran off, relative to the (fictive) nest (mm); null if the nest was reached first. */
  vectorEndError: number | null;
  /** Straight-line distance / path length from the start of the return to the vector's end (or the nest). */
  straightness: number;
  /** Centre of the first searchWindow seconds of nest search: distance to the fictive nest and to the real nest (mm). */
  searchCentreToFictive: number | null;
  searchCentreToReal: number | null;
  /** Down-sampled trajectory (every SAMPLE_TICKS); the return begins at path[returnIndex]. */
  path: Sample[];
  returnIndex: number;
  /** The fictive nest (= the nest unless displaced) and the feeder, for plotting. */
  fictive: [number, number];
  feeder: [number, number, number] | null;
}

const SAMPLE_TICKS = 15;
/** Sub-key of Stream.SCENARIO (entity 1) for the displacement direction. */
const DISPLACE_KEY = 0;
const DISPLACE_ENTITY = 1;

export function runHomingTrial(config: Config, displaced: boolean): HomingResult {
  const ex = config.experiment;
  const dt = config.sim.dt;
  const world = new World(config);
  const nest = world.nest!;
  const a = world.agents.a;
  const s = 0;
  // Release: the ant leaves the nest at once (instead of waiting for its exit time).
  a.state[s] = AgentState.SEARCH;
  startTrip(world, s);

  let fictiveX = nest.x, fictiveZ = nest.z;
  let outboundLength = 0, maxDistance = 0, returnLength = 0;
  let returnTick = -1, returnX = 0, returnZ = 0, returnIndex = 0;
  let foundFood = false, reached = false, timeToNest = 0;
  let vectorEnd: [number, number] | null = null;
  let arrival: [number, number] | null = null;
  let searchSum: [number, number, number] = [0, 0, 0];
  const path: Sample[] = [];
  const maxTicks = Math.round((ex.homingLimit + config.forage.giveUp[1]!) / dt);
  for (let t = 0; t < maxTicks; t++) {
    const prev = a.state[s]!;
    world.step();
    const x = a.posX[s]!, z = a.posZ[s]!, st = a.state[s]!;
    if (t % SAMPLE_TICKS === 0) path.push([x, z, st]);
    if (returnTick < 0) {
      outboundLength += a.lastStep[s]!;
      maxDistance = Math.max(maxDistance, dhypot(x - nest.x, z - nest.z));
      if (st === AgentState.RETURN) {
        returnTick = t;
        returnIndex = path.length;
        foundFood = a.carryKind[s] === CarryKind.FOOD;
        if (displaced) {
          const ang = rand(world.seed, Stream.SCENARIO, DISPLACE_ENTITY, 0, DISPLACE_KEY) * 2 * PI;
          const dx = ex.displacement * dcos(ang), dz = -ex.displacement * dsin(ang);
          a.posX[s] = x + dx;
          a.posZ[s] = z + dz;
          fictiveX += dx;
          fictiveZ += dz;
        }
        returnX = a.posX[s]!;
        returnZ = a.posZ[s]!;
      }
      continue;
    }
    if (!vectorEnd) returnLength += a.lastStep[s]!;
    if (prev !== AgentState.NEST_SEARCH && st === AgentState.NEST_SEARCH) vectorEnd = [x, z];
    if (st === AgentState.NEST_SEARCH && a.searchTime[s]! <= ex.searchWindow) {
      searchSum = [searchSum[0] + x, searchSum[1] + z, searchSum[2] + 1];
    }
    if ((prev === AgentState.RETURN || prev === AgentState.NEST_SEARCH) && st === AgentState.SEARCH) {
      reached = true;
      arrival = [x, z];
      timeToNest = (t - returnTick) * dt;
      break;
    }
    if ((t - returnTick) * dt > ex.homingLimit) break;
  }
  // The homeward run ends where the vector ran off, or where the ant entered the nest.
  const end = vectorEnd ?? arrival ?? [a.posX[s]!, a.posZ[s]!];
  const endX = end[0], endZ = end[1];
  const centre = searchSum[2] > 0 ? [searchSum[0] / searchSum[2], searchSum[1] / searchSum[2]] as const : null;
  return {
    seed: config.sim.seed,
    displaced,
    foundFood,
    outboundLength,
    maxDistance,
    homeDistance: dhypot(returnX - fictiveX, returnZ - fictiveZ),
    reached,
    timeToNest,
    vectorEndError: vectorEnd ? dhypot(vectorEnd[0] - fictiveX, vectorEnd[1] - fictiveZ) : null,
    straightness: returnLength > 0 ? dhypot(endX - returnX, endZ - returnZ) / returnLength : 1,
    searchCentreToFictive: centre ? dhypot(centre[0] - fictiveX, centre[1] - fictiveZ) : null,
    searchCentreToReal: centre ? dhypot(centre[0] - nest.x, centre[1] - nest.z) : null,
    path,
    returnIndex,
    fictive: [fictiveX, fictiveZ],
    feeder: world.feeder ? [world.feeder.x, world.feeder.z, world.feeder.r] : null,
  };
}
