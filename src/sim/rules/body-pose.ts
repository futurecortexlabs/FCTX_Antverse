/**
 * Body pose on the terrain: the mesosoma rides rideHeight above the support
 * surface, pitched to match the support under the head and under the gaster, rolled to
 * the local soil slope, following changes with time constant poseSmoothing
 * (the legs absorb faster bumps). It never sinks below minRideHeight over the
 * highest support under the body. (ASM-LOC-005, ASM-LOC-006)
 */

import { datan, datan2, dcos, dsin } from '../../core/dmath.ts';
import { quatYawPitchRoll } from '../../core/quat.ts';
import { buildMorphology, type Morphology } from '../../locomotion/morphology.ts';
import { newSample } from '../../terrain/noise.ts';
import { AgentFlag } from '../agents/store.ts';
import type { World } from '../world.ts';

const slope = newSample();
let morphCache: { cfg: unknown; m: Morphology } | null = null;

/** alpha: blend towards the target pose (1 = snap, e.g. on spawn). */
export function bodyPoseRange(world: World, from: number, to: number, alpha: number): void {
  const { agents, config, terrain } = world;
  const a = agents.a;
  const lc = config.locomotion;
  const L = config.ant.workerBodyLength;
  // The body is stiff: roll follows soil slope band-limited to its own size.
  const hBody = L / 4;
  if (!morphCache || morphCache.cfg !== config) morphCache = { cfg: config, m: buildMorphology(config) };
  const { head, gaster } = morphCache.m;
  // How far each segment's underside lies below the mesosoma centre.
  const headDrop = head.h / 2 - head.cy, mesoDrop = morphCache.m.mesosoma.h / 2, gasterDrop = gaster.h / 2 - gaster.cy;

  for (let s = from; s < to; s++) {
    if ((a.flags[s]! & (AgentFlag.ALIVE | AgentFlag.UNDERGROUND)) !== AgentFlag.ALIVE) continue; // dead, or in the soil (burrow.ts)
    const x = a.posX[s]!, z = a.posZ[s]!, h = a.heading[s]!;
    const fx = dcos(h), fz = -dsin(h);
    // Support under the mesosoma, head and gaster (the latter two also set the pitch), sampled where
    // the segments are with the current pitch (a pitched body is horizontally shorter).
    const cp0 = dcos(a.pitch[s]!);
    const hx = head.cx * cp0, gx = gaster.cx * cp0;
    const yC = terrain.supportHeight(x, z);
    const yF = terrain.supportHeight(x + fx * hx, z + fz * hx);
    const yB = terrain.supportHeight(x + fx * gx, z + fz * gx);
    terrain.ground(x, z, hBody, slope);
    // Slope towards the body's right (+Z body axis = (sin h, cos h) on the ground).
    const right = slope.dx * dsin(h) + slope.dz * dcos(h);
    const pitchT = datan2(yF - yB, hx - gx);
    const rollT = -datan(right);
    const yT = Math.max(yC, (yF + yB) * 0.5) + lc.rideHeight;
    let y = a.posY[s]! + alpha * (yT - a.posY[s]!);
    const pitch = a.pitch[s]! + alpha * (pitchT - a.pitch[s]!);
    const roll = a.roll[s]! + alpha * (rollT - a.roll[s]!);
    // Never let the head, mesosoma or gaster underside sink into what is below it. The underside
    // point (c, −d, 0) of a segment, rotated by roll r then pitch θ, lies c·cosθ + d·cos r·sinθ ahead
    // of and −d·sin r to the right of the mesosoma centre, at height y + c·sinθ − d·cos r·cosθ.
    // The support is sampled there (reusing the earlier samples when the point barely moved).
    const sp = dsin(pitch), cp = dcos(pitch), sr = dsin(roll), cr = dcos(roll);
    const rx = dsin(h), rz = dcos(h);
    const under = (c: number, d: number, sampledAt: number, sampled: number): number => {
      const ahead = c * cp + d * cr * sp, side = -d * sr;
      const moved = Math.abs(ahead - sampledAt) > lc.swingClearance || Math.abs(side) > lc.swingClearance;
      const sup = moved ? terrain.supportHeight(x + fx * ahead + rx * side, z + fz * ahead + rz * side) : sampled;
      return sup - c * sp + d * cr * cp + lc.swingClearance;
    };
    const floor = Math.max(
      yC + lc.minRideHeight,
      under(head.cx, headDrop, hx, yF),
      under(0, mesoDrop, 0, yC),
      under(gaster.cx, gasterDrop, gx, yB),
    );
    if (y < floor) y = floor;
    a.posY[s] = y;
    a.pitch[s] = pitch;
    a.roll[s] = roll;
    quatYawPitchRoll(h, pitch, roll, a.rot, s * 4);
  }
}

export function bodyPose(world: World, from: number, to: number): void {
  bodyPoseRange(world, from, to, world.poseAlpha);
}
