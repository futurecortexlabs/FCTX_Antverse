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
    if ((a.flags[s]! & AgentFlag.ALIVE) === 0) continue;
    const x = a.posX[s]!, z = a.posZ[s]!, h = a.heading[s]!;
    const fx = dcos(h), fz = -dsin(h);
    // Support under the mesosoma, head and gaster (the latter two also set the pitch).
    const yC = terrain.supportHeight(x, z);
    const yF = terrain.supportHeight(x + fx * head.cx, z + fz * head.cx);
    const yB = terrain.supportHeight(x + fx * gaster.cx, z + fz * gaster.cx);
    terrain.ground(x, z, hBody, slope);
    // Slope towards the body's right (+Z body axis = (sin h, cos h) on the ground).
    const right = slope.dx * dsin(h) + slope.dz * dcos(h);
    const pitchT = datan2(yF - yB, head.cx - gaster.cx);
    const rollT = -datan(right);
    const yT = Math.max(yC, (yF + yB) * 0.5) + lc.rideHeight;
    let y = a.posY[s]! + alpha * (yT - a.posY[s]!);
    const pitch = a.pitch[s]! + alpha * (pitchT - a.pitch[s]!);
    const roll = a.roll[s]! + alpha * (rollT - a.roll[s]!);
    // Never let the head, mesosoma or gaster underside sink into what is below it. A segment at
    // body-axis offset c with underside depth d sits at y + c·sin(pitch) - d·cos(pitch).
    const sp = dsin(pitch), cp = dcos(pitch);
    const floor = Math.max(
      yC + lc.minRideHeight,
      yF - head.cx * sp + headDrop * cp + lc.swingClearance,
      yC + mesoDrop * cp + lc.swingClearance,
      yB - gaster.cx * sp + gasterDrop * cp + lc.swingClearance,
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
