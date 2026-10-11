/**
 * Phase 1 acceptance (rendering side): the camera can go right down to the
 * ground without the surface breaking — no holes or overlaps between chunks,
 * no cracks between LOD levels, geometric error bounded on screen, the
 * finest mesh identical to the simulated surface, and the camera never
 * inside anything.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { buildConfig } from '../../config/load.ts';
import { Terrain } from '../../terrain/terrain.ts';
import { buildChunk, skirtDepth } from './chunk-builder.ts';
import { applyCameraGuard, minCameraHeight } from './camera-guard.ts';
import {
  focalPx, levelErrors, maxLevel, nodeOrigin, nodeSize, nodeSpacing, screenError, selectNodes, type NodeRef, type QuadParams,
} from './quadtree.ts';

const { config: cfg } = buildConfig();
let T: Terrain;
let P: QuadParams;
let E: Float64Array;
const FOCAL = focalPx((cfg.render.fov * Math.PI) / 180, 900);
const all = (): boolean => true;
const none = (): void => {};

beforeAll(() => {
  T = new Terrain(cfg);
  const r = cfg.terrainRender;
  P = {
    halfExtent: r.viewHalfExtent, chunkQuads: r.chunkQuads, minSpacing: r.minSpacing, maxScreenError: r.maxScreenError,
    reliefBound: T.reliefBound(), errorAt: (h) => T.reliefDeviation(h, r.errorSigmas),
  };
  E = levelErrors(P);
});

const CAMERA_HEIGHTS = [1500, 100, 10, 1, 0.2];
const camerasAt = (h: number): [number, number, number][] =>
  [[0, 0], [37.3, -21.7], [-512.5, 803.1], [999, -999]].map(([x, z]) => [x!, T.supportHeight(x!, z!) + h, z!]);

describe('quadtree selection', () => {
  it.each(CAMERA_HEIGHTS)('covers the ground exactly once (camera %s mm up)', (h) => {
    for (const [x, y, z] of camerasAt(h)) {
      const nodes = selectNodes(P, E, x, y, z, FOCAL, all, none);
      let area = 0;
      for (const n of nodes) area += nodeSize(P, n.level) ** 2;
      expect(area).toBeCloseTo((2 * P.halfExtent) ** 2, 0);
      // No node is an ancestor of another.
      const keys = new Set(nodes.map((n) => `${n.level}/${n.ix}/${n.iz}`));
      for (const n of nodes) {
        for (let l = n.level - 1, ix = n.ix >> 1, iz = n.iz >> 1; l >= 0; l--, ix >>= 1, iz >>= 1) expect(keys.has(`${l}/${ix}/${iz}`)).toBe(false);
      }
    }
  });

  it('still covers the ground when only some meshes are ready', () => {
    const ready = (n: NodeRef): boolean => n.level <= 4 || (n.ix + n.iz) % 3 !== 0;
    const nodes = selectNodes(P, E, 10, T.supportHeight(10, 10) + 1, 10, FOCAL, ready, none);
    let area = 0;
    for (const n of nodes) { expect(ready(n) || n.level === 0).toBe(true); area += nodeSize(P, n.level) ** 2; }
    expect(area).toBeCloseTo((2 * P.halfExtent) ** 2, 0);
  });

  it.each(CAMERA_HEIGHTS)('geometric error on screen ≤ maxScreenError except at the finest level (camera %s mm up)', (h) => {
    const max = maxLevel(P);
    let worst = 0, worstFinest = 0, count = 0;
    for (const [x, y, z] of camerasAt(h)) {
      const nodes = selectNodes(P, E, x, y, z, FOCAL, all, none);
      count = Math.max(count, nodes.length);
      for (const n of nodes) {
        const e = screenError(E, P, n, x, y, z, FOCAL);
        if (n.level < max) worst = Math.max(worst, e); else worstFinest = Math.max(worstFinest, Math.min(e, (E[max]! * FOCAL) / (h / 2)));
      }
    }
    console.log(`[lod] camera ${h} mm: ≤${count} chunks, worst error ${worst.toFixed(2)} px (finest level ${worstFinest.toFixed(2)} px)`);
    expect(worst).toBeLessThanOrEqual(cfg.terrainRender.maxScreenError);
  });

  it('finest-level error stays below 1 px at ant eye height (1 mm)', () => {
    const max = maxLevel(P);
    expect((E[max]! * FOCAL) / 0.5).toBeLessThan(1);
  });
});

describe('chunks', () => {
  it('finest chunks reproduce the simulated soil height (render = sim)', () => {
    const max = maxLevel(P);
    const n: NodeRef = { level: max, ix: (1 << max) / 2 + 3, iz: (1 << max) / 2 - 5 };
    const [x0, z0] = nodeOrigin(P, n);
    const d = buildChunk(T, cfg, x0, z0, nodeSize(P, n.level));
    const N = cfg.terrainRender.chunkQuads;
    let worst = 0;
    for (let j = 0; j <= N; j += 4) for (let i = 0; i <= N; i += 4) {
      const v = j * (N + 1) + i;
      const x = x0 + d.positions[3 * v]!, z = z0 + d.positions[3 * v + 2]!;
      worst = Math.max(worst, Math.abs(d.positions[3 * v + 1]! - T.groundHeight(x, z)));
    }
    expect(worst).toBeLessThan(1e-5); // float32 rounding only
  });

  it('normals are unit length and point up', () => {
    const d = buildChunk(T, cfg, 100, -50, 2);
    for (let v = 0; v < d.normals.length / 3; v++) {
      const nx = d.normals[3 * v]!, ny = d.normals[3 * v + 1]!, nz = d.normals[3 * v + 2]!;
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
      expect(ny).toBeGreaterThan(0);
    }
  });

  it('skirts are deep enough to close cracks against neighbours up to skirtLevels coarser', () => {
    // Compare the shared edge of a fine chunk with the coarse neighbour's linear interpolation.
    const r = cfg.terrainRender;
    let worstRatio = 0;
    for (const level of [6, 9, 12, 14]) {
      for (const jump of [1, 2, 3].filter((j) => j <= r.skirtLevels)) {
        const hf = nodeSpacing(P, level), hc = hf * 2 ** jump;
        const z = 17.3 + level, x0 = -40 + level;
        for (let k = 0; k <= 64; k++) {
          const x = x0 + k * hf;
          const fine = T.groundHeight(x, z, hf);
          const a = Math.floor((x - x0) / hc) * hc + x0, b = a + hc, t = (x - a) / hc;
          const coarse = (1 - t) * T.groundHeight(a, z, hc) + t * T.groundHeight(b, z, hc);
          const gap = Math.abs(fine - coarse);
          worstRatio = Math.max(worstRatio, gap / Math.min(skirtDepth(T, cfg, hf), skirtDepth(T, cfg, hc)));
        }
      }
    }
    console.log(`[skirts] worst gap / skirt depth = ${worstRatio.toFixed(3)}`);
    expect(worstRatio).toBeLessThan(1);
  });
});

describe('camera guard', () => {
  it('keeps the camera clear of soil, grains, pebbles and leaves everywhere', () => {
    let worst = Infinity;
    for (let k = 0; k < 3000; k++) {
      const x = ((k * 0.6180339887) % 1) * 1800 - 900, z = ((k * 0.7548776662) % 1) * 1800 - 900;
      const cam = { x, y: T.groundHeight(x, z) - 5, z }; // start buried
      const tgt = { x: x + 3, y: -1000, z };
      applyCameraGuard(T, cfg, cam, tgt);
      const clearance = cam.y - T.supportHeight(x, z);
      worst = Math.min(worst, clearance);
      expect(cam.y).toBeGreaterThanOrEqual(minCameraHeight(T, cfg, x, z) - 1e-9);
      expect(tgt.y).toBeGreaterThanOrEqual(T.supportHeight(tgt.x, tgt.z) - 1e-9);
    }
    expect(worst).toBeGreaterThanOrEqual(cfg.terrainRender.cameraClearance + cfg.render.near - 1e-9);
  });
});
