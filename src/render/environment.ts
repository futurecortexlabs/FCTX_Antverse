/**
 * Sky, fog and lighting. The sun casts shadows from an orthographic shadow
 * camera re-fitted every frame around the orbit target, sized to the view:
 * a 2 mm window when looking at a grain, kilometres-scale never needed.
 * Phase 7 replaces the fixed sun with a solar position model.
 */

import * as THREE from 'three/webgpu';
import type { Config } from '../config/params.ts';

export const rgb = (c: readonly number[], o = 0): THREE.Color => new THREE.Color(c[o] ?? 0, c[o + 1] ?? 0, c[o + 2] ?? 0);

export class Environment {
  readonly sun: THREE.DirectionalLight;
  private readonly dir: THREE.Vector3;
  private readonly cfg: Config;

  constructor(scene: THREE.Scene, cfg: Config) {
    this.cfg = cfg;
    const r = cfg.render, tr = cfg.terrainRender;
    scene.background = rgb(r.skyColor);
    scene.fog = new THREE.Fog(rgb(r.skyColor), tr.fogNearFraction * tr.viewHalfExtent, tr.viewHalfExtent);
    scene.add(new THREE.HemisphereLight(rgb(r.skyColor), rgb(tr.soilColors, 3), r.hemiIntensity));
    const [sx, sy, sz] = r.sunDirection;
    this.dir = new THREE.Vector3(sx!, sy!, sz!).normalize();
    this.sun = new THREE.DirectionalLight(0xffffff, r.sunIntensity);
    this.sun.castShadow = tr.shadows;
    this.sun.shadow.mapSize.set(tr.shadowMapSize, tr.shadowMapSize);
    scene.add(this.sun);
    scene.add(this.sun.target);
  }

  /** Re-fit the shadow frustum around `target`, sized by the camera's distance to it. */
  update(camera: THREE.Camera, target: THREE.Vector3): void {
    const tr = this.cfg.terrainRender;
    const [lo, hi] = [tr.shadowExtentRange[0]!, tr.shadowExtentRange[1]!];
    const e = Math.min(hi, Math.max(lo, tr.shadowExtentFactor * camera.position.distanceTo(target)));
    const depth = tr.shadowDepthFactor * e;
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.dir, depth / 2);
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -e; cam.right = e; cam.top = e; cam.bottom = -e;
    cam.near = 0; cam.far = depth;
    cam.updateProjectionMatrix();
    // Bias scaled to one shadow-map texel so it works at every zoom level.
    const texel = (2 * e) / tr.shadowMapSize;
    this.sun.shadow.normalBias = texel;
    this.sun.shadow.bias = -texel / depth;
  }
}
