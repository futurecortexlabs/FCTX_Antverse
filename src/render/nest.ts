/**
 * The nest of a digging world (Phase 5), for display:
 *
 * - the cast: the surface of the dug-out space, like the plaster or metal
 *   casts used to record real ant nests (Tschinkel). Built per 32³ soil chunk
 *   with naive surface nets over the voxel centres, rebuilt when the chunk or
 *   a neighbour changes. It lies under the ground: switch on the cutaway
 *   (setCutaway) to hide the surface and see it.
 * - the mound of excavated soil around the entrance, a heightfield draped on
 *   the ground.
 *
 * The renderer keeps its own mirror of the soil (built from the same config
 * and terrain, updated with the chunks the worker sends) and reads the mound
 * heights from shared memory or from copies.
 */

import * as THREE from 'three/webgpu';
import type { Config } from '../config/params.ts';
import { CHUNK, Soil } from '../soil/soil.ts';
import type { Terrain } from '../terrain/terrain.ts';
import type { NestInfo, SoilChunk } from '../worker/protocol.ts';
import { rgb } from './environment.ts';

/** Edge directions of the voxel lattice: +x, +d (down), +z. */
const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const;
const SPAN = CHUNK + 2; // cube cache covers the chunk plus a margin of one on each side

export class NestView {
  readonly group = new THREE.Group();
  readonly soil: Soil;
  private readonly castMaterial: THREE.Material;
  private readonly casts = new Map<number, THREE.Mesh>();
  private readonly dirty = new Set<number>();
  private readonly mound: THREE.Mesh;
  private readonly moundGeo: THREE.BufferGeometry;
  private readonly info: NestInfo;
  private readonly terrain: Terrain;
  private readonly base: Float32Array;
  private moundVersion = -1;
  private readonly cfg: Config;

  constructor(cfg: Config, terrain: Terrain, info: NestInfo) {
    this.cfg = cfg;
    this.terrain = terrain;
    this.info = info;
    this.soil = new Soil(cfg, terrain);
    this.group.name = 'nest';
    this.castMaterial = new THREE.MeshStandardNodeMaterial({ color: rgb(cfg.render.castColor), roughness: 0.6, side: THREE.DoubleSide });
    // Mound: one vertex per mound cell, lifted by the pile height over the bare ground.
    const m = info.mound;
    this.base = new Float32Array(m.nx * m.nz);
    const pos = new Float32Array(m.nx * m.nz * 3);
    for (let j = 0; j < m.nz; j++) for (let i = 0; i < m.nx; i++) {
      const k = j * m.nx + i, x = m.x0 + i * m.cell, z = m.z0 + j * m.cell;
      this.base[k] = terrain.groundHeight(x, z);
      pos[3 * k] = x; pos[3 * k + 1] = this.base[k]!; pos[3 * k + 2] = z;
    }
    this.moundGeo = new THREE.BufferGeometry();
    this.moundGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mound = new THREE.Mesh(this.moundGeo, new THREE.MeshStandardNodeMaterial({ color: rgb(cfg.render.moundColor), roughness: 1 }));
    this.mound.name = 'mound';
    this.mound.receiveShadow = true;
    this.mound.castShadow = true;
    this.group.add(this.mound);
  }

  /** Dug chunks from the worker: update the mirror and mark them (and their neighbours) for remeshing. */
  applyChunks(chunks: SoilChunk[]): void {
    for (const c of chunks) {
      this.soil.applyChunk(c.key, c.data);
      const [ox, od, oz] = this.soil.chunkOrigin(c.key);
      for (let dz = -1; dz <= 1; dz++) for (let dd = -1; dd <= 1; dd++) for (let dx = -1; dx <= 1; dx++) {
        const x = ox + dx * CHUNK, d = od + dd * CHUNK, z = oz + dz * CHUNK;
        if (this.soil.inBounds(x, d, z)) this.dirty.add(this.soil.chunkKeyOf(x, d, z));
      }
    }
  }

  /** Remesh up to `budget` dirty chunks; refresh the mound when its heights changed. */
  update(moundHeights: Float32Array | null, moundVersion: number, budget: number): void {
    let n = 0;
    for (const key of [...this.dirty]) {
      if (n++ >= budget) break;
      this.dirty.delete(key);
      this.remesh(key);
    }
    if (moundHeights && moundVersion !== this.moundVersion) {
      this.moundVersion = moundVersion;
      this.updateMound(moundHeights);
    }
  }

  /** Shared-memory mounds change without a message: compare a cheap checksum instead. */
  sharedMoundChanged(heights: Float32Array): boolean {
    let s = 0;
    for (let k = 0; k < heights.length; k += 7) s += heights[k]!;
    const changed = s !== this.lastSum;
    this.lastSum = s;
    return changed;
  }

  private lastSum = 0;

  /** Hide the surface world (ground, objects) and show the nest from below. */
  setCutaway(on: boolean, surface: THREE.Object3D[]): void {
    for (const o of surface) o.visible = !on;
  }

  private updateMound(h: Float32Array): void {
    const m = this.info.mound;
    const pos = this.moundGeo.attributes.position as THREE.BufferAttribute;
    const lift = this.cfg.render.siteLift;
    const index: number[] = [];
    for (let k = 0; k < h.length; k++) pos.setY(k, this.base[k]! + h[k]! + lift);
    // Only cells with soil on them, so the bare ground shows elsewhere.
    for (let j = 0; j < m.nz - 1; j++) for (let i = 0; i < m.nx - 1; i++) {
      const a = j * m.nx + i, b = a + 1, c = a + m.nx, d = c + 1;
      if (h[a]! + h[b]! + h[c]! + h[d]! <= 0) continue;
      index.push(a, c, b, b, c, d);
    }
    pos.needsUpdate = true;
    this.moundGeo.setIndex(index);
    this.moundGeo.computeVertexNormals();
    this.mound.visible = index.length > 0;
  }

  /** Surface nets over the voxel centres of one chunk (the boundary between dug and undug voxels). */
  private remesh(key: number): void {
    const old = this.casts.get(key);
    if (old) { this.group.remove(old); old.geometry.dispose(); this.casts.delete(key); }
    const soil = this.soil;
    const [ox, od, oz] = soil.chunkOrigin(key);
    const dug = (ix: number, d: number, iz: number): boolean => soil.isDug(ix, d, iz);
    // Cube (ix, d, iz) has corners at the voxel centres (ix..ix+1, d..d+1, iz..iz+1); cache its vertex index.
    const cubeIndex = new Int32Array(SPAN * SPAN * SPAN).fill(-1);
    const positions: number[] = [];
    const vertex = (cx: number, cd: number, cz: number): number => {
      const li = ((cz - oz + 1) * SPAN + (cd - od + 1)) * SPAN + (cx - ox + 1);
      if (cubeIndex[li]! >= 0) return cubeIndex[li]!;
      // Average of the midpoints of the cube edges whose two ends differ.
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (let c = 0; c < 8; c++) {
        const ax = cx + (c & 1), ad = cd + ((c >> 1) & 1), az = cz + ((c >> 2) & 1);
        for (const [ex, ed, ez] of AXES) {
          const bx = ax + ex, bd = ad + ed, bz = az + ez;
          if (bx > cx + 1 || bd > cd + 1 || bz > cz + 1) continue;
          if (dug(ax, ad, az) === dug(bx, bd, bz)) continue;
          sx += ax + ex / 2; sy += ad + ed / 2; sz += az + ez / 2; n++;
        }
      }
      const idx = positions.length / 3;
      positions.push(soil.centreX(0) + sx / n, soil.centreY(0) - sy / n, soil.centreZ(0) + sz / n);
      cubeIndex[li] = idx;
      return idx;
    };
    const index: number[] = [];
    for (let iz = oz; iz < oz + CHUNK; iz++) for (let d = od; d < od + CHUNK; d++) for (let ix = ox; ix < ox + CHUNK; ix++) {
      if (!soil.inBounds(ix, d, iz)) continue;
      const here = dug(ix, d, iz);
      for (let axis = 0; axis < 3; axis++) {
        const [ex, ed, ez] = AXES[axis]!;
        if (here === dug(ix + ex, d + ed, iz + ez)) continue;
        // The four cubes around this edge, in order round it.
        let q: [number, number, number][];
        if (axis === 0) q = [[ix, d - 1, iz - 1], [ix, d, iz - 1], [ix, d, iz], [ix, d - 1, iz]];
        else if (axis === 1) q = [[ix - 1, d, iz - 1], [ix, d, iz - 1], [ix, d, iz], [ix - 1, d, iz]];
        else q = [[ix - 1, d - 1, iz], [ix, d - 1, iz], [ix, d, iz], [ix - 1, d, iz]];
        const v = q.map(([a, b, c]) => vertex(a, b, c));
        index.push(v[0]!, v[1]!, v[2]!, v[0]!, v[2]!, v[3]!);
      }
    }
    if (index.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.castMaterial);
    mesh.name = `cast-${key}`;
    this.casts.set(key, mesh);
    this.group.add(mesh);
  }

  /** Remaining chunks to remesh (for tests and the HUD). */
  get pending(): number {
    return this.dirty.size;
  }
}
