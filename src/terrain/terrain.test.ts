/**
 * Phase 1 acceptance (generation side): the ant-scale ground is generated
 * deterministically, with the configured patch cover, and its objects rest
 * on the soil the way the simulation queries say they do.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { buildConfig } from '../config/load.ts';
import { GRAIN_STRIDE, Patch, Terrain } from './terrain.ts';
import { ellipsoidTop } from './shapes.ts';

const { config } = buildConfig();
let T: Terrain;
beforeAll(() => { T = new Terrain(config); });

/** Deterministic quasi-random points in the simulated square. */
function* points(n: number, half: number): Generator<[number, number]> {
  for (let k = 0; k < n; k++) yield [((k * 0.6180339887) % 1) * 2 * half - half, ((k * 0.7548776662) % 1) * 2 * half - half];
}

describe('Terrain generation', () => {
  it('is deterministic for a seed and differs for another seed', () => {
    expect(new Terrain(config).digest()).toBe(T.digest());
    const other = buildConfig([{ sim: { seed: config.sim.seed + 1 } }]).config;
    expect(new Terrain(other).digest()).not.toBe(T.digest());
  });

  it('golden digest is stable', () => {
    expect(T.digest().toString(16)).toMatchSnapshot();
  });

  it('patch cover matches the configured fractions within 3 points', () => {
    const t = config.terrain;
    const targets = [t.litterCover, t.grassCover, t.gravelCover];
    const n = 20000;
    const hits = [0, 0, 0];
    for (const [x, z] of points(n, T.half)) {
      if (Math.hypot(x, z) < 2 * t.nestClearRadius) continue;
      for (const k of [Patch.LITTER, Patch.GRASS, Patch.GRAVEL]) if (T.patch(k, x, z) > 0.5) hits[k]!++;
    }
    hits.forEach((h, k) => expect(Math.abs(h / n - targets[k]!)).toBeLessThan(0.03));
  });

  it('keeps the nest entrance clear', () => {
    const r = config.terrain.nestClearRadius;
    for (let i = 0; i < T.pebbles.count; i++) expect(Math.hypot(T.pebbles.center[3 * i]!, T.pebbles.center[3 * i + 2]!)).toBeGreaterThan(r);
    for (let k = 0; k < T.leaves.count; k++) expect(Math.hypot(T.leaves.cx[k]!, T.leaves.cz[k]!)).toBeGreaterThan(r);
    for (let b = 0; b < T.grass.blades; b++) expect(Math.hypot(T.grass.base[3 * b]!, T.grass.base[3 * b + 2]!)).toBeGreaterThan(r - config.terrain.tuftRadius);
  });

  it('produces objects of every kind', () => {
    expect(T.pebbles.count).toBeGreaterThan(100);
    expect(T.leaves.count).toBeGreaterThan(50);
    expect(T.grass.blades).toBeGreaterThan(500);
  });

  it('pebble and grain sizes respect the ISO size classes (PHY-SOIL-001)', () => {
    const [plo, phi] = config.terrain.pebbleSize;
    for (let i = 0; i < T.pebbles.count; i++) {
      const d = 2 * T.pebbles.radii[3 * i]!;
      expect(d).toBeGreaterThanOrEqual(plo! - 1e-9);
      expect(d).toBeLessThanOrEqual(phi! + 1e-9);
    }
    const [glo, ghi] = config.terrain.grainSize;
    for (let iz = -20; iz < 20; iz++) for (let ix = -20; ix < 20; ix++) {
      const g = T.grainCell(ix + 200, iz + 200);
      for (let o = 0; o < g.length; o += GRAIN_STRIDE) {
        expect(2 * g[o + 3]!).toBeGreaterThanOrEqual(glo! - 1e-9);
        expect(2 * g[o + 3]!).toBeLessThanOrEqual(ghi! + 1e-9);
      }
    }
  });
});

describe('Terrain queries', () => {
  it('supportHeight is never below the soil and is at least each object top', () => {
    for (const [x, z] of points(5000, T.half)) {
      const s = T.supportHeight(x, z);
      expect(s).toBeGreaterThanOrEqual(T.groundHeight(x, z));
      expect(s).toBeGreaterThanOrEqual(T.pebbleTop(x, z));
      expect(s).toBeGreaterThanOrEqual(T.leafTop(x, z));
      expect(s).toBeGreaterThanOrEqual(T.grainTop(x, z));
    }
  });

  it('ellipsoid tops lie on the ellipsoid surface', () => {
    const P = T.pebbles;
    for (let i = 0; i < Math.min(200, P.count); i++) {
      const cx = P.center[3 * i]!, cy = P.center[3 * i + 1]!, cz = P.center[3 * i + 2]!;
      const x = cx + 0.3 * P.radii[3 * i + 2]!, z = cz - 0.2 * P.radii[3 * i + 2]!;
      const y = ellipsoidTop(x, z, cx, cy, cz, P.inv, 9 * i);
      const A = P.inv, o = 9 * i, dx = x - cx, dy = y - cy, dz = z - cz;
      const q = [0, 1, 2].map((r) => A[o + 3 * r]! * dx + A[o + 3 * r + 1]! * dy + A[o + 3 * r + 2]! * dz);
      expect(Math.hypot(q[0]!, q[1]!, q[2]!)).toBeCloseTo(1, 9);
    }
  });

  it('grain cells are identical whether cached or regenerated', () => {
    const a = Float64Array.from(T.grainCell(321, -123));
    const fresh = new Terrain(config);
    expect(Array.from(fresh.grainCell(321, -123))).toEqual(Array.from(a));
  });

  it('no pebble or grain lies under a leaf', () => {
    for (let i = 0; i < T.pebbles.count; i++) expect(T.leafCovers(T.pebbles.center[3 * i]!, T.pebbles.center[3 * i + 2]!)).toBe(false);
  });

  it('leaves rest on the soil: the soil pokes through at under 1% of leaf points (3σ clearance)', () => {
    const L = T.leaves;
    let inside = 0, through = 0, worst = 0;
    for (let k = 0; k < L.count; k++) {
      for (let a = 0; a < 200; a++) {
        const u = ((a * 0.6180339887) % 1) - 0.5, v = ((a * 0.7548776662) % 1) - 0.5;
        const c = L.cosYaw[k]!, s = L.sinYaw[k]!;
        const du = u * L.length[k]!, dv = v * L.width[k]!;
        const x = L.cx[k]! + du * c + dv * s, z = L.cz[k]! - du * s + dv * c;
        const top = T.leafTopOf(k, x, z);
        if (top === -Infinity) continue;
        inside++;
        const bottom = top - config.terrain.leafThickness;
        const soil = T.groundHeight(x, z);
        if (soil > bottom) { through++; worst = Math.max(worst, soil - bottom); }
      }
    }
    console.log(`[leaves] ${inside} points, soil above leaf bottom at ${through} (${((100 * through) / inside).toFixed(2)}%), worst ${worst.toFixed(3)} mm`);
    expect(through / inside).toBeLessThan(0.01);
  });

  it('grass blades start on the support surface and rise', () => {
    const pts = new Float64Array((config.terrain.bladeSegments + 1) * 3);
    for (let b = 0; b < T.grass.blades; b += 7) {
      T.bladePoints(b, config.terrain.bladeSegments, pts);
      expect(pts[1]).toBeCloseTo(T.supportHeight(pts[0]!, pts[2]!), 9);
      expect(pts[pts.length - 2]!).toBeGreaterThan(pts[1]!);
    }
  });
});
