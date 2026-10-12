/**
 * Walking in the nest (Phase 5). Underground, workers walk on the walls,
 * floors and ceilings of the tunnels: from voxel to neighbouring voxel of the
 * dug space, always next to soil. Each next voxel is drawn from its
 * neighbours with log-weights for keeping the direction of travel
 * (dig.persistence) and for heading towards the current goal (dig.goalPull /
 * dig.downPull) — a correlated random walk on the voxel lattice
 * (ASM-NST-003). The body moves continuously towards the chosen voxel and
 * stands on its wall, oriented with its back away from the soil.
 *
 * Goals: a worker carrying soil climbs (negative geotaxis): in the nest it
 * follows gravity, not its home vector — under the ceiling of a chamber it
 * walks along the ceiling until a way up opens — and leaves the soil through
 * the first opening to the surface it reaches. A worker without a load may
 * drift downwards (dig.walkDown).
 *
 * Colony (Phase 6): a worker going out to forage (EXIT) climbs out like a
 * carrier; a nurse is drawn up the gradient of brood demand (unfed larval
 * food per density cell, colony.nursePull, ASM-COL-010); the queen stays put.
 */

import { datan2, dexp } from '../../core/dmath.ts';
import { quatFromBasis } from '../../core/quat.ts';
import { rand, Stream } from '../../core/rng.ts';
import { strideLength } from '../../locomotion/morphology.ts';
import type { Soil } from '../../soil/soil.ts';
import { AgentFlag, AgentState, Caste } from '../agents/store.ts';
import type { World } from '../world.ts';

/** Sub-keys of Stream.DIG: whether to dig, which face, how far out to dump. */
export const DigKey = { WHETHER: 0, FACE: 1, DUMP: 2, STOP: 3, LEAVE: 4 } as const;

/** The neighbour offsets (the 3×3×3 block minus the centre) with their unit vectors and lengths. */
const OFFSETS: { dx: number; dd: number; dz: number; ux: number; uy: number; uz: number; len: number }[] = [];
for (let dz = -1; dz <= 1; dz++) for (let dd = -1; dd <= 1; dd++) for (let dx = -1; dx <= 1; dx++) {
  if (dx === 0 && dd === 0 && dz === 0) continue;
  const len = Math.sqrt(dx * dx + dd * dd + dz * dz);
  // World y points up while the depth index d points down.
  OFFSETS.push({ dx, dd, dz, ux: dx / len, uy: -dd / len, uz: dz / len, len });
}
const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;

/** Memo bits (Soil.memoGet): standable known (1) / true (2); nearWall known (4) / true (8). */
const M_STAND = 1, M_STAND_T = 1 << 1, M_NEAR = 1 << 2, M_NEAR_T = 1 << 3;

/** Is the voxel dug space below the ground surface with soil on at least one face? (depends on the soil within 1 voxel) */
export function standable(soil: Soil, ix: number, d: number, iz: number): boolean {
  const m = soil.memoGet(ix, d, iz);
  if ((m & M_STAND) !== 0) return (m & M_STAND_T) !== 0;
  let r = false;
  if (soil.inBounds(ix, d, iz) && d >= soil.airTop[ix + iz * soil.nx]! && soil.isDug(ix, d, iz)) {
    for (const [fx, fd, fz] of FACES) if (!soil.isOpen(ix + fx, d + fd, iz + fz)) { r = true; break; }
  }
  soil.memoSet(ix, d, iz, m | M_STAND | (r ? M_STAND_T : 0));
  return r;
}

/** A dug voxel on a wall, or next to one (face-adjacent to a standable voxel). (depends on the soil within 2 voxels) */
export function nearWall(soil: Soil, ix: number, d: number, iz: number): boolean {
  const m = soil.memoGet(ix, d, iz);
  if ((m & M_NEAR) !== 0) return (m & M_NEAR_T) !== 0;
  let r = standable(soil, ix, d, iz);
  if (!r && soil.inBounds(ix, d, iz) && d >= soil.airTop[ix + iz * soil.nx]! && soil.isDug(ix, d, iz)) {
    for (const [fx, fd, fz] of FACES) if (standable(soil, ix + fx, d + fd, iz + fz)) { r = true; break; }
  }
  soil.memoSet(ix, d, iz, soil.memoGet(ix, d, iz) | M_NEAR | (r ? M_NEAR_T : 0));
  return r;
}

/** Air above the ground surface (an opening of the nest to the outside). */
function isSky(soil: Soil, ix: number, d: number, iz: number): boolean {
  return d < 0 || (soil.inBounds(ix, d, iz) && d < soil.airTop[ix + iz * soil.nx]!);
}

/** A move along a diagonal must not cut a corner of soil: every voxel of the box it spans must be open. */
function clear(soil: Soil, ix: number, d: number, iz: number, dx: number, dd: number, dz: number): boolean {
  for (let a = 0; a <= Math.abs(dx); a++) for (let b = 0; b <= Math.abs(dd); b++) for (let c = 0; c <= Math.abs(dz); c++) {
    if (!soil.isOpen(ix + a * dx, d + b * dd, iz + c * dz)) return false;
  }
  return true;
}

/** Normal of the walls around voxel (ix, d, iz): away from the soil faces (world axes), written into out. */
export function wallNormal(soil: Soil, ix: number, d: number, iz: number, out: Float64Array): boolean {
  let nx = 0, ny = 0, nz = 0;
  for (const [fx, fd, fz] of FACES) if (!soil.isOpen(ix + fx, d + fd, iz + fz)) { nx -= fx; ny += fd; nz -= fz; }
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len === 0) return false;
  out[0] = nx / len; out[1] = ny / len; out[2] = nz / len;
  return true;
}

const v = new Int32Array(3);
const n3 = new Float64Array(3);
const weights = new Float64Array(OFFSETS.length);

export function burrow(world: World, from: number, to: number): void {
  const soil = world.soil;
  if (!soil) return;
  const { config } = world;
  const dc = config.dig;
  const a = world.agents.a;
  const dt = config.sim.dt;
  const ride = config.locomotion.rideHeight;
  // Stand this far from the voxel centre towards the open side (at most half a voxel).
  const lift = Math.max(-0.5, Math.min(0.5, ride - 0.5));

  for (let s = from; s < to; s++) {
    if ((a.flags[s]! & AgentFlag.ALIVE) === 0 || (a.flags[s]! & AgentFlag.UNDERGROUND) === 0) continue;
    if (a.state[s] === AgentState.NEST_REST || a.caste[s] === Caste.QUEEN) { a.lastStep[s] = 0; a.stepX[s] = 0; a.stepZ[s] = 0; continue; }
    soil.unindex(a.cell[s]!, v);
    let ix = v[0]!, d = v[1]!, iz = v[2]!;
    const x0 = a.posX[s]!, y0 = a.posY[s]!, z0 = a.posZ[s]!;
    let tx = soil.centreX(ix) + a.upX[s]! * lift, ty = soil.centreY(d) + a.upY[s]! * lift, tz = soil.centreZ(iz) + a.upZ[s]! * lift;
    let ex = tx - x0, ey = ty - y0, ez = tz - z0;
    let dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
    // Walking speed follows the soil temperature at this depth (env, BIO-ENV-001).
    const speed = a.speed[s]! * world.climate.rateAt(y0);
    const step = speed * dt;
    let x: number, y: number, z: number;
    if (dist > step) {
      x = x0 + (ex / dist) * step; y = y0 + (ey / dist) * step; z = z0 + (ez / dist) * step;
    } else {
      x = tx; y = ty; z = tz;
      // Arrived: choose the next voxel.
      const state = a.state[s]!;
      const haul = state === AgentState.HAUL || state === AgentState.EXIT;
      let gx = 0, gy = 0, gz = 0, pull = 0;
      if (haul) {
        gy = 1; pull = dc.goalPull;
      } else if (state === AgentState.NURSE && demandGradient(world, ix, d, iz, n3)) {
        gx = n3[0]!; gy = n3[1]!; gz = n3[2]!; pull = config.colony.nursePull;
      } else {
        gy = -1; pull = dc.walkDown;
      }
      const dx0 = a.dirX[s]!, dy0 = a.dirY[s]!, dz0 = a.dirZ[s]!;
      // Candidates: dug voxels within reach of a wall — the body (5 voxels long) spans a gap of
      // one voxel — or, for a carrier, the open air above (out of the nest). Out in open space
      // with no wall in reach, any dug neighbour: it drops or climbs to the next wall.
      let total = 0;
      for (let pass = 0; pass < 2 && total === 0; pass++) {
        for (let k = 0; k < OFFSETS.length; k++) {
          const o = OFFSETS[k]!;
          const nx = ix + o.dx, nd = d + o.dd, nz = iz + o.dz;
          weights[k] = 0;
          const sky = isSky(soil, nx, nd, nz);
          if (sky ? !haul : pass === 0 ? !nearWall(soil, nx, nd, nz) : !soil.isDug(nx, nd, nz)) continue;
          if (!clear(soil, ix, d, iz, o.dx, o.dd, o.dz)) continue;
          const w = dexp(dc.persistence * (o.ux * dx0 + o.uy * dy0 + o.uz * dz0) + pull * (o.ux * gx + o.uy * gy + o.uz * gz));
          weights[k] = w;
          total += w;
        }
      }
      if (total === 0) {
        // Nowhere to go (a dead end too tight to turn in): turn round.
        a.dirX[s] = -dx0; a.dirY[s] = -dy0; a.dirZ[s] = -dz0;
      } else {
        let r = rand(world.seed, Stream.BURROW, s, world.tick) * total;
        let k = 0;
        for (; k < OFFSETS.length - 1; k++) { r -= weights[k]!; if (r < 0 && weights[k]! > 0) break; }
        while (weights[k] === 0) k--; // rounding guard: the last candidate with weight
        const o = OFFSETS[k]!;
        const nx = ix + o.dx, nd = d + o.dd, nz = iz + o.dz;
        const b = dc.turnBlend;
        let fx = dx0 * (1 - b) + o.ux * b, fy = dy0 * (1 - b) + o.uy * b, fz = dz0 * (1 - b) + o.uz * b;
        const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
        a.dirX[s] = fx / fl; a.dirY[s] = fy / fl; a.dirZ[s] = fz / fl;
        if (isSky(soil, nx, nd, nz)) {
          surface(world, s, soil.centreX(nx), soil.centreZ(nz));
          continue;
        }
        a.cell[s] = soil.index(nx, nd, nz);
        ix = nx; d = nd; iz = nz;
        if (wallNormal(soil, ix, d, iz, n3)) { a.upX[s] = n3[0]!; a.upY[s] = n3[1]!; a.upZ[s] = n3[2]!; }
      }
    }
    // Body frame: forward along the direction of travel, flattened onto the wall; up away from the soil.
    ex = x - x0; ey = y - y0; ez = z - z0;
    dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
    let fx = dist > 0 ? ex / dist : a.dirX[s]!, fy = dist > 0 ? ey / dist : a.dirY[s]!, fz = dist > 0 ? ez / dist : a.dirZ[s]!;
    const ux = a.upX[s]!, uy = a.upY[s]!, uz = a.upZ[s]!;
    const dot = fx * ux + fy * uy + fz * uz;
    fx -= dot * ux; fy -= dot * uy; fz -= dot * uz;
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
    if (fl > 0) quatFromBasis(fx / fl, fy / fl, fz / fl, ux, uy, uz, a.rot, 4 * s);
    a.posX[s] = x; a.posY[s] = y; a.posZ[s] = z;
    a.stepX[s] = ex; a.stepZ[s] = ez;
    a.lastStep[s] = dist;
    const phase = a.gaitPhase[s]! + dist / strideLength(config, speed);
    a.gaitPhase[s] = phase - Math.floor(phase);
  }
}

/**
 * Direction of rising brood demand at voxel (ix, d, iz), from the density cells either side
 * (world axes: y up). False where there is no demand around.
 */
function demandGradient(world: World, ix: number, d: number, iz: number, out: Float64Array): boolean {
  const density = world.density!;
  if (!density.contacts) return false;
  const c = density.cell;
  const at = (x: number, dd: number, z: number): number =>
    x < 0 || dd < 0 || z < 0 || x >= density.cx * c || dd >= density.cd * c || z >= density.cz * c ? 0 : density.demandAt(x, dd, z);
  const gx = at(ix + c, d, iz) - at(ix - c, d, iz);
  const gy = at(ix, d - c, iz) - at(ix, d + c, iz);
  const gz = at(ix, d, iz + c) - at(ix, d, iz - c);
  const len = Math.sqrt(gx * gx + gy * gy + gz * gz);
  if (len === 0) return false;
  out[0] = gx / len; out[1] = gy / len; out[2] = gz / len;
  return true;
}

/** Come out of the soil at (x, z): back to walking on the surface. */
export function surface(world: World, s: number, x: number, z: number): void {
  const a = world.agents.a;
  const cfg = world.config;
  a.flags[s] = a.flags[s]! & ~AgentFlag.UNDERGROUND;
  a.cell[s] = -1;
  a.stepX[s] = x - a.posX[s]!; a.stepZ[s] = z - a.posZ[s]!;
  a.lastStep[s] = Math.sqrt(a.stepX[s]! * a.stepX[s]! + a.stepZ[s]! * a.stepZ[s]!);
  a.posX[s] = x; a.posZ[s] = z;
  a.posY[s] = world.terrain.supportHeight(x, z) + cfg.locomotion.rideHeight;
  // Out of the nest: the home vector starts afresh here.
  const nest = world.nest!;
  a.piX[s] = x - nest.x; a.piZ[s] = z - nest.z;
  a.heading[s] = datan2(-a.dirZ[s]!, a.dirX[s]!);
  a.turnRate[s] = 0;
  a.avoidTurn[s] = 0;
  const [lo, hi] = cfg.dig.dumpDistance as [number, number];
  a.dumpAt[s] = lo + (hi - lo) * rand(world.seed, Stream.DIG, s, world.tick, DigKey.DUMP);
}

/** Go down into the soil at its entrance voxel (ix, d, iz). */
export function enterSoil(world: World, s: number, ix: number, d: number, iz: number): void {
  const soil = world.soil!;
  const a = world.agents.a;
  a.flags[s] = a.flags[s]! | AgentFlag.UNDERGROUND;
  a.cell[s] = soil.index(ix, d, iz);
  a.dirX[s] = 0; a.dirY[s] = -1; a.dirZ[s] = 0; // heading down the entrance
  if (wallNormal(soil, ix, d, iz, n3)) { a.upX[s] = n3[0]!; a.upY[s] = n3[1]!; a.upZ[s] = n3[2]!; }
  a.state[s] = AgentState.DIG;
  a.searchTime[s] = 0;
  a.flags[s] = a.flags[s]! & ~AgentFlag.LOOP_BACK;
}
