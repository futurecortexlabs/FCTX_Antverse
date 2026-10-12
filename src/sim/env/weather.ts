/**
 * Rain and water drops (Phase 7), applied in World.completeStep on the
 * coordinating thread, in slot order:
 *
 * - Raindrops hit ants on the surface at the rate the rain brings drops onto
 *   their footprint (intensity / drop volume × body length × width). A hit
 *   ant is pushed a few mm and dazed for seconds (insects survive raindrop
 *   impacts because their small mass takes little momentum, BIO-ENV-003;
 *   ASM-ENV-003).
 * - Where raindrops land on surfaces that shed water (leaves, stones) water
 *   drops form; on bare soil the water soaks in (ASM-ENV-004). Touching
 *   drops merge (volumes add, up to dropMaxRadius). An ant a drop forms on is
 *   stuck in it for a while.
 * - Drops shrink by evaporation, d(r²)/dt = −k(T, humidity) (PHY-ENV-004).
 * - Rain washes trail pheromone away faster (ASM-ENV-006).
 */

import { dcos, dexp, dpow, dsin, PI, TAU } from '../../core/dmath.ts';
import { S_PER_H } from '../../core/units.ts';
import { rand, Stream } from '../../core/rng.ts';
import { AgentFlag } from '../agents/store.ts';
import type { World } from '../world.ts';

/** Sub-keys of Stream.RAIN (entity: agent slot, or DROP_ENTITY + k for the k-th drop formed in a tick). */
const Key = { HIT: 0, STUN: 1, ANGLE: 2, DIST: 3, HEADING: 4, FORM: 5, X: 6, Z: 7, R: 8, TRAP: 9 } as const;
const DROP_ENTITY = 1 << 24;
/** Volume of a sphere of diameter d: π d³ / 6. */
const SPHERE = PI / 6;

export function weather(world: World): void {
  const drops = world.drops;
  if (!drops) return;
  const cfg = world.config, e = cfg.env, c = world.climate, dt = cfg.sim.dt, a = world.agents.a;
  const ride = cfg.locomotion.rideHeight;
  let changed = false;
  if (c.rain > 0) {
    // Raindrops per mm² per second, and the chance one lands on an ant this tick.
    const flux = c.rain / S_PER_H / (SPHERE * e.rainDrop * e.rainDrop * e.rainDrop);
    const L = cfg.ant.workerBodyLength;
    const pHit = flux * L * L * e.antWidth * dt;
    const [s0, s1] = e.rainStun as readonly [number, number];
    for (let s = 0; s < world.agents.highWater; s++) {
      if ((a.flags[s]! & (AgentFlag.ALIVE | AgentFlag.UNDERGROUND)) !== AgentFlag.ALIVE) continue;
      if (rand(world.seed, Stream.RAIN, s, world.tick, Key.HIT) >= pHit) continue;
      const ang = TAU * rand(world.seed, Stream.RAIN, s, world.tick, Key.ANGLE);
      const d = e.rainPush * rand(world.seed, Stream.RAIN, s, world.tick, Key.DIST);
      const x = a.posX[s]! + d * dcos(ang), z = a.posZ[s]! - d * dsin(ang);
      const half = cfg.world.arenaSize / 2;
      a.posX[s] = Math.max(-half, Math.min(half, x)); a.posZ[s] = Math.max(-half, Math.min(half, z));
      a.posY[s] = world.terrain.supportHeight(a.posX[s]!, a.posZ[s]!) + ride;
      a.heading[s] = (2 * rand(world.seed, Stream.RAIN, s, world.tick, Key.HEADING) - 1) * PI;
      a.turnRate[s] = 0;
      a.stun[s] = Math.max(a.stun[s]!, s0 + (s1 - s0) * rand(world.seed, Stream.RAIN, s, world.tick, Key.STUN));
    }
    // New drops: the expected number this tick over the arena (Bernoulli per whole and fractional part).
    const size = cfg.world.arenaSize, half = size / 2;
    const expected = e.dropForm * size * size * (c.rain / S_PER_H) * dt;
    const [r0, r1] = e.dropRadius as readonly [number, number];
    const [t0, t1] = e.trapTime as readonly [number, number];
    for (let k = 0; k < Math.ceil(expected); k++) {
      const id = DROP_ENTITY + k;
      if (rand(world.seed, Stream.RAIN, id, world.tick, Key.FORM) >= Math.min(1, expected - k)) continue;
      const x = (2 * rand(world.seed, Stream.RAIN, id, world.tick, Key.X) - 1) * half;
      const z = (2 * rand(world.seed, Stream.RAIN, id, world.tick, Key.Z) - 1) * half;
      const y = world.terrain.supportHeight(x, z);
      if (y - world.terrain.groundHeight(x, z) < e.dropSurface) continue; // bare soil: soaks in
      let r = r0 + (r1 - r0) * rand(world.seed, Stream.RAIN, id, world.tick, Key.R);
      const hit = drops.at(x, z);
      let cx = x, cz = z;
      if (hit >= 0) {
        // Merge into the drop already there: volumes (∝ r³) add.
        const R = drops.r[hit]!;
        r = Math.min(e.dropMaxRadius, dpow(R * R * R + r * r * r, 1 / 3));
        drops.r[hit] = r;
        cx = drops.x[hit]!; cz = drops.z[hit]!;
      } else {
        r = Math.min(r, e.dropMaxRadius);
        if (!drops.add(x, z, r, y)) break;
        changed = true;
      }
      // Ants under the new (or grown) drop are caught in it.
      for (let s = 0; s < world.agents.highWater; s++) {
        if ((a.flags[s]! & (AgentFlag.ALIVE | AgentFlag.UNDERGROUND)) !== AgentFlag.ALIVE || a.stun[s]! > 0) continue;
        const dx = a.posX[s]! - cx, dz = a.posZ[s]! - cz;
        if (dx * dx + dz * dz > r * r) continue;
        a.stun[s] = t0 + (t1 - t0) * rand(world.seed, Stream.RAIN, s, world.tick, Key.TRAP);
      }
    }
    // Rain washes the trail away: the extra decay on top of evaporation.
    const field = world.pheromone;
    if (field) field.scale(dexp(-((e.washout - 1) * dt) / cfg.pheromone.lifetime));
  }
  // Evaporation.
  const r0 = (e.dropRadius as readonly number[])[0]!;
  const k = c.evaporation * dt;
  if (k > 0) {
    for (let i = drops.count - 1; i >= 0; i--) {
      const r2 = drops.r[i]! * drops.r[i]! - k;
      if (r2 <= r0 * r0 * MIN_FRACTION) { drops.remove(i); changed = true; }
      else drops.r[i] = Math.sqrt(r2);
    }
  }
  if (changed) drops.reindex();
}

/** A drop shrunk below this fraction of the smallest new drop's area is gone. */
const MIN_FRACTION = 0.01;
