/**
 * Sky, fog and lighting. The sun casts shadows from an orthographic shadow
 * camera re-fitted every frame around the orbit target, sized to the view:
 * a 2 mm window when looking at a grain, kilometres-scale never needed.
 * With the environment on (Phase 7) the sun follows the solar position model
 * (src/env) and the sky, fog and fill light dim with the light level.
 */

import * as THREE from 'three/webgpu';
import type { Config } from '../config/params.ts';
import { Environment as Climate, type Sun } from '../env/environment.ts';

export const rgb = (c: readonly number[], o = 0): THREE.Color => new THREE.Color(c[o] ?? 0, c[o + 1] ?? 0, c[o + 2] ?? 0);

export class Environment {
  readonly sun: THREE.DirectionalLight;
  private readonly dir: THREE.Vector3;
  private readonly cfg: Config;
  private readonly scene: THREE.Scene;
  private readonly hemi: THREE.HemisphereLight;
  private readonly climate: Climate;
  private readonly sunPos: Sun = { elevation: 0, azimuth: 0, x: 0, y: 1, z: 0 };
  private readonly day: THREE.Color;
  private readonly night: THREE.Color;
  private lastTime = Number.NaN;

  constructor(scene: THREE.Scene, cfg: Config) {
    this.cfg = cfg;
    this.scene = scene;
    this.climate = new Climate(cfg);
    const r = cfg.render, tr = cfg.terrainRender;
    this.day = rgb(r.skyColor);
    this.night = rgb(r.nightSkyColor);
    scene.background = this.day.clone();
    const [fogNear, fogFar] = tr.fogRange as readonly [number, number];
    scene.fog = new THREE.Fog(this.day.clone(), fogNear, fogFar);
    this.hemi = new THREE.HemisphereLight(rgb(r.skyColor), rgb(tr.soilColors, 3), r.hemiIntensity);
    scene.add(this.hemi);
    const [sx, sy, sz] = r.sunDirection;
    this.dir = new THREE.Vector3(sx!, sy!, sz!).normalize();
    this.sun = new THREE.DirectionalLight(0xffffff, r.sunIntensity);
    this.sun.castShadow = tr.shadows;
    this.sun.shadow.mapSize.set(tr.shadowMapSize, tr.shadowMapSize);
    scene.add(this.sun);
    scene.add(this.sun.target);
  }

  /**
   * Light for simulated time t (s): the sun's direction and strength, sky and fog colour.
   * Without the environment, the fixed noon sun of the config.
   */
  setTime(t: number): void {
    if (!this.climate.enabled || t === this.lastTime) return;
    this.lastTime = t;
    const r = this.cfg.render;
    const s = this.climate.sun(t, this.sunPos);
    const light = this.climate.light(t);
    // Below the horizon the shadow-casting sun is off; the night keeps a faint fill light.
    if (s.elevation > 0) this.dir.set(s.x, s.y, s.z);
    this.sun.intensity = s.elevation > 0 ? r.sunIntensity * light : 0;
    const fill = Math.max(r.nightLight, light);
    this.hemi.intensity = r.hemiIntensity * fill;
    const sky = this.night.clone().lerp(this.day, Math.min(1, light / r.dayLight));
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);
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
