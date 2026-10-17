/**
 * Nest excavation (Phase 5). The cycle of a digging worker:
 *
 *   DIG (underground)  at a soil face, it digs out one pellet with a
 *                      probability per second that rises steeply with the
 *                      number of nestmates around it (ASM-NST-001/002): many
 *                      workers in a small space dig; as the nest grows and
 *                      they spread out, digging dies down. Where the space
 *                      around it is narrower than its body it digs at the
 *                      full rate, elsewhere at a fraction (ASM-NST-006): so
 *                      tunnels are dug to body size and extend at their
 *                      tips. The face is chosen by the direction it is
 *                      heading and a preference for digging downwards
 *                      (ASM-NST-003).
 *   HAUL               carries the pellet up and out (burrow.ts), walks away
 *                      from the entrance by its path-integration estimate and
 *                      drops the pellet dig.dumpDistance out (ASM-NST-004),
 *                      where it joins the mound.
 *   REENTER            heads home by its home vector and goes down into the
 *                      nest at the entrance.
 *   NEST_REST          a worker walking in the nest without a load stops to
 *                      rest, more readily where nestmates are, and stays
 *                      longer the more there are (ASM-NST-007; aggregation
 *                      in Lasius niger, Depickère et al. 2004): resting
 *                      workers gather into clusters, which crowd the space
 *                      around them — where chambers are then dug.
 *
 * Digging and dropping change shared state (the soil, the mound), so they are
 * requests that World.completeStep grants in slot order: if two workers go
 * for the same voxel in the same tick, the first gets it.
 */

import { dexp, dpow } from '../../core/dmath.ts';
import { rand, Stream } from '../../core/rng.ts';
import { AgentFlag, AgentState, Caste, Request } from '../agents/store.ts';
import type { World } from '../world.ts';
import { DigKey, enterSoil, isExcavator } from './burrow.ts';

const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
const faceWeights = new Float64Array(FACES.length);
const v = new Int32Array(3);
const around = new Float64Array(2);

/** Digging response to n other workers nearby: n^h / (n^h + half^h). */
export function digResponse(n: number, half: number, hill: number): number {
  if (n <= 0) return 0;
  const p = dpow(n, hill), q = dpow(half, hill);
  return p / (p + q);
}

export function excavate(world: World, from: number, to: number): void {
  const soil = world.soil;
  if (!soil) return;
  const { config } = world;
  const dc = config.dig;
  const dt = config.sim.dt;
  const a = world.agents.a;
  const nest = world.nest!, mound = world.mound!, density = world.density!;
  const nr2 = nest.r * nest.r;

  for (let s = from; s < to; s++) {
    if ((a.flags[s]! & AgentFlag.ALIVE) === 0 || a.caste[s] !== Caste.WORKER) continue;
    const state = a.state[s]!;
    if ((a.flags[s]! & AgentFlag.UNDERGROUND) !== 0) {
      if (state !== AgentState.DIG && state !== AgentState.NEST_REST) continue;
      soil.unindex(a.cell[s]!, v);
      const ix = v[0]!, d = v[1]!, iz = v[2]!;
      // Chamber or passage: open voxels in the horizontal square around it at this level (ASM-NST-009).
      const R = dc.wideReach;
      let plane = 0;
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (soil.isOpen(ix + dx, d, iz + dz)) plane++;
      const wide = plane >= dc.wideOpen;
      // Crowding: other workers (at the end of the last tick) per open space, relative to
      // spacePerWorker, in a chamber over its density cell and the neighbours, in a passage over
      // its own cell (a jam in a shaft is crowded); the digging response to it.
      if (wide) density.around(ix, d, iz, around);
      else { around[0] = density.countAt(ix, d, iz); around[1] = density.openAt(ix, d, iz); }
      const crowding = (Math.max(0, around[0]! - 1) * dc.spacePerWorker) / (Math.max(1, around[1]!) * config.soil.pellet);
      const urge = digResponse(crowding, 1, dc.densityHill);
      // Digging drive: the crowding met, remembered over driveTau (ASM-NST-010).
      const drive = a.digDrive[s]! + (urge - a.digDrive[s]!) * Math.min(1, dt / dc.driveTau);
      a.digDrive[s] = drive;
      // Resting in clusters: stop and move on by the number of nestmates in the density cell,
      // in chambers only, and not where there is no room: crowding keeps workers on the move.
      const near = Math.max(0, density.countAt(ix, d, iz) - 1);
      if (state === AgentState.NEST_REST) {
        const leave = dc.leaveBase / (1 + dc.leaveDamp * near) + dc.leaveBase * urge;
        if (rand(world.seed, Stream.DIG, s, world.tick, DigKey.LEAVE) < leave * dt) a.state[s] = AgentState.DIG;
        continue;
      }
      if (wide && rand(world.seed, Stream.DIG, s, world.tick, DigKey.STOP) < (dc.stopBase + dc.stopPerWorker * near) * (1 - urge) * dt) {
        a.state[s] = AgentState.NEST_REST;
        continue;
      }
      // Tunnel work: an excavator cramped at a tip of a passage digs by its drive (or the crowding
      // here, if more): down when the tip is quiet, sideways (a chamber begins) when it is crowded.
      // Chamber work: anyone digs by the crowding here, sideways, up to chamberHeight.
      let open = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dd = -1; dd <= 1; dd++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx !== 0 || dd !== 0 || dz !== 0) && soil.isOpen(ix + dx, d + dd, iz + dz)) open++;
      }
      const tunnel = !wide && open < dc.clearance && isExcavator(world, s);
      // In a passage only an excavator at a tip digs; in a chamber anyone does.
      if (!wide && !tunnel) continue;
      // Open height here, floor to ceiling (mm, 1 mm voxels), counted to just past the limit. Chamber
      // work spreads low spaces (a chamber, or a niche cut off a shaft), and a tall one (a shaft) only
      // where brood lies: the brood is the template of its chamber (ASM-NST-009).
      let height = 1;
      const cap = Math.ceil(dc.chamberHeight) + 1;
      for (let k = 1; k <= cap && soil.isOpen(ix, d - k, iz); k++) height++;
      for (let k = 1; k <= cap && soil.isOpen(ix, d + k, iz); k++) height++;
      const brood = density.contacts !== null && density.demandAt(ix, d, iz) > 0;
      if (!tunnel && height > dc.chamberHeight && !brood) continue;
      // Chamber work from the floor only (soil right below): the chamber spreads flat at floor
      // level and its ceiling rises to at most chamberHeight above that floor.
      if (!tunnel && soil.isOpen(ix, d + 1, iz)) continue;
      const p = dc.rate * dt * (tunnel ? Math.max(drive, urge) : urge);
      if (rand(world.seed, Stream.DIG, s, world.tick, DigKey.WHETHER) >= p) continue;
      let total = 0;
      for (let k = 0; k < FACES.length; k++) {
        const [fx, fd, fz] = FACES[k]!;
        faceWeights[k] = 0;
        if (!soil.canDig(ix + fx, d + fd, iz + fz)) continue;
        // Never the ceiling where the space is already chamberHeight tall; in chamber work never the floor.
        if (fd < 0 && height >= dc.chamberHeight) continue;
        if (fd > 0 && !tunnel) continue;
        // World direction of the face: depth index grows downwards.
        const nx = fx, ny = -fd, nz = fz;
        faceWeights[k] = dexp(dc.persistence * (nx * a.dirX[s]! + ny * a.dirY[s]! + nz * a.dirZ[s]!) + (tunnel ? dc.downPull * (1 - urge) * -ny : 0));
        total += faceWeights[k]!;
      }
      if (total === 0) continue;
      let r = rand(world.seed, Stream.DIG, s, world.tick, DigKey.FACE) * total;
      let k = 0;
      for (; k < FACES.length - 1; k++) { r -= faceWeights[k]!; if (r < 0 && faceWeights[k]! > 0) break; }
      while (faceWeights[k] === 0) k--;
      const [fx, fd, fz] = FACES[k]!;
      a.request[s] = Request.DIG;
      a.requestCell[s] = soil.index(ix + fx, d + fd, iz + fz);
    } else if (state === AgentState.HAUL) {
      const px = a.piX[s]!, pz = a.piZ[s]!;
      if (px * px + pz * pz >= a.dumpAt[s]! * a.dumpAt[s]! && mound.canDrop(a.posX[s]!, a.posZ[s]!)) a.request[s] = Request.DROP;
    } else if (state === AgentState.REENTER) {
      // Home vector run off without the entrance in reach: search for it (as in NEST_SEARCH).
      const px = a.piX[s]!, pz = a.piZ[s]!;
      if (a.searchTime[s]! > 0) a.searchTime[s] = a.searchTime[s]! + dt;
      else if (px * px + pz * pz < config.forage.vectorEnd * config.forage.vectorEnd) a.searchTime[s] = dt;
      const dx = a.posX[s]! - nest.x, dz = a.posZ[s]! - nest.z;
      if (dx * dx + dz * dz <= nr2) {
        const ix = soil.voxelX(nest.x), iz = soil.voxelZ(nest.z);
        enterSoil(world, s, ix, soil.airTop[ix + iz * soil.nx]!, iz);
      }
    }
  }
}
