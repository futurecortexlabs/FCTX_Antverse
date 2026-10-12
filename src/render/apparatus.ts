/**
 * Experimental apparatus (Phase 3): the double bridge's walkway, nest and
 * feeding arenas drawn as thin surfaces on the (flat) ground, and the trail
 * pheromone on top of them as a heatmap. Homing scenario (Phase 4): the nest
 * entrance and the feeder as discs draped over the natural ground.
 */

import * as THREE from 'three/webgpu';
import type { Config } from '../config/params.ts';
import { DoubleBridge, homingSites, type Site } from '../terrain/apparatus.ts';
import type { Terrain } from '../terrain/terrain.ts';
import type { FieldInfo } from '../worker/protocol.ts';
import { rgb } from './environment.ts';

const CAP_SEGMENTS = 24;
/** Concentric rings of a draped disc, so it follows the relief inside it too. */
const DRAPE_RINGS = 12;

/** A disc lying on the terrain surface (vertices at supportHeight + lift). */
function drapedDisc(terrain: Terrain, c: Site, lift: number, color: THREE.Color): THREE.Mesh {
  const geo = new THREE.RingGeometry(0, c.r, CAP_SEGMENTS * 2, DRAPE_RINGS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrain.supportHeight(c.x + pos.getX(i), c.z + pos.getZ(i)) + lift);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ color, roughness: 0.9 }));
  m.position.set(c.x, 0, c.z);
  m.receiveShadow = true;
  return m;
}

/** Walkway (capsules), nest and feeder discs. Returns null when the scenario has no apparatus. */
export function buildApparatus(cfg: Config, terrain: Terrain): THREE.Group | null {
  if (cfg.scenario.colony) {
    // The colony's feeders (the entrance itself is drawn by the nest).
    const group = new THREE.Group();
    group.name = 'colony-sites';
    const f = cfg.scenario.feeders as readonly number[];
    for (let i = 0; i + 1 < f.length; i += 2) {
      group.add(drapedDisc(terrain, { x: f[i]!, z: f[i + 1]!, r: cfg.scenario.feederRadius }, cfg.render.siteLift, rgb(cfg.render.feederColor)));
    }
    return group;
  }
  if (cfg.scenario.homing && !cfg.scenario.doubleBridge) {
    const { nest, feeder } = homingSites(cfg);
    const group = new THREE.Group();
    group.name = 'homing-sites';
    group.add(drapedDisc(terrain, nest, cfg.render.siteLift, rgb(cfg.render.nestColor)));
    group.add(drapedDisc(terrain, feeder, cfg.render.siteLift, rgb(cfg.render.feederColor)));
    return group;
  }
  if (!cfg.scenario.doubleBridge) return null;
  const b = new DoubleBridge(cfg);
  const r = cfg.render;
  const group = new THREE.Group();
  group.name = 'apparatus';
  const y = terrain.supportHeight(b.nest.x, 0) + r.apparatusLift;
  const flat = (geo: THREE.BufferGeometry, color: THREE.Color, lift: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ color, roughness: 0.9 }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = y + lift;
    m.receiveShadow = true;
    return m;
  };
  const walk = rgb(r.walkwayColor);
  const w = b.half * 2;
  for (const g of b.segments) {
    const len = Math.hypot(g.x1 - g.x0, g.z1 - g.z0);
    const strip = flat(new THREE.PlaneGeometry(len, w), walk, 0);
    strip.position.x = (g.x0 + g.x1) / 2;
    strip.position.z = (g.z0 + g.z1) / 2;
    // Plane x along the segment: yaw so that local +x points from (x0, z0) to (x1, z1).
    strip.rotation.set(-Math.PI / 2, 0, Math.atan2(-(g.z1 - g.z0), g.x1 - g.x0));
    group.add(strip);
    for (const [x, z] of [[g.x0, g.z0], [g.x1, g.z1]] as const) {
      const cap = flat(new THREE.CircleGeometry(b.half, CAP_SEGMENTS), walk, 0);
      cap.position.x = x;
      cap.position.z = z;
      group.add(cap);
    }
  }
  const lift = r.apparatusLift; // arenas sit just above the walkway so they win the depth test
  for (const [c, color] of [[b.nest, r.nestColor], [b.feeder, r.feederColor]] as const) {
    const disc = flat(new THREE.CircleGeometry(c.r, CAP_SEGMENTS * 2), rgb(color), lift);
    disc.position.x = c.x;
    disc.position.z = c.z;
    group.add(disc);
  }
  return group;
}

/** Centre and longest side of the apparatus (for placing the camera). */
export function apparatusFrame(cfg: Config): { x: number; z: number; size: number } | null {
  if (cfg.scenario.homing && !cfg.scenario.doubleBridge) {
    const { feeder } = homingSites(cfg);
    return { x: feeder.x / 2, z: feeder.z / 2, size: 2 * cfg.scenario.feederDistance };
  }
  if (!cfg.scenario.doubleBridge) return null;
  const b = new DoubleBridge(cfg);
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, size: Math.max(b.maxX - b.minX, b.maxZ - b.minZ) };
}

/**
 * The heatmap's rectangle as a grid draped over the ground (vertices every
 * render.pheromoneDrape mm, on the support surface + siteLift). Texture rows
 * are written flipped (see update()): v = 1 − (z − zmin) / depth.
 */
function drapedGrid(info: FieldInfo, cfg: Config, terrain: Terrain): THREE.BufferGeometry {
  const w = info.nx * info.cell, d = info.nz * info.cell;
  const xmin = info.x0 - info.cell / 2, zmin = info.z0 - info.cell / 2;
  const nu = Math.max(1, Math.ceil(w / cfg.render.pheromoneDrape)), nv = Math.max(1, Math.ceil(d / cfg.render.pheromoneDrape));
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3), uv = new Float32Array((nu + 1) * (nv + 1) * 2);
  const index: number[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const k = j * (nu + 1) + i, x = xmin + (w * i) / nu, z = zmin + (d * j) / nv;
    pos[3 * k] = x; pos[3 * k + 1] = terrain.supportHeight(x, z) + cfg.render.siteLift; pos[3 * k + 2] = z;
    uv[2 * k] = i / nu; uv[2 * k + 1] = 1 - j / nv;
    if (i < nu && j < nv) index.push(k, k + nu + 1, k + 1, k + 1, k + nu + 1, k + nu + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

/**
 * Pheromone heatmap: one texel per grid node, on a plane just above the
 * apparatus. Opacity follows log(concentration) between pheromoneRange[0]
 * (invisible) and pheromoneRange[1] (pheromoneOpacity).
 */
export class PheromoneOverlay {
  readonly mesh: THREE.Mesh;
  private readonly info: FieldInfo;
  private readonly pixels: Uint8Array;
  private readonly texture: THREE.DataTexture;
  private readonly cfg: Config;
  private last = -Infinity;

  /** terrain: drape the heatmap over open ground (colony) instead of a flat plane over the apparatus. */
  constructor(info: FieldInfo, cfg: Config, groundY: number, terrain?: Terrain) {
    this.info = info;
    this.cfg = cfg;
    this.pixels = new Uint8Array(info.nx * info.nz * 4);
    this.texture = new THREE.DataTexture(this.pixels, info.nx, info.nz, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    // Texel centres on the grid nodes: the plane covers nx × nz cells centred on the node rectangle.
    const mat = new THREE.MeshBasicNodeMaterial({ map: this.texture, transparent: true, depthWrite: false });
    if (terrain) {
      this.mesh = new THREE.Mesh(drapedGrid(info, cfg, terrain), mat);
      this.mesh.name = 'pheromone';
      this.mesh.renderOrder = 1;
      this.mesh.visible = cfg.render.showPheromone;
      return;
    }
    const geo = new THREE.PlaneGeometry(info.nx * info.cell, info.nz * info.cell);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'pheromone';
    // Rotating the XY plane by −90° about X sends +y to −z: texture row 0 (v = 0) lies at the largest z,
    // so rows are written flipped in update().
    this.mesh.rotation.x = -Math.PI / 2;
    // Layers above the ground: walkway 1×, arenas 2×, heatmap 3× apparatusLift.
    this.mesh.position.set(info.x0 + (info.nx - 1) * info.cell / 2, groundY + 3 * cfg.render.apparatusLift, info.z0 + (info.nz - 1) * info.cell / 2);
    this.mesh.renderOrder = 1;
    this.mesh.visible = cfg.render.showPheromone;
  }

  /** Refresh the texture from the grid at most every pheromoneInterval ms. */
  update(now: number, data: Float32Array): void {
    const r = this.cfg.render;
    if (!this.mesh.visible || now - this.last < r.pheromoneInterval) return;
    this.last = now;
    const { nx, nz } = this.info;
    const [lo, hi] = r.pheromoneRange as [number, number];
    const span = Math.log(hi / lo);
    const [cr, cg, cb] = r.pheromoneColor as [number, number, number];
    const R = Math.round(cr * 255), G = Math.round(cg * 255), B = Math.round(cb * 255);
    const px = this.pixels;
    for (let j = 0; j < nz; j++) {
      const row = (nz - 1 - j) * nx;
      for (let i = 0; i < nx; i++) {
        const c = data[j * nx + i]!;
        const t = c > lo ? Math.min(1, Math.log(c / lo) / span) : 0;
        const o = (row + i) * 4;
        px[o] = R; px[o + 1] = G; px[o + 2] = B;
        px[o + 3] = Math.round(t * r.pheromoneOpacity * 255);
      }
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
