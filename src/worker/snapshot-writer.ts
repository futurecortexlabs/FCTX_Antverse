/** Copy render-facing agent fields from the World into a snapshot. */

import { AGENT_SCHEMA } from '../sim/agents/store.ts';
import type { World } from '../sim/world.ts';
import {
  META_CARRY_SHIFT, META_FLAG_SHIFT, META_GEN_SHIFT, META_BYTE,
  SNAP_FLOATS, SnapH, type SnapshotView,
} from './protocol.ts';

const ROT = AGENT_SCHEMA.rot.components;

export function writeSnapshot(
  world: World,
  view: SnapshotView,
  seq: number,
  wallTime: number,
  timeScale: number,
  paused: boolean,
): void {
  const { agents } = world;
  const a = agents.a;
  const n = agents.highWater;
  const f = view.floats;
  const m = view.meta;
  for (let s = 0; s < n; s++) {
    const o = s * SNAP_FLOATS;
    const r = s * ROT;
    f[o] = a.posX[s]!;
    f[o + 1] = a.posY[s]!;
    f[o + 2] = a.posZ[s]!;
    f[o + 3] = a.rot[r]!;
    f[o + 4] = a.rot[r + 1]!;
    f[o + 5] = a.rot[r + 2]!;
    f[o + 6] = a.rot[r + 3]!;
    f[o + 7] = a.gaitPhase[s]!;
    f[o + 8] = a.speed[s]!;
    m[s] = (a.caste[s]!
      | (a.flags[s]! << META_FLAG_SHIFT)
      | (a.carryKind[s]! << META_CARRY_SHIFT)
      | ((a.gen[s]! & META_BYTE) << META_GEN_SHIFT)) >>> 0;
  }
  const h = view.header;
  h[SnapH.SEQ] = seq;
  h[SnapH.TICK] = world.tick;
  h[SnapH.SIM_TIME] = world.simTime();
  h[SnapH.WALL_TIME] = wallTime;
  h[SnapH.COUNT] = n;
  h[SnapH.TIME_SCALE] = timeScale;
  h[SnapH.PAUSED] = paused ? 1 : 0;
  h[SnapH.ALIVE] = agents.alive;
  h[SnapH.DT] = world.config.sim.dt;
}
