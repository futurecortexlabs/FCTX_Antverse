/**
 * Soil voxels and the spoil mound (Phase 5): ENG-SOL-001, ASM-NST-005, PHY-SOIL-002.
 */

import { describe, expect, it } from 'vitest';
import { buildConfig } from '../config/load.ts';
import { StateHasher } from '../core/statehash.ts';
import { Terrain } from '../terrain/terrain.ts';
import { Mound } from './mound.ts';
import { Soil } from './soil.ts';

const cfg = buildConfig([{ scenario: { digging: true }, soil: { size: [64, 128, 64] } }]).config;
const terrain = new Terrain(cfg);

describe('soil voxels', () => {
  const soil = new Soil(cfg, terrain);

  it('a voxel is air above the generated ground and soil below it', () => {
    for (const [ix, iz] of [[5, 7], [32, 32], [60, 3]] as const) {
      const g = terrain.groundHeight(soil.centreX(ix), soil.centreZ(iz));
      const top = soil.airTop[ix + iz * soil.nx]!;
      expect(soil.centreY(top - 1)).toBeGreaterThanOrEqual(g); // last air voxel: centre at or above the ground
      expect(soil.centreY(top)).toBeLessThan(g);               // first soil voxel: centre below it
      expect(soil.isOpen(ix, top - 1, iz)).toBe(true);
      expect(soil.isOpen(ix, top, iz)).toBe(false);
    }
  });

  it('digging opens exactly that voxel, once; walls, floor and the crust outside the entrance are undiggable', () => {
    const s = new Soil(cfg, terrain);
    const ix = 40, iz = 40, d = s.airTop[ix + iz * s.nx]! + cfg.soil.crust + 2;
    expect(s.dig(ix, d, iz)).toBe(true);
    expect(s.isDug(ix, d, iz)).toBe(true);
    expect(s.isDug(ix + 1, d, iz)).toBe(false);
    expect(s.dig(ix, d, iz)).toBe(false);
    expect(s.dug).toBe(1);
    expect(s.canDig(0, d, iz)).toBe(false);                     // side wall
    expect(s.canDig(ix, s.nd - 1, iz)).toBe(false);             // floor
    expect(s.canDig(ix, s.airTop[ix + iz * s.nx]!, iz)).toBe(false); // crust, far from the entrance
    const cx = s.voxelX(0), cz = s.voxelZ(0);
    expect(s.canDig(cx, s.airTop[cx + cz * s.nx]!, cz)).toBe(true);  // crust at the entrance
  });

  it('voxel index round trip; the renderer mirror matches after applying the dirty chunks; the hash follows the digs', () => {
    const s = new Soil(cfg, terrain), mirror = new Soil(cfg, terrain);
    const out = new Int32Array(3);
    s.unindex(s.index(13, 77, 51), out);
    expect([...out]).toEqual([13, 77, 51]);
    const h0 = new StateHasher(); s.hashInto(h0);
    for (const [ix, d, iz] of [[20, 30, 20], [21, 30, 20], [50, 100, 10]] as const) s.dig(ix, d, iz);
    const h1 = new StateHasher(); s.hashInto(h1);
    expect(h1.digest()).not.toBe(h0.digest());
    for (const c of s.takeDirty()) mirror.applyChunk(c.key, c.data);
    expect(mirror.dug).toBe(s.dug);
    expect(mirror.isDug(21, 30, 20)).toBe(true);
    expect(mirror.isDug(22, 30, 20)).toBe(false);
    expect(s.takeDirty()).toEqual([]);
  });
});

describe('spoil mound', () => {
  const spec = { cx: 0, cz: 0, radius: 40, cell: 1, repose: 0.7, open: 3 };

  it('conserves the dropped volume and settles at no more than the angle of repose; nothing is dropped into the entrance', () => {
    const m = new Mound(spec);
    for (let k = 0; k < 2000; k++) m.drop(8 + (k % 3), -2 + (k % 5), 1);
    expect(m.pellets).toBe(2000);
    expect(m.volume()).toBeCloseTo(2000, 1);
    const n = m.n, h = m.heights;
    let steepest = 0;
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 2; i++) {
      steepest = Math.max(steepest, Math.abs(h[j * n + i]! - h[j * n + i + 1]!), Math.abs(h[j * n + i]! - h[(j + 1) * n + i]!));
    }
    expect(steepest).toBeLessThanOrEqual(spec.repose * spec.cell + 1e-3);
    expect(m.canDrop(0, 0)).toBe(false);
    expect(m.heightAt(9, 0)).toBeGreaterThan(5);
  });
});
