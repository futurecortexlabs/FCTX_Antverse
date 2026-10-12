/**
 * Water for display (Phase 7):
 *
 * - drops sitting on leaves and stones, from the simulation: clear domes
 *   (a drop of this size is shaped by surface tension, nearly a sphere cap
 *   on a water-repellent leaf);
 * - falling rain around the camera's point of interest. The simulation does
 *   not track individual raindrops in the air, so the view draws them at the
 *   rate the rain brings them (env intensity / drop volume per mm²): at ant
 *   scale rain is a sparse bombardment of large drops, each one an event.
 *   A raindrop falls at several m/s — mm per frame — so it is drawn as the
 *   streak it makes during one frame, followed by a splash ring.
 *
 * Purely visual: nothing here feeds back into the simulation.
 */

import * as THREE from 'three/webgpu';
import type { Config } from '../config/params.ts';
import { Environment as Climate } from '../env/environment.ts';
import { S_PER_H } from '../core/units.ts';
import type { Terrain } from '../terrain/terrain.ts';
import { rgb } from './environment.ts';

interface Splash { x: number; y: number; z: number; born: number }

export class WaterView {
  readonly group = new THREE.Group();
  private readonly cfg: Config;
  private readonly terrain: Terrain;
  private readonly climate: Climate;
  private readonly drops: THREE.InstancedMesh;
  private readonly streaks: THREE.InstancedMesh;
  private readonly rings: THREE.InstancedMesh;
  private splashes: Splash[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(cfg: Config, terrain: Terrain) {
    this.cfg = cfg;
    this.terrain = terrain;
    this.climate = new Climate(cfg);
    const r = cfg.render;
    const water = new THREE.MeshStandardNodeMaterial({ color: rgb(r.waterColor), roughness: 0.04, metalness: 0.2, transparent: true, opacity: r.dropOpacity, depthWrite: false });
    this.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), water, cfg.env.dropCapacity);
    this.drops.count = 0;
    this.drops.name = 'drops';
    this.group.add(this.drops);
    const streak = new THREE.MeshBasicNodeMaterial({ color: rgb(r.waterColor), transparent: true, opacity: r.rainOpacity, depthWrite: false });
    this.streaks = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), streak, r.rainMaxStreaks);
    this.streaks.count = 0;
    this.group.add(this.streaks);
    const ring = new THREE.MeshBasicNodeMaterial({ color: rgb(r.waterColor), transparent: true, opacity: r.rainOpacity, side: THREE.DoubleSide, depthWrite: false });
    this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.8, 1, 24), ring, r.rainMaxStreaks);
    this.rings.count = 0;
    this.group.add(this.rings);
  }

  /** Drops from the simulation: [x, y, z, r] per drop. */
  setDrops(data: Float32Array): void {
    const n = Math.min(this.cfg.env.dropCapacity, data.length / 4);
    const h = this.cfg.render.dropHeight;
    this.q.identity();
    for (let k = 0; k < n; k++) {
      const r = data[4 * k + 3]!;
      this.p.set(data[4 * k]!, data[4 * k + 1]!, data[4 * k + 2]!);
      this.s.set(r, r * h, r);
      this.m.compose(this.p, this.q, this.s);
      this.drops.setMatrixAt(k, this.m);
    }
    this.drops.count = n;
    this.drops.instanceMatrix.needsUpdate = true;
  }

  /**
   * Falling rain at simulated time t, around `target`, over a square `extent` mm wide;
   * frameSeconds of simulated time pass this frame. Splashes last rainSplash of simulated time.
   */
  update(t: number, frameSeconds: number, target: THREE.Vector3, extent: number): void {
    const now = t;
    const r = this.cfg.render, e = this.cfg.env;
    const mmh = this.climate.rain(t);
    let streaks = 0;
    if (mmh > 0 && frameSeconds > 0) {
      const flux = mmh / S_PER_H / ((Math.PI / 6) * e.rainDrop * e.rainDrop * e.rainDrop);
      // Poisson draw of the drops landing in view this frame (render-side randomness is fine: visual only).
      let n = 0;
      const mean = flux * extent * extent * frameSeconds;
      for (let L = Math.exp(-Math.min(mean, r.rainMaxStreaks)), p = Math.random(); p > L && n < r.rainMaxStreaks; p *= Math.random()) n++;
      const len = r.rainSpeed * frameSeconds;
      const rad = e.rainDrop / 2;
      for (let k = 0; k < n; k++) {
        const x = target.x + (Math.random() - 0.5) * extent, z = target.z + (Math.random() - 0.5) * extent;
        const y = this.terrain.supportHeight(x, z);
        this.p.set(x, y + len / 2, z);
        this.s.set(rad, len, rad);
        this.q.identity();
        this.m.compose(this.p, this.q, this.s);
        this.streaks.setMatrixAt(streaks++, this.m);
        this.splashes.push({ x, y, z, born: now });
      }
    }
    this.streaks.count = streaks;
    this.streaks.instanceMatrix.needsUpdate = true;
    // Splash rings: grow and fade over rainSplash seconds of wall time.
    this.splashes = this.splashes.filter((s) => now - s.born < r.rainSplash).slice(-r.rainMaxStreaks);
    const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    this.splashes.forEach((s, i) => {
      const age = (now - s.born) / r.rainSplash;
      const size = e.rainDrop * (0.5 + age);
      this.p.set(s.x, s.y + this.cfg.render.siteLift, s.z);
      this.s.set(size, size, size);
      this.m.compose(this.p, flat, this.s);
      this.rings.setMatrixAt(i, this.m);
    });
    this.rings.count = this.splashes.length;
    this.rings.instanceMatrix.needsUpdate = true;
  }
}
