/**
 * Keeps the camera (and its orbit target) above whatever is on the ground.
 * The near plane is 0.05 mm away, so the camera must stay at least that far
 * from any surface — including grains, pebbles and leaves beside it, not
 * only the point directly below. Pure logic over the Terrain (testable).
 */

import type { Config } from '../../config/params.ts';
import type { Terrain } from '../../terrain/terrain.ts';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const RING = 8;

/** Lowest allowed camera height at (x, z): highest support within guardRadius, plus clearance. */
export function minCameraHeight(terrain: Terrain, cfg: Config, x: number, z: number): number {
  const r = cfg.terrainRender.guardRadius;
  let top = terrain.supportHeight(x, z);
  for (let k = 0; k < RING; k++) {
    const a = (k / RING) * 2 * Math.PI;
    top = Math.max(top, terrain.supportHeight(x + r * Math.cos(a), z + r * Math.sin(a)));
  }
  return top + cfg.terrainRender.cameraClearance + cfg.render.near;
}

/** Push camera and target up if they are inside the ground. Returns true if anything moved. */
export function applyCameraGuard(terrain: Terrain, cfg: Config, camera: Vec3, target: Vec3): boolean {
  let moved = false;
  const minY = minCameraHeight(terrain, cfg, camera.x, camera.z);
  if (camera.y < minY) { camera.y = minY; moved = true; }
  const ty = terrain.supportHeight(target.x, target.z);
  if (target.y < ty) { target.y = ty; moved = true; }
  return moved;
}
