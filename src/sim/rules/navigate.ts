/**
 * Navigation by path integration (Phase 4, BIO-NAV-001).
 *
 * pathIntegrate: every forager keeps a running estimate of where it is
 * relative to the nest by adding up its own steps as it measures them — the
 * direction through a celestial compass whose error wanders slowly, the
 * distance through an odometer whose gain is off by a few percent on each
 * trip (ASM-NAV-003). The estimate is reset to the truth only at the nest,
 * where the nest itself tells the ant where it is. Nothing else ever reads
 * the true positions of the nest or the food.
 *
 * navigate: the estimate gives the goal direction (ASM-NAV-001) — home while
 * returning, the remembered food site while going out again — and the ant
 * turns towards it, or makes a U-turn when walking away from it
 * (ASM-NAV-002). When the home vector has run off without the nest in reach
 * (state NEST_SEARCH), the ant searches in loops around the point where the
 * vector ended: it walks freely until it is farther out than the current
 * search radius, then heads back until it passes close to the centre again,
 * and the radius grows as the search goes on (ASM-NAV-004; loops that start
 * and end at the centre and grow in size, Wehner & Srinivasan 1981). Going out to a remembered food site works the
 * same way: if the food is not where the food vector ends, the ant searches
 * around that point (searchTime > 0 while searching) until it finds the food
 * or gives up.
 */

import { datan2, dcos, dexp, dsin, PI } from '../../core/dmath.ts';
import { rand, randNormal, Stream } from '../../core/rng.ts';
import { AgentFlag, AgentState } from '../agents/store.ts';
import type { World } from '../world.ts';

/**
 * Sub-keys of Stream.PATH_INTEGRATION. randNormal(k) consumes raw keys 2k and
 * 2k + 1, so COMPASS uses 0–1, ODOMETER 2–3 and GIVE_UP (a plain rand) 4.
 */
export const PiKey = { COMPASS: 0, ODOMETER: 1, GIVE_UP: 4 } as const;

/** Heading error towards (gx, gz) for an ant facing h, wrapped to (−π, π]. */
function headingError(gx: number, gz: number, h: number): number {
  // Heading pointing along g: forward (cos h, −sin h) ∥ (gx, gz).
  let err = datan2(-gz, gx) - h;
  if (err > PI) err -= 2 * PI; else if (err < -PI) err += 2 * PI;
  return err;
}

export function navigate(world: World, from: number, to: number): void {
  if (!world.nest) return;
  const { config } = world;
  const fc = config.forage;
  const a = world.agents.a;
  const uturn = fc.uturnRate * config.sim.dt;

  for (let s = from; s < to; s++) {
    if ((a.flags[s]! & AgentFlag.ALIVE) === 0) continue;
    const state = a.state[s]!;
    if (state === AgentState.REST) continue;
    const px = a.piX[s]!, pz = a.piZ[s]!;
    let gx = 0, gz = 0, leash = false;
    if (state === AgentState.RETURN) {
      gx = -px; gz = -pz;
    } else if (state === AgentState.NEST_SEARCH) {
      gx = -px; gz = -pz; leash = true;
    } else if ((a.flags[s]! & AgentFlag.KNOWS_FOOD) !== 0) {
      gx = a.foodX[s]! - px; gz = a.foodZ[s]! - pz;
      leash = a.searchTime[s]! > 0; // food vector run off: searching around its end
    } else {
      continue; // a naive searcher has no goal
    }
    if (leash) {
      const r2 = gx * gx + gz * gz;
      if ((a.flags[s]! & AgentFlag.LOOP_BACK) !== 0) {
        // Heading back through the centre; the next loop starts once close to it.
        if (r2 < fc.searchRadius * fc.searchRadius) { a.flags[s] = a.flags[s]! & ~AgentFlag.LOOP_BACK; continue; }
      } else {
        const radius = fc.searchRadius + fc.searchGrowth * a.searchTime[s]!;
        if (r2 <= radius * radius) continue; // out on a loop
        a.flags[s] = a.flags[s]! | AgentFlag.LOOP_BACK;
      }
    }
    let h = a.heading[s]!;
    const err = headingError(gx, gz, h);
    if (!leash && rand(world.seed, Stream.UTURN, s, world.tick) < uturn * (1 - dcos(err)) / 2) {
      h += h > 0 ? -PI : PI;
      a.heading[s] = h;
      a.turnRate[s] = 0;
      a.steer[s] = 0;
    } else {
      a.steer[s] = a.steer[s]! + fc.vectorGain * err;
    }
  }
}

/** Add this tick's measured step to the estimate (after explore has moved the ant). */
export function pathIntegrate(world: World, from: number, to: number): void {
  if (!world.nest) return;
  const { config } = world;
  const fc = config.forage;
  const a = world.agents.a;
  // Exact OU update of the compass error over one step.
  const decay = dexp(-config.sim.dt / fc.compassTau);
  const kick = fc.compassSd * Math.sqrt(1 - decay * decay);
  for (let s = from; s < to; s++) {
    if ((a.flags[s]! & AgentFlag.ALIVE) === 0 || a.state[s] === AgentState.REST) continue;
    const e = a.compassError[s]! * decay + kick * randNormal(world.seed, Stream.PATH_INTEGRATION, s, world.tick, PiKey.COMPASS);
    a.compassError[s] = e;
    // The measured step is the true one rotated by the compass error and scaled by the odometer.
    const o = a.odometer[s]!, c = dcos(e), sn = dsin(e);
    const dx = a.stepX[s]!, dz = a.stepZ[s]!;
    a.piX[s] = a.piX[s]! + o * (dx * c + dz * sn);
    a.piZ[s] = a.piZ[s]! + o * (-dx * sn + dz * c);
  }
}

/**
 * Start a trip from the nest: the estimate is set from the nest itself, the
 * odometer gain and the give-up time are drawn for this trip.
 */
export function startTrip(world: World, s: number): void {
  const a = world.agents.a;
  const nest = world.nest!;
  const fc = world.config.forage;
  a.piX[s] = a.posX[s]! - nest.x;
  a.piZ[s] = a.posZ[s]! - nest.z;
  a.odometer[s] = 1 + fc.odometerSd * randNormal(world.seed, Stream.PATH_INTEGRATION, s, world.tick, PiKey.ODOMETER);
  const [lo, hi] = fc.giveUp as [number, number];
  a.giveUp[s] = lo + (hi - lo) * rand(world.seed, Stream.PATH_INTEGRATION, s, world.tick, PiKey.GIVE_UP);
  a.tripTime[s] = 0;
  a.searchTime[s] = 0;
  a.flags[s] = a.flags[s]! & ~AgentFlag.LOOP_BACK;
}
