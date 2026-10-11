/**
 * Reproduction tests for the body-pose rule (ASM-LOC-005, ASM-LOC-006).
 */

import { describe, expect, it } from 'vitest';
import { quatRotate, type Vec3 } from '../../core/quat.ts';
import { buildConfig } from '../../config/load.ts';
import { buildMorphology } from '../../locomotion/morphology.ts';
import { World } from '../world.ts';
import { bodyPoseRange } from './body-pose.ts';

const { config } = buildConfig([{ population: { count: 1500 }, world: { arenaSize: 1800 } }]);

describe('body pose on the terrain', () => {
  const world = new World(config);
  const a = world.agents.a, T = world.terrain, m = buildMorphology(config);
  const lc = config.locomotion;

  it('rides rideHeight above the support on level ground, with a unit quaternion', () => {
    // Settled spawn (alpha = 1): on bare level soil the mesosoma sits at support + rideHeight.
    let checked = 0;
    for (let i = 0; i < world.agents.highWater; i++) {
      const x = a.posX[i]!, z = a.posZ[i]!;
      if (Math.abs(a.pitch[i]!) > 0.02) continue; // level spots only
      const yC = T.supportHeight(x, z);
      if (a.posY[i]! - yC > lc.rideHeight + 1e-6) continue; // floor-raised by a bump under head or gaster
      expect(a.posY[i]! - yC).toBeCloseTo(lc.rideHeight, 6);
      const q = a.rot.subarray(4 * i, 4 * i + 4);
      expect(Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!)).toBeCloseTo(1, 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('head, mesosoma and gaster undersides are never below the support under them', () => {
    // Checked where the rule guarantees it: the underside point below each segment centre,
    // against the support directly under that point.
    const v: Vec3 = [0, 0, 0];
    let worst = Infinity;
    for (let i = 0; i < world.agents.highWater; i++) {
      for (const s of [m.head, m.mesosoma, m.gaster]) {
        quatRotate(a.rot, 4 * i, s.cx, s.cy - s.h / 2, 0, v);
        const px = a.posX[i]! + v[0], py = a.posY[i]! + v[1], pz = a.posZ[i]! + v[2];
        worst = Math.min(worst, py - T.supportHeight(px, pz));
      }
    }
    console.log(`[body-pose] worst underside clearance ${worst.toFixed(4)} mm`);
    // Tolerance: roll (the underside point moves sideways) and float32 storage.
    expect(worst).toBeGreaterThan(-0.05);
  });

  it('pitches nose-up when the support under the head is higher than under the gaster', () => {
    let agree = 0, total = 0;
    for (let i = 0; i < world.agents.highWater; i++) {
      const h = a.heading[i]!, x = a.posX[i]!, z = a.posZ[i]!, c = Math.cos(a.pitch[i]!);
      const fx = Math.cos(h), fz = -Math.sin(h);
      const yF = T.supportHeight(x + fx * m.head.cx * c, z + fz * m.head.cx * c);
      const yB = T.supportHeight(x + fx * m.gaster.cx * c, z + fz * m.gaster.cx * c);
      if (Math.abs(yF - yB) > 0.1) { total++; if (Math.sign(a.pitch[i]!) === Math.sign(yF - yB)) agree++; }
    }
    expect(total).toBeGreaterThan(20);
    expect(agree / total).toBeGreaterThan(0.95);
  });

  it('follows a change of target with the configured time constant', () => {
    const w = new World(buildConfig([{ population: { count: 1 } }]).config);
    const b = w.agents.a;
    bodyPoseRange(w, 0, 1, 1);
    const target = b.posY[0]!;
    b.posY[0] = target + 1; // lift the body 1 mm, then let one step pull it back
    bodyPoseRange(w, 0, 1, w.poseAlpha);
    expect(b.posY[0]! - target).toBeCloseTo(1 - w.poseAlpha, 5); // posY is float32
  });
});
