/**
 * Debug overlays for checking scale: a scale bar with 1 mm ticks and
 * xyz axes one body length long, placed on the bare ground at the nest
 * entrance (origin).
 */

import * as THREE from 'three/webgpu';
import type { Config } from '../../config/params.ts';
import type { Terrain } from '../../terrain/terrain.ts';
import { rgb } from '../environment.ts';

export function buildOverlays(cfg: Config, terrain: Terrain): THREE.Group {
  const r = cfg.render;
  const group = new THREE.Group();
  group.name = 'overlays';
  const len = r.scaleBarLength, step = r.scaleBarTick, thick = r.scaleBarThickness;
  // Rest the bar on the highest point under it.
  let top = -Infinity;
  for (let x = 0; x <= len; x += step / 2) top = Math.max(top, terrain.supportHeight(x, cfg.ant.workerBodyLength));
  const bar = new THREE.Group();
  const mat = new THREE.MeshStandardNodeMaterial({ color: rgb(r.scaleBarColor), roughness: 1 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(len, thick, thick), mat);
  body.position.set(len / 2, thick / 2, 0);
  bar.add(body);
  const minorTick = new THREE.BoxGeometry(thick, thick, step / 2);
  const majorTick = new THREE.BoxGeometry(thick, thick, step);
  const ticks = Math.round(len / step);
  for (let i = 0; i <= ticks; i++) {
    const t = new THREE.Mesh(i % r.scaleBarMajorEvery === 0 ? majorTick : minorTick, mat);
    t.position.set(i * step, thick / 2, 0);
    bar.add(t);
  }
  bar.position.set(0, top, cfg.ant.workerBodyLength);
  bar.name = 'scale-bar';
  group.add(bar);

  const axes = new THREE.AxesHelper(cfg.ant.workerBodyLength);
  axes.position.y = terrain.supportHeight(0, 0) + r.near;
  axes.name = 'axes';
  group.add(axes);
  return group;
}
