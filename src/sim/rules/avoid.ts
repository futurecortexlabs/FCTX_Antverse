/**
 * Collision avoidance on the surface (Phase 7, ASM-SOC-001): an ant that
 * touches a nestmate ahead of it with its antennae turns away from it — to
 * the left if the other is on its right, and the more the closer it is
 * (army ants: Couzin & Franks 2003); one right in front makes it stop and turn
 * on the spot this tick (explore). The other ants' positions come from the
 * surface grid of the last tick. Like trail following, the result is a
 * turning request (agents.steer) that explore applies while the way is free.
 * Switched on per scenario (explore.collide).
 */

import { dcos, dsin } from '../../core/dmath.ts';
import { AgentFlag, AgentState } from '../agents/store.ts';
import type { World } from '../world.ts';

export function avoid(world: World, from: number, to: number): void {
  const grid = world.surface;
  if (!grid) return;
  const a = world.agents.a, ex = world.config.explore;
  const L = world.config.ant.workerBodyLength;
  const R = ex.collideRadius * L, R2 = R * R, S = ex.collideStop * L, S2 = S * S, cone = dcos(ex.collideCone);
  const n = grid.n;
  for (let s = from; s < to; s++) {
    if ((a.flags[s]! & (AgentFlag.ALIVE | AgentFlag.UNDERGROUND)) !== AgentFlag.ALIVE || a.state[s] === AgentState.REST) continue;
    const x = a.posX[s]!, z = a.posZ[s]!, h = a.heading[s]!;
    const fx = dcos(h), fz = -dsin(h), rx = dsin(h), rz = dcos(h);
    const cx = grid.ci(x), cz = grid.ci(z);
    let turn = 0, stop = false;
    for (let j = Math.max(0, cz - 1); j <= Math.min(n - 1, cz + 1); j++) {
      for (let i = Math.max(0, cx - 1); i <= Math.min(n - 1, cx + 1); i++) {
        const k = j * n + i, c = grid.count[k]!;
        if (c === 0) continue;
        const e0 = grid.start[k]!;
        for (let e = e0; e < e0 + c; e++) {
          if (grid.slots[e] === s) continue;
          const dx = grid.x[e]! - x, dz = grid.z[e]! - z;
          const d2 = dx * dx + dz * dz;
          if (d2 >= R2 || dx * fx + dz * fz <= 0) continue; // out of reach, or behind
          const d = Math.sqrt(d2), w = 1 - d / R;
          if (d2 < S2 && dx * fx + dz * fz > cone * d) stop = true;
          // Left turns are positive heading changes: away from one on the right means left.
          turn += dx * rx + dz * rz > 0 ? w : -w;
        }
      }
    }
    if (turn !== 0) a.steer[s] = a.steer[s]! + ex.collideTurn * Math.max(-1, Math.min(1, turn));
    if (stop) a.flags[s] = a.flags[s]! | AgentFlag.BLOCKED;
  }
}
