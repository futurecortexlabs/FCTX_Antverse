/**
 * Ground renderer: keeps chunk meshes for the quadtree nodes the camera
 * needs, builds missing ones within a per-frame time budget (coarse levels
 * and near chunks first), and evicts the least recently used.
 */

import * as THREE from 'three/webgpu';
import type { Config } from '../../config/params.ts';
import type { Terrain } from '../../terrain/terrain.ts';
import { buildChunk } from './chunk-builder.ts';
import { groundMaterial } from './ground-material.ts';
import {
  levelErrors, nodeKey, nodeOrigin, nodeSize, selectNodes, type NodeRef, type QuadParams,
} from './quadtree.ts';

interface Entry {
  mesh: THREE.Mesh;
  used: number;
}

export interface GroundStats {
  drawn: number;
  cached: number;
  pending: number;
  builtThisFrame: number;
  buildMs: number;
  triangles: number;
}

export class GroundRenderer {
  readonly group = new THREE.Group();
  readonly params: QuadParams;
  readonly errors: Float64Array;
  private readonly cache = new Map<number, Entry>();
  private readonly material: THREE.Material;
  private frame = 0;
  private wanted: { n: NodeRef; d: number }[] = [];
  readonly stats: GroundStats = { drawn: 0, cached: 0, pending: 0, builtThisFrame: 0, buildMs: 0, triangles: 0 };
  private readonly terrain: Terrain;
  private readonly cfg: Config;

  constructor(terrain: Terrain, cfg: Config) {
    this.terrain = terrain;
    this.cfg = cfg;
    const r = cfg.terrainRender;
    this.params = {
      halfExtent: r.viewHalfExtent,
      chunkQuads: r.chunkQuads,
      minSpacing: r.minSpacing,
      maxScreenError: r.maxScreenError,
      reliefBound: terrain.reliefBound(),
      errorAt: (h) => terrain.reliefDeviation(h, r.errorSigmas),
    };
    this.errors = levelErrors(this.params);
    this.material = groundMaterial(terrain, cfg);
    this.group.name = 'ground';
    this.build({ level: 0, ix: 0, iz: 0 }); // the root must always exist
  }

  private build(n: NodeRef): Entry {
    const size = nodeSize(this.params, n.level);
    const [x0, z0] = nodeOrigin(this.params, n);
    const d = buildChunk(this.terrain, this.cfg, x0, z0, size);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3));
    g.setIndex(new THREE.BufferAttribute(d.indices, 1));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, d.minY, 0), new THREE.Vector3(size, d.maxY, size));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(g, this.material);
    mesh.position.set(d.originX, 0, d.originZ);
    mesh.receiveShadow = true;
    mesh.castShadow = this.cfg.terrainRender.shadows;
    mesh.userData.spacing = d.spacing;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = `chunk-${n.level}-${n.ix}-${n.iz}`;
    const e = { mesh, used: this.frame };
    this.cache.set(nodeKey(n.level, n.ix, n.iz), e);
    return e;
  }

  /** Select, build within budget, and update the drawn set for this camera position and focal length (px). */
  update(camera: THREE.Vector3, focal: number): void {
    this.frame++;
    const ready = (n: NodeRef): boolean => this.cache.has(nodeKey(n.level, n.ix, n.iz));
    this.wanted = [];
    let nodes = selectNodes(this.params, this.errors, camera.x, camera.y, camera.z, focal, ready, (n, d) => this.wanted.push({ n, d }));

    // Build missing nodes: coarse levels first, then nearest.
    const t0 = performance.now();
    let built = 0;
    if (this.wanted.length > 0) {
      this.wanted.sort((a, b) => a.n.level - b.n.level || a.d - b.d);
      for (const w of this.wanted) {
        if (ready(w.n)) continue;
        this.build(w.n);
        built++;
        if (performance.now() - t0 > this.cfg.terrainRender.genBudget) break;
      }
      if (built > 0) nodes = selectNodes(this.params, this.errors, camera.x, camera.y, camera.z, focal, ready, () => {});
    }

    this.group.clear();
    let tris = 0;
    for (const n of nodes) {
      const e = this.cache.get(nodeKey(n.level, n.ix, n.iz))!;
      e.used = this.frame;
      this.group.add(e.mesh);
      tris += (e.mesh.geometry.index?.count ?? 0) / 3;
    }
    this.evict();
    Object.assign(this.stats, {
      drawn: nodes.length, cached: this.cache.size, pending: Math.max(0, this.wanted.length - built),
      builtThisFrame: built, buildMs: performance.now() - t0, triangles: tris,
    });
  }

  private evict(): void {
    const cap = this.cfg.terrainRender.cacheChunks;
    if (this.cache.size <= cap) return;
    const entries = [...this.cache.entries()].filter(([k]) => k !== nodeKey(0, 0, 0)).sort((a, b) => a[1].used - b[1].used);
    for (const [k, e] of entries.slice(0, this.cache.size - cap)) {
      if (e.used === this.frame) break;
      e.mesh.geometry.dispose();
      this.cache.delete(k);
    }
  }

  /** True while chunks the current view needs are still being built. */
  get busy(): boolean {
    return this.stats.pending > 0;
  }
}
