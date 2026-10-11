/**
 * Renderers for the objects lying on the soil. Every shape is built from the
 * same Terrain data the simulation queries (ellipsoid radii and orientation,
 * leaf drape grids, blade centre lines), so what is drawn is what a foot
 * would touch.
 */

import * as THREE from 'three/webgpu';
import type { Config } from '../../config/params.ts';
import { GRAIN_STRIDE, type Terrain } from '../../terrain/terrain.ts';
import { leafMaterial } from './leaf-material.ts';

/** Pick a colour from a flat rgb palette by tone in [0,1), blending neighbours. */
function paletteColor(pal: readonly number[], tone: number, out: THREE.Color): THREE.Color {
  const n = pal.length / 3;
  const f = tone * (n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  const t = n > 1 ? f - i : 0;
  const j = n > 1 ? i + 1 : i;
  return out.setRGB(
    pal[3 * i]! + (pal[3 * j]! - pal[3 * i]!) * t,
    pal[3 * i + 1]! + (pal[3 * j + 1]! - pal[3 * i + 1]!) * t,
    pal[3 * i + 2]! + (pal[3 * j + 2]! - pal[3 * i + 2]!) * t,
  );
}

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const quat = new THREE.Quaternion();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const mat = new THREE.Matrix4();
const col = new THREE.Color();

/** Ellipsoid matrix: Euler YXZ (x = tilt, y = yaw), scale (a, c, b) — see terrain/shapes.ts. */
function ellipsoidMatrix(cx: number, cy: number, cz: number, a: number, b: number, c: number, yaw: number, tilt: number): THREE.Matrix4 {
  euler.set(tilt, yaw, 0, 'YXZ');
  quat.setFromEuler(euler);
  return mat.compose(pos.set(cx, cy, cz), quat, scl.set(a, c, b));
}

export function buildPebbles(terrain: Terrain, cfg: Config): THREE.InstancedMesh {
  const P = terrain.pebbles;
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, cfg.terrainRender.pebbleDetail),
    new THREE.MeshStandardNodeMaterial({ roughness: cfg.terrainRender.objectRoughness[0]!, metalness: 0 }),
    Math.max(1, P.count),
  );
  for (let i = 0; i < P.count; i++) {
    mesh.setMatrixAt(i, ellipsoidMatrix(P.center[3 * i]!, P.center[3 * i + 1]!, P.center[3 * i + 2]!, P.radii[3 * i]!, P.radii[3 * i + 1]!, P.radii[3 * i + 2]!, P.yaw[i]!, P.tilt[i]!));
    mesh.setColorAt(i, paletteColor(cfg.terrainRender.pebbleColors, P.tone[i]!, col));
  }
  mesh.count = P.count;
  mesh.castShadow = cfg.terrainRender.shadows;
  mesh.receiveShadow = true;
  mesh.name = 'pebbles';
  mesh.computeBoundingSphere();
  return mesh;
}

export function buildLeaves(terrain: Terrain, cfg: Config): THREE.Mesh {
  const L = terrain.leaves;
  const t = cfg.terrain;
  const nu = L.nu, nv = L.nv, per = (nu + 1) * (nv + 1);
  const positions = new Float32Array(L.count * per * 3);
  const colors = new Float32Array(L.count * per * 3);
  const uvs = new Float32Array(L.count * per * 2);
  const indices = new Uint32Array(L.count * nu * nv * 6);
  let w = 0;
  for (let k = 0; k < L.count; k++) {
    paletteColor(cfg.terrainRender.leafColors, L.tone[k]!, col);
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const v = k * per + i * (nv + 1) + j;
      const [x, z, tt] = terrain.leafNode(k, i, j);
      positions[3 * v] = x;
      positions[3 * v + 1] = L.heights[v]! + t.leafThickness / 2;
      positions[3 * v + 2] = z;
      // Slightly darker towards the margin; veins are drawn by the leaf material from uv.
      const shade = 1 - cfg.terrainRender.leafEdgeDarken * tt * tt;
      uvs[2 * v] = i / nu;
      uvs[2 * v + 1] = tt;
      colors[3 * v] = col.r * shade; colors[3 * v + 1] = col.g * shade; colors[3 * v + 2] = col.b * shade;
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = k * per + i * (nv + 1) + j, b = a + 1, c = a + (nv + 1), d = c + 1;
      indices[w++] = a; indices[w++] = b; indices[w++] = c;
      indices[w++] = b; indices[w++] = d; indices[w++] = c;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, leafMaterial(cfg));
  mesh.castShadow = cfg.terrainRender.shadows;
  mesh.receiveShadow = true;
  mesh.name = 'leaves';
  return mesh;
}

export function buildGrass(terrain: Terrain, cfg: Config): THREE.Mesh {
  const G = terrain.grass;
  const S = cfg.terrain.bladeSegments;
  const pts = new Float64Array((S + 1) * 3);
  const vper = 2 * S + 1; // two per segment row, single tip vertex
  const positions = new Float32Array(G.blades * vper * 3);
  const colors = new Float32Array(G.blades * vper * 3);
  const indices = new Uint32Array(G.blades * (2 * (S - 1) + 1) * 3);
  const pal = cfg.terrainRender.grassColors;
  const base = new THREE.Color(), tip = new THREE.Color();
  let w = 0;
  for (let b = 0; b < G.blades; b++) {
    terrain.bladePoints(b, S, pts);
    const yaw = G.yaw[b]!;
    // Lateral axis of the ribbon (horizontal, perpendicular to the lean direction).
    const lx = Math.sin(yaw), lz = Math.cos(yaw);
    const tone = G.tone[b]!;
    base.setRGB(pal[0]!, pal[1]!, pal[2]!).multiplyScalar(1 - cfg.terrainRender.grassToneSpread * tone);
    tip.setRGB(pal[3]!, pal[4]!, pal[5]!).multiplyScalar(1 - cfg.terrainRender.grassToneSpread * tone);
    const v0 = b * vper;
    for (let k = 0; k < S; k++) {
      const sigma = k / S;
      const half = (G.width[b]! / 2) * (1 - sigma);
      const px = pts[3 * k]!, py = pts[3 * k + 1]!, pz = pts[3 * k + 2]!;
      const vl = v0 + 2 * k, vr = vl + 1;
      positions.set([px - lx * half, py, pz - lz * half], 3 * vl);
      positions.set([px + lx * half, py, pz + lz * half], 3 * vr);
      const c = base.clone().lerp(tip, sigma);
      colors.set([c.r, c.g, c.b, c.r, c.g, c.b], 3 * vl);
    }
    const vt = v0 + 2 * S;
    positions.set([pts[3 * S]!, pts[3 * S + 1]!, pts[3 * S + 2]!], 3 * vt);
    colors.set([tip.r, tip.g, tip.b], 3 * vt);
    for (let k = 0; k < S - 1; k++) {
      const a = v0 + 2 * k, bb = a + 1, c = a + 2, d = a + 3;
      indices[w++] = a; indices[w++] = bb; indices[w++] = c;
      indices[w++] = bb; indices[w++] = d; indices[w++] = c;
    }
    const a = v0 + 2 * (S - 1);
    indices[w++] = a; indices[w++] = a + 1; indices[w++] = vt;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: cfg.terrainRender.objectRoughness[2]!, side: THREE.DoubleSide }));
  mesh.castShadow = cfg.terrainRender.shadows;
  mesh.receiveShadow = true;
  mesh.name = 'grass';
  return mesh;
}

/**
 * Coarse sand grains around the camera, regenerated progressively (nearest
 * cells first, within a time budget) when the camera has moved far enough.
 * Only grains that would cover at least grainMinPixels are worth drawing, which
 * bounds the radius.
 */
export class GrainField {
  readonly mesh: THREE.InstancedMesh;
  private offsets: Int32Array = new Int32Array(0);
  private cursor = 0;
  private written = 0;
  private center = new THREE.Vector3(Infinity, 0, Infinity);
  private radiusCells = 0;
  private radius = 0;
  private readonly terrain: Terrain;
  private readonly cfg: Config;

  constructor(terrain: Terrain, cfg: Config) {
    this.terrain = terrain;
    this.cfg = cfg;
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, cfg.terrainRender.grainDetail),
      new THREE.MeshStandardNodeMaterial({ roughness: cfg.terrainRender.objectRoughness[3]!, metalness: 0 }),
      Math.max(1, cfg.terrainRender.grainMaxInstances),
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = cfg.terrainRender.shadows;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'grains';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, col.setRGB(1, 1, 1));
  }

  /** Radius (mm) within which the smallest grain still covers grainMinPixels. */
  visibleRadius(fovRad: number, viewportPx: number): number {
    const focal = viewportPx / 2 / Math.tan(fovRad / 2);
    return (this.cfg.terrain.grainSize[0]! * focal) / this.cfg.terrainRender.grainMinPixels;
  }

  update(camera: THREE.PerspectiveCamera, viewportPx: number, budgetMs: number): void {
    const R = this.visibleRadius((camera.fov * Math.PI) / 180, viewportPx);
    const cell = this.cfg.terrain.grainCell;
    const ground = this.terrain.groundHeight(camera.position.x, camera.position.z);
    const height = camera.position.y - ground;
    const reach = height < R ? Math.sqrt(R * R - height * height) : 0;
    const moved = Math.hypot(camera.position.x - this.center.x, camera.position.z - this.center.z);
    if (moved > this.cfg.terrainRender.grainRebuildFraction * R || Math.abs(reach - this.radius) > this.cfg.terrainRender.grainRebuildFraction * R) {
      this.center.copy(camera.position);
      this.radius = reach;
      const rc = Math.ceil(reach / cell);
      if (rc !== this.radiusCells) this.makeOffsets(rc);
      this.cursor = 0;
      this.written = 0;
    }
    if (this.cursor >= this.offsets.length / 2) return;

    const t0 = performance.now();
    const cx = Math.floor(this.center.x / cell), cz = Math.floor(this.center.z / cell);
    const max = this.mesh.instanceMatrix.count;
    const pal = this.cfg.terrainRender.pebbleColors;
    while (this.cursor < this.offsets.length / 2 && this.written < max) {
      const ix = cx + this.offsets[2 * this.cursor]!, iz = cz + this.offsets[2 * this.cursor + 1]!;
      this.cursor++;
      const g = this.terrain.grainCell(ix, iz);
      for (let o = 0; o < g.length && this.written < max; o += GRAIN_STRIDE) {
        this.mesh.setMatrixAt(this.written, ellipsoidMatrix(g[o]!, g[o + 1]!, g[o + 2]!, g[o + 3]!, g[o + 4]!, g[o + 5]!, g[o + 6]!, g[o + 7]!));
        this.mesh.setColorAt(this.written, paletteColor(pal, g[o + 8]!, col));
        this.written++;
      }
      if ((this.cursor & 63) === 0 && performance.now() - t0 > budgetMs) break;
    }
    this.mesh.count = this.written;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Cell offsets within radius rc, sorted nearest first. */
  private makeOffsets(rc: number): void {
    this.radiusCells = rc;
    const list: [number, number, number][] = [];
    for (let dz = -rc; dz <= rc; dz++) for (let dx = -rc; dx <= rc; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 <= rc * rc) list.push([d2, dx, dz]);
    }
    list.sort((a, b) => a[0] - b[0]);
    this.offsets = new Int32Array(list.length * 2);
    list.forEach(([, dx, dz], i) => { this.offsets[2 * i] = dx; this.offsets[2 * i + 1] = dz; });
  }

  get count(): number {
    return this.written;
  }
}
