/**
 * Double-bridge geometry (BIO-PHE-001, ENG-SCN-002).
 */

import { describe, expect, it } from 'vitest';
import { buildConfig } from '../config/load.ts';
import { Branch, DoubleBridge } from './apparatus.ts';

const bridge = (o: Record<string, number> = {}): DoubleBridge =>
  new DoubleBridge(buildConfig([{ scenario: { doubleBridge: true, ...o } }]).config);

describe('double bridge', () => {
  it('the long branch is bridgeRatio × the short one', () => {
    for (const r of [1.5, 2, 3]) {
      const b = bridge({ bridgeRatio: r });
      expect(b.lengthLong / b.lengthShort).toBeCloseTo(r, 9);
    }
  });

  it('both branches leave each fork at the same angle either side of the axis', () => {
    const b = bridge();
    const s0 = b.short[0]!, l0 = b.long[0]!;
    expect(Math.atan2(s0.z1 - s0.z0, s0.x1 - s0.x0)).toBeCloseTo(-Math.atan2(l0.z1 - l0.z0, l0.x1 - l0.x0), 9);
    const s1 = b.short.at(-1)!, l1 = b.long.at(-1)!;
    expect(Math.atan2(s1.z0 - s1.z1, s1.x0 - s1.x1)).toBeCloseTo(-Math.atan2(l1.z0 - l1.z1, l1.x0 - l1.x1), 9);
  });

  it('equal branches (ratio 1) are mirror images', () => {
    const b = bridge({ bridgeRatio: 1 });
    expect(b.lengthLong).toBeCloseTo(b.lengthShort, 9);
    for (let x = 5; x < b.forkB; x += 7) for (let z = 0; z < 40; z += 3) {
      expect(b.walkable(x, -z)).toBe(b.walkable(x, z));
    }
  });

  it('classifies points: arenas, branches, off the walkway', () => {
    const b = bridge();
    expect(b.inNest(b.nest.x, 0)).toBe(true);
    expect(b.inFeeder(b.feeder.x, 0)).toBe(true);
    const ms = b.short[0]!, ml = b.long[2]!;
    expect(b.branchAt((ms.x0 + ms.x1) / 2, (ms.z0 + ms.z1) / 2)).toBe(Branch.SHORT);
    expect(b.branchAt((ml.x0 + ml.x1) / 2, (ml.z0 + ml.z1) / 2)).toBe(Branch.LONG);
    expect(b.branchAt(b.nest.x, 0)).toBe(Branch.NONE);
    expect(b.walkable(b.forkB / 2, 0)).toBe(false); // between the branches
    expect(b.walkable(b.forkB / 2, b.minZ - 1)).toBe(false);
  });
});
