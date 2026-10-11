/**
 * Exploratory walking: a correlated random walk at the individual's own
 * speed, turning away from obstacles too tall to step onto.
 * (ASM-BEH-001, ASM-LOC-001/002, ASM-SEN-002, ASM-LOC-008)
 *
 * Without information (no pheromone, no target), ants explore with gradually
 * wandering headings; this is the baseline that later rules (trail following,
 * homing) will bias. The turning rate wanders smoothly (Ornstein–Uhlenbeck,
 * turnRateSd and turnTau), so the heading changes smoothly too; the body stays in
 * the arena by turning back at its edge; the gait phase advances by distance
 * walked over stride length, so legs never slide.
 *
 * At the edge of a walkway (the double bridge), where one side is clearly
 * open, the ant turns towards it without stopping, walking along the edge
 * (wall following, ASM-LOC-008); against a wall straight ahead it stops and
 * turns as before.
 *
 * When the side probes do not clearly favour one way, an ant that has
 * started turning away from an obstacle keeps turning the same way until it
 * can walk on: re-choosing every step made ants whose two side probes looked
 * alike rock back and forth in place for good. A clear choice (one side
 * walkable, the other not) is still followed at once.
 *
 * Guidance rules (trail following, homing) request a turning rate in
 * agents.steer; it is added to the random turning while the way ahead is free.
 *
 * Obstacles: the antennae probe the support surface probeDistance ahead. If it
 * rises more than maxClimb — unless it is a slope no steeper than maxSlope,
 * like the side of a sand pile — or drops more than maxDrop, from the ground
 * under the body (a pebble wall or a deep ledge), the ant stops and turns towards
 * whichever side probe is closer to its own level. Walking around large
 * pebbles emerges from this local contact rule (climbing steep faces is not
 * modelled yet). Climbing down is easier than climbing up (ASM-LOC-008):
 * with a symmetric limit, ants that walked onto an object by a gentle side
 * were stranded on top of it.
 */

import { datan2, dcos, dexp, dsin, PI } from '../../core/dmath.ts';
import { randNormal, Stream } from '../../core/rng.ts';
import { strideLength } from '../../locomotion/morphology.ts';
import { AgentFlag, AgentState } from '../agents/store.ts';
import type { World } from '../world.ts';

export function explore(world: World, from: number, to: number): void {
  const { agents, seed, tick, config } = world;
  const a = agents.a;
  const dt = config.sim.dt;
  const half = config.world.arenaSize * 0.5;
  const ex = config.explore;
  // Exact OU update over one step: ω' = ω·decay + sd·√(1 − decay²)·N(0,1).
  const decay = dexp(-dt / ex.turnTau);
  const kick = ex.turnRateSd * Math.sqrt(1 - decay * decay);
  const probe = ex.probeDistance * config.ant.workerBodyLength;
  const ride = config.locomotion.rideHeight;
  // Mid-leg neutral lateral offset: radius of the feet's circle when turning on the spot.
  const turnRadius = config.locomotion.neutralFoot[3]! * config.ant.workerBodyLength;

  for (let s = from; s < to; s++) {
    if ((a.flags[s]! & (AgentFlag.ALIVE | AgentFlag.UNDERGROUND)) !== AgentFlag.ALIVE) continue; // dead, or in the soil (burrow.ts)
    if (a.state[s] === AgentState.REST) { a.lastStep[s] = 0; a.stepX[s] = 0; a.stepZ[s] = 0; continue; }
    const omega = a.turnRate[s]! * decay + kick * randNormal(seed, Stream.EXPLORE_STEP, s, tick);
    a.turnRate[s] = omega;
    const free = a.heading[s]! + omega * dt;
    let h = free + a.steer[s]! * dt;
    const x0 = a.posX[s]!, z0 = a.posZ[s]!;
    const here = a.posY[s]! - ride;
    const ahead = world.terrain.supportHeight(x0 + probe * dcos(h), z0 - probe * dsin(h));
    // Turning away while blocked: +1 left, −1 right, 0 = free to walk on. Remembered in avoidTurn.
    const keep = a.avoidTurn[s]!;
    let turn = 0;
    // Along an edge with the open side clear, the ant keeps walking while it turns (wall following).
    let slide = false;
    const nx = x0 + probe * dcos(h), nz = z0 - probe * dsin(h);
    const bridge = world.bridge;
    const stride = a.speed[s]! * dt;
    if (bridge && (!bridge.walkable(nx, nz) || !bridge.walkable(x0 + stride * dcos(h), z0 - stride * dsin(h)))) {
      // Apparatus edge (ahead, or right in front, e.g. at the inside of a
      // corner): turn towards the side whose probe stays on the walkway
      // (keep the current turning direction if both or neither do).
      const okL = bridge.walkable(x0 + probe * dcos(h + ex.probeAngle), z0 - probe * dsin(h + ex.probeAngle));
      const okR = bridge.walkable(x0 + probe * dcos(h - ex.probeAngle), z0 - probe * dsin(h - ex.probeAngle));
      turn = okL !== okR ? (okL ? 1 : -1) : keep !== 0 ? keep : (omega >= 0 ? 1 : -1);
      if (okL !== okR) {
        const ht = free + turn * ex.avoidTurnRate * dt;
        slide = bridge.walkable(x0 + stride * dcos(ht), z0 - stride * dsin(ht));
      }
    } else if (!bridge && (nx > half || nx < -half || nz > half || nz < -half)) {
      // The arena edge is treated like an obstacle: turn back inside instead of reflecting.
      // Turn the way that brings the heading towards the arena centre.
      const toCentre = datan2(z0, -x0); // heading pointing at the origin: forward (cos h, -sin h) ∥ (-x0, -z0)
      let diff = toCentre - h;
      if (diff > PI) diff -= 2 * PI; else if (diff < -PI) diff += 2 * PI;
      turn = diff > 0 ? 1 : -1;
    } else if ((ahead - here > ex.maxClimb && ahead - here > ex.maxSlope * probe) || here - ahead > ex.maxDrop) {
      // +angle turns left (towards -Z when facing +X).
      const left = world.terrain.supportHeight(x0 + probe * dcos(h + ex.probeAngle), z0 - probe * dsin(h + ex.probeAngle));
      const right = world.terrain.supportHeight(x0 + probe * dcos(h - ex.probeAngle), z0 - probe * dsin(h - ex.probeAngle));
      // Two heights compared: no clear answer when they are alike, so keep the way already chosen.
      turn = keep !== 0 ? keep : Math.abs(left - here) < Math.abs(right - here) ? 1 : -1;
    }
    if (turn !== 0) h = free + turn * ex.avoidTurnRate * dt;
    const blocked = turn !== 0 && !slide;
    a.avoidTurn[s] = slide ? 0 : turn;
    // Turning on the spot is walked too: the feet travel the arc at the stance radius.
    const turnArc = blocked ? ex.avoidTurnRate * dt * turnRadius : 0;
    const v = a.speed[s]!;
    const step = blocked ? 0 : v * dt;
    let x = x0 + step * dcos(h);
    let z = z0 - step * dsin(h);
    // Never step off the apparatus.
    if (bridge && !bridge.walkable(x, z)) { x = x0; z = z0; }
    // Mirror at the arena walls.
    if (x > half) { x = 2 * half - x; h = PI - h; }
    else if (x < -half) { x = -2 * half - x; h = PI - h; }
    if (z > half) { z = 2 * half - z; h = -h; }
    else if (z < -half) { z = -2 * half - z; h = -h; }
    if (h > PI) h -= 2 * PI;
    else if (h < -PI) h += 2 * PI;
    a.stepX[s] = x - x0;
    a.stepZ[s] = z - z0;
    a.lastStep[s] = Math.sqrt((x - x0) * (x - x0) + (z - z0) * (z - z0));
    a.posX[s] = x;
    a.posZ[s] = z;
    a.heading[s] = h;
    const phase = a.gaitPhase[s]! + (step + turnArc) / strideLength(config, v);
    a.gaitPhase[s] = phase - Math.floor(phase);
  }
}
