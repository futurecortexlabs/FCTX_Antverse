/**
 * Leaf material (TSL, visual only): midrib, lateral veins and mottling drawn
 * in leaf coordinates (uv = s along the midrib 0..1, t across −1..1), with
 * screen-space antialiasing so veins thin out instead of shimmering.
 */

import * as THREE from 'three/webgpu';
import { abs, float, fract, fwidth, min, mx_noise_float, positionWorld, smoothstep, uv, vec4, vertexColor } from 'three/tsl';
import type { Config } from '../../config/params.ts';

type N = THREE.Node<'float'>;

/** 1 on a line of half-width `w` around d = 0, antialiased by the pixel footprint of d. */
function line(d: N, w: number): N {
  const aa = fwidth(d) as unknown as N;
  return float(1).sub(smoothstep(aa.mul(0.5).add(w), aa.mul(1.5).add(w), d)) as unknown as N;
}

export function leafMaterial(cfg: Config): THREE.MeshStandardNodeMaterial {
  const r = cfg.terrainRender;
  const s = uv().x as unknown as N, t = uv().y as unknown as N;
  const at = abs(t) as unknown as N;
  const midrib = line(at, r.leafMidribWidth);
  // Lateral veins leave the midrib towards the tip at a slant.
  const phase = fract(s.sub(at.mul(r.leafVeinSlant)).mul(r.leafVeinCount)) as unknown as N;
  const veinDist = min(phase, float(1).sub(phase)).div(r.leafVeinCount) as unknown as N;
  const veins = line(veinDist, r.leafVeinWidth).mul(float(1).sub(midrib)) as unknown as N;
  const mottle = mx_noise_float(positionWorld.xz.div(r.leafMottleScale)) as unknown as N;
  const shade = float(1)
    .sub(midrib.mul(r.leafMidribDarken))
    .sub(veins.mul(r.leafVeinDarken))
    .add(mottle.mul(r.leafMottleContrast));
  const material = new THREE.MeshStandardNodeMaterial({ roughness: r.objectRoughness[1]!, metalness: 0, side: THREE.DoubleSide });
  material.colorNode = vec4(vertexColor().xyz.mul(shade), 1);
  return material;
}
