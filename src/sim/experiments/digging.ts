/**
 * Phase 5 excavation experiment (observation only): N workers start resting
 * in the nest entrance on undisturbed soil and dig; we record the volume dug
 * per bin, the depth, the distribution of the dug volume with depth, and
 * check that the dug space is one connected nest and that every pellet is
 * accounted for (dug = carried + on the mound).
 */

import type { Config } from '../../config/params.ts';
import { CarryKind } from '../agents/store.ts';
import { World } from '../world.ts';

export interface DigResult {
  seed: number;
  workers: number;
  /** Voxels dug by the workers in each bin (pellets). */
  bins: number[];
  /** Total dug by the workers (pellets = mm³ at 1 mm voxels). */
  volume: number;
  /** Deepest dug voxel below the entrance (mm). */
  depth: number;
  /** Dug volume per 10 mm of depth below the surface (top-heaviness). */
  byDepth: number[];
  /** Dug voxels not connected to the entrance (should be 0). */
  disconnected: number;
  /** Dug − (carried + on the mound) (should be 0). */
  unaccounted: number;
  /** Peak bin rate and the rate over the last lateFraction of the run (pellets per bin). */
  peakRate: number;
  lateRate: number;
  saturated: boolean;
}

const DEPTH_BAND = 10;

export function runDiggingTrial(config: Config): DigResult {
  const ex = config.experiment;
  const world = new World(config);
  const soil = world.soil!;
  const binTicks = Math.max(1, Math.round(ex.digBin / config.sim.dt));
  const ticks = Math.round(ex.digDuration / config.sim.dt);
  const bins: number[] = [];
  let last = soil.dug;
  for (let t = 1; t <= ticks; t++) {
    world.step();
    if (t % binTicks === 0) { bins.push(soil.dug - last); last = soil.dug; }
  }
  const a = world.agents.a;
  let carried = 0;
  for (let s = 0; s < world.agents.highWater; s++) if (a.carryKind[s] === CarryKind.SOIL) carried++;
  const volume = soil.dug - world.pitVoxels;
  // Depth profile and connectivity (26-connected flood fill from the entrance column).
  const v = new Int32Array(3);
  const cx = soil.voxelX(0), cz = soil.voxelZ(0);
  const surface = soil.airTop[cx + cz * soil.nx]!;
  const byDepth: number[] = [];
  let depth = 0;
  const seen = new Set<number>();
  const stack: number[] = [];
  const start = soil.index(cx, surface, cz);
  if (soil.isDug(cx, surface, cz)) { seen.add(start); stack.push(start); }
  while (stack.length > 0) {
    soil.unindex(stack.pop()!, v);
    const x = v[0]!, d = v[1]!, z = v[2]!;
    for (let dz = -1; dz <= 1; dz++) for (let dd = -1; dd <= 1; dd++) for (let dx = -1; dx <= 1; dx++) {
      if (!soil.isDug(x + dx, d + dd, z + dz)) continue;
      const k = soil.index(x + dx, d + dd, z + dz);
      if (!seen.has(k)) { seen.add(k); stack.push(k); }
    }
  }
  for (const k of seen) {
    soil.unindex(k, v);
    const below = v[1]! - soil.airTop[v[0]! + v[2]! * soil.nx]!;
    depth = Math.max(depth, below + 1);
    const band = Math.floor(below / DEPTH_BAND);
    byDepth[band] = (byDepth[band] ?? 0) + 1;
  }
  for (let b = 0; b < byDepth.length; b++) byDepth[b] ??= 0;
  const late = Math.max(1, Math.round(bins.length * ex.lateFraction));
  const lateRate = bins.slice(-late).reduce((s, b) => s + b, 0) / late;
  const peakRate = Math.max(...bins);
  return {
    seed: config.sim.seed,
    workers: config.population.count,
    bins,
    volume,
    depth,
    byDepth,
    disconnected: soil.dug - seen.size,
    unaccounted: volume - (world.mound!.pellets + carried),
    peakRate,
    lateRate,
    saturated: lateRate < ex.slowFraction * peakRate,
  };
}
