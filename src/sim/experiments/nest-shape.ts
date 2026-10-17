/**
 * Nest shape (ENG-EXP-006): the nest connected to the entrance, cut into
 * 1 mm layers. The shaft is the typical layer (median horizontal area); a
 * chamber is a run of layers at least experiment.nestChamberRatio times as
 * wide as the shaft, and it is flat when its width (a circle of its largest
 * area) is at least experiment.nestFlatRatio times its height.
 */

import type { Config } from '../../config/params.ts';
import { World } from '../world.ts';

export interface Chamber {
  /** Depth of its ceiling below the surface (mm), its height (mm) and largest horizontal area (mm²). */
  top: number;
  height: number;
  area: number;
  flat: boolean;
}

export interface NestShape {
  volume: number;
  depth: number;
  /** Horizontal area per 1 mm layer below the surface (mm²). */
  areas: number[];
  /** Median layer area (mm²) and the diameter of a circle of that area (mm). */
  shaftArea: number;
  shaftWidth: number;
  chambers: Chamber[];
  /** Share of the volume in the upper half of the depth. */
  upperShare: number;
}

export function nestShape(world: World): NestShape {
  const soil = world.soil!;
  const ex = world.config.experiment;
  const v = new Int32Array(3);
  const cx = soil.voxelX(world.nest!.x), cz = soil.voxelZ(world.nest!.z);
  const top = soil.airTop[cx + cz * soil.nx]!;
  // Dug voxels connected (26-neighbours) to the entrance column.
  const seen = new Set<number>();
  const stack: number[] = [];
  if (soil.isDug(cx, top, cz)) { const k = soil.index(cx, top, cz); seen.add(k); stack.push(k); }
  while (stack.length > 0) {
    soil.unindex(stack.pop()!, v);
    const x = v[0]!, d = v[1]!, z = v[2]!;
    for (let dz = -1; dz <= 1; dz++) for (let dd = -1; dd <= 1; dd++) for (let dx = -1; dx <= 1; dx++) {
      if (!soil.isDug(x + dx, d + dd, z + dz)) continue;
      const k = soil.index(x + dx, d + dd, z + dz);
      if (!seen.has(k)) { seen.add(k); stack.push(k); }
    }
  }
  const areas: number[] = [];
  for (const k of seen) {
    soil.unindex(k, v);
    const below = v[1]! - soil.airTop[v[0]! + v[2]! * soil.nx]!;
    areas[below] = (areas[below] ?? 0) + 1;
  }
  for (let i = 0; i < areas.length; i++) areas[i] ??= 0;
  const depth = areas.length;
  const sorted = areas.filter((a) => a > 0).sort((a, b) => a - b);
  const shaftArea = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
  const chambers: Chamber[] = [];
  for (let i = 0; i < depth;) {
    if (areas[i]! < ex.nestChamberRatio * shaftArea) { i++; continue; }
    let j = i, area = 0;
    while (j < depth && areas[j]! >= ex.nestChamberRatio * shaftArea) { area = Math.max(area, areas[j]!); j++; }
    const height = j - i, width = 2 * Math.sqrt(area / Math.PI);
    chambers.push({ top: i, height, area, flat: width >= ex.nestFlatRatio * height });
    i = j;
  }
  let upper = 0;
  for (let i = 0; i < depth / 2; i++) upper += areas[i]!;
  return {
    volume: seen.size, depth, areas, shaftArea, shaftWidth: 2 * Math.sqrt(shaftArea / Math.PI), chambers,
    upperShare: seen.size ? upper / seen.size : 0,
  };
}

export interface NestTrialResult extends Omit<NestShape, 'areas'> {
  seed: number;
  areas: number[];
  /** Flat chambers, and whether the colony passes (ENG-EXP-006). */
  flatChambers: number;
  pass: boolean;
}

/** A colony digs its nest from the starting pit for experiment.nestDuration; its shape at the end. */
export function runNestTrial(config: Config): NestTrialResult {
  const ex = config.experiment;
  const w = new World(config);
  const ticks = Math.round(ex.nestDuration / config.sim.dt);
  for (let t = 0; t < ticks; t++) w.step();
  const shape = nestShape(w);
  const flatChambers = shape.chambers.filter((c) => c.flat).length;
  return { ...shape, seed: config.sim.seed, flatChambers, pass: flatChambers >= ex.nestMinChambers && shape.upperShare > ex.nestUpperShare };
}
