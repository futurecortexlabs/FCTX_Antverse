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
 * Obstacles: the antennae probe the support surface probeDistance ahead. If it
 * rises or drops more than maxClimb from the ground under the body (a pebble
 * wall or ledge), the ant stops and turns towards whichever side probe is
 * closer to its own level. Walking around large pebbles emerges from this
 * local contact rule (climbing steep faces is not modelled yet).
 */

import { datan2, dcos, dexp, dsin, PI } from '../../core/dmath.ts';
import { randNormal, Stream } from '../../core/rng.ts';
import { strideLength } from '../../locomotion/morphology.ts';
import { AgentFlag } from '../agents/store.ts';
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
    if ((a.flags[s]! & AgentFlag.ALIVE) === 0) continue;
    const omega = a.turnRate[s]! * decay + kick * randNormal(seed, Stream.EXPLORE_STEP, s, tick);
    a.turnRate[s] = omega;
    let h = a.heading[s]! + omega * dt;
    const x0 = a.posX[s]!, z0 = a.posZ[s]!;
    const here = a.posY[s]! - ride;
    const ahead = world.terrain.supportHeight(x0 + probe * dcos(h), z0 - probe * dsin(h));
    let blocked = false;
    // The arena edge is treated like an obstacle: turn back inside instead of reflecting.
    const nx = x0 + probe * dcos(h), nz = z0 - probe * dsin(h);
    if (nx > half || nx < -half || nz > half || nz < -half) {
      // Turn the way that brings the heading towards the arena centre.
      const toCentre = datan2(z0, -x0); // heading pointing at the origin: forward (cos h, -sin h) ∥ (-x0, -z0)
      let diff = toCentre - h;
      if (diff > PI) diff -= 2 * PI; else if (diff < -PI) diff += 2 * PI;
      h += (diff > 0 ? 1 : -1) * ex.avoidTurnRate * dt;
      blocked = true;
    } else if (Math.abs(ahead - here) > ex.maxClimb) {
      // +angle turns left (towards -Z when facing +X).
      const left = world.terrain.supportHeight(x0 + probe * dcos(h + ex.probeAngle), z0 - probe * dsin(h + ex.probeAngle));
      const right = world.terrain.supportHeight(x0 + probe * dcos(h - ex.probeAngle), z0 - probe * dsin(h - ex.probeAngle));
      h += (Math.abs(left - here) < Math.abs(right - here) ? 1 : -1) * ex.avoidTurnRate * dt;
      blocked = true;
    }
    // Turning on the spot is walked too: the feet travel the arc at the stance radius.
    const turnArc = blocked ? ex.avoidTurnRate * dt * turnRadius : 0;
    const v = a.speed[s]!;
    const step = blocked ? 0 : v * dt;
    let x = x0 + step * dcos(h);
    let z = z0 - step * dsin(h);
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
    const phase = a.gaitPhase[s]! + (step + turnArc) / strideLength(config, v);
    a.gaitPhase[s] = phase - Math.floor(phase);
  }
}
