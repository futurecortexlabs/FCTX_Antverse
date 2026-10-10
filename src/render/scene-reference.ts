/**
 * Phase 0 reference scene for checking the mm coordinate system:
 * ground plane, 1 mm / 10 mm grids, a scale bar with 1 mm ticks, axes,
 * and basic lighting. Replaced by the terrain of Phase 1.
 */

import * as THREE from 'three/webgpu';
import type { Config } from '../config/params.ts';

export const rgb = (c: readonly number[]): THREE.Color => new THREE.Color(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0);

export function buildReferenceScene(scene: THREE.Scene, cfg: Config): void {
  const r = cfg.render;
  scene.background = rgb(r.skyColor);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(r.groundExtent, r.groundExtent),
    new THREE.MeshStandardNodeMaterial({ color: rgb(r.groundColor), roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'ground';
  scene.add(ground);

  // Overlays are stacked a near-plane distance apart to avoid coplanar z-fighting.
  const lift = r.near;
  const minorDivs = Math.round((2 * r.gridMinorExtent) / r.gridMinorStep);
  const minor = new THREE.GridHelper(2 * r.gridMinorExtent, minorDivs, rgb(r.gridMinorColor), rgb(r.gridMinorColor));
  minor.position.y = lift;
  minor.name = 'grid-1mm';
  scene.add(minor);

  const majorExtent = cfg.world.arenaSize;
  const majorDivs = Math.round((2 * majorExtent) / r.gridMajorStep);
  const major = new THREE.GridHelper(2 * majorExtent, majorDivs, rgb(r.gridMajorColor), rgb(r.gridMajorColor));
  major.position.y = 2 * lift;
  major.name = 'grid-10mm';
  scene.add(major);

  const bar = buildScaleBar(cfg);
  bar.position.set(0, 3 * lift, cfg.ant.workerBodyLength);
  scene.add(bar);

  const axes = new THREE.AxesHelper(cfg.ant.workerBodyLength);
  axes.position.y = 4 * lift;
  axes.name = 'axes';
  scene.add(axes);

  scene.add(new THREE.HemisphereLight(rgb(r.skyColor), rgb(r.groundColor), r.hemiIntensity));
  const sun = new THREE.DirectionalLight(0xffffff, r.sunIntensity);
  const [sx, sy, sz] = r.sunDirection;
  sun.position.set(sx!, sy!, sz!);
  scene.add(sun);
}

/** A bar of `scaleBarLength` mm along +X with ticks every grid step; longer ticks every `scaleBarMajorEvery`. */
function buildScaleBar(cfg: Config): THREE.Group {
  const r = cfg.render;
  const len = r.scaleBarLength;
  const step = r.gridMinorStep;
  const thick = r.scaleBarThickness;
  const mat = new THREE.MeshStandardNodeMaterial({ color: rgb(r.scaleBarColor), roughness: 1 });
  const group = new THREE.Group();
  group.name = 'scale-bar';
  const bar = new THREE.Mesh(new THREE.BoxGeometry(len, thick, thick), mat);
  bar.position.set(len / 2, thick / 2, 0);
  group.add(bar);
  const minorTick = new THREE.BoxGeometry(thick, thick, step / 2);
  const majorTick = new THREE.BoxGeometry(thick, thick, step);
  const ticks = Math.round(len / step);
  for (let i = 0; i <= ticks; i++) {
    const t = new THREE.Mesh(i % r.scaleBarMajorEvery === 0 ? majorTick : minorTick, mat);
    t.position.set(i * step, thick / 2, 0);
    group.add(t);
  }
  return group;
}
