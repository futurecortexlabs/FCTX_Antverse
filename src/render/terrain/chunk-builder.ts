/**
 * Mesh data for one ground chunk: (N+1)² vertices sampled from the terrain
 * with the octaves band-limited to the chunk's vertex spacing, analytic
 * normals, soil colours, and skirts hanging from the four edges to hide
 * cracks against neighbours of a different level. Pure data (no three.js).
 */

import type { Config } from '../../config/params.ts';
import { fbmAdd, newSample } from '../../terrain/noise.ts';
import type { Terrain } from '../../terrain/terrain.ts';

export interface ChunkData {
  /** Positions relative to (originX, 0, originZ). */
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint16Array | Uint32Array;
  originX: number;
  originZ: number;
  /** Vertex spacing (mm): octaves shorter than ~4× this are left to per-pixel shading. */
  spacing: number;
  minY: number;
  maxY: number;
}

const s = newSample();
const m = newSample();

/**
 * Skirt depth for a chunk with this vertex spacing: the worst-case deviation
 * of a mesh 2^skirtLevels times coarser, so a crack against any neighbour up
 * to that many levels coarser is closed (both meshes deviate from the true
 * surface by at most that much).
 */
export function skirtDepth(terrain: Terrain, cfg: Config, spacing: number): number {
  const r = cfg.terrainRender;
  return r.skirtFactor * terrain.reliefDeviation(spacing * 2 ** r.skirtLevels);
}

export function buildChunk(terrain: Terrain, cfg: Config, originX: number, originZ: number, size: number): ChunkData {
  const N = cfg.terrainRender.chunkQuads;
  const h = size / N;
  const grid = (N + 1) * (N + 1);
  const skirt = 4 * (N + 1);
  const vcount = grid + skirt;
  const positions = new Float32Array(vcount * 3);
  const normals = new Float32Array(vcount * 3);
  const colors = new Float32Array(vcount * 3);
  const sc = cfg.terrainRender.soilColors;
  const range = cfg.terrainRender.soilShadeRange;
  let minY = Infinity, maxY = -Infinity;

  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const v = j * (N + 1) + i;
      const x = originX + i * h, z = originZ + j * h;
      // Same sum as Terrain.ground, split so the micro part can drive the soil shading.
      s.v = 0; s.dx = 0; s.dz = 0;
      fbmAdd(x, z, terrain.macro, h, s);
      m.v = 0; m.dx = 0; m.dz = 0;
      fbmAdd(x, z, terrain.micro, h, m);
      s.v += m.v; s.dx += m.dx; s.dz += m.dz;
      positions[3 * v] = i * h;
      positions[3 * v + 1] = s.v;
      positions[3 * v + 2] = j * h;
      const inv = 1 / Math.sqrt(s.dx * s.dx + 1 + s.dz * s.dz);
      normals[3 * v] = -s.dx * inv;
      normals[3 * v + 1] = inv;
      normals[3 * v + 2] = -s.dz * inv;
      const t = Math.min(1, Math.max(0, 0.5 + m.v / range));
      const lo = t < 0.5 ? 0 : 3, f = t < 0.5 ? t * 2 : t * 2 - 1;
      for (let c = 0; c < 3; c++) colors[3 * v + c] = sc[lo + c]! + (sc[lo + 3 + c]! - sc[lo + c]!) * f;
      if (s.v < minY) minY = s.v;
      if (s.v > maxY) maxY = s.v;
    }
  }

  // Skirts: copies of the edge vertices, lowered.
  const depth = skirtDepth(terrain, cfg, h);
  const edges: number[][] = [[], [], [], []];
  for (let k = 0; k <= N; k++) {
    edges[0]!.push(k);                 // z = 0 (north)
    edges[1]!.push(N * (N + 1) + k);   // z = N (south)
    edges[2]!.push(k * (N + 1));       // x = 0 (west)
    edges[3]!.push(k * (N + 1) + N);   // x = N (east)
  }
  let sv = grid;
  const skirtStart: number[] = [];
  for (const e of edges) {
    skirtStart.push(sv);
    for (const v of e) {
      positions[3 * sv] = positions[3 * v]!;
      positions[3 * sv + 1] = positions[3 * v + 1]! - depth;
      positions[3 * sv + 2] = positions[3 * v + 2]!;
      for (let c = 0; c < 3; c++) { normals[3 * sv + c] = normals[3 * v + c]!; colors[3 * sv + c] = colors[3 * v + c]!; }
      sv++;
    }
  }

  const tris = N * N * 2 + 4 * N * 2;
  const indices = vcount > 0xffff ? new Uint32Array(tris * 3) : new Uint16Array(tris * 3);
  let w = 0;
  const tri = (a: number, b: number, c: number): void => { indices[w++] = a; indices[w++] = b; indices[w++] = c; };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + (N + 1), d = c + 1;
    // Counter-clockwise seen from above (+Y).
    tri(a, c, b);
    tri(b, c, d);
  }
  // Skirt quads; winding chosen so the outward side faces away from the chunk.
  edges.forEach((e, ei) => {
    const base = skirtStart[ei]!;
    const flip = ei === 1 || ei === 2;
    for (let k = 0; k < N; k++) {
      const t0 = e[k]!, t1 = e[k + 1]!, b0 = base + k, b1 = base + k + 1;
      if (flip) { tri(t0, b0, t1); tri(t1, b0, b1); } else { tri(t0, t1, b0); tri(t1, b1, b0); }
    }
  });

  return { positions, normals, colors, indices, originX, originZ, spacing: h, minY: minY - depth, maxY };
}
