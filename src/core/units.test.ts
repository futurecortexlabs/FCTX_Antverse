import { describe, expect, it } from 'vitest';
import { HALF_PI, PI } from './dmath.ts';
import { headingForwardX, headingForwardZ, MODEL_FORWARD, UP, writeYawQuat } from './units.ts';

/** Rotate v by unit quaternion q (x,y,z,w). */
function rotate(q: number[], v: { x: number; y: number; z: number }): number[] {
  const [qx, qy, qz, qw] = q as [number, number, number, number];
  const tx = 2 * (qy * v.z - qz * v.y), ty = 2 * (qz * v.x - qx * v.z), tz = 2 * (qx * v.y - qy * v.x);
  return [v.x + qw * tx + (qy * tz - qz * ty), v.y + qw * ty + (qz * tx - qx * tz), v.z + qw * tz + (qx * ty - qy * tx)];
}

describe('coordinate conventions', () => {
  it('+Y is up, model forward is +X', () => {
    expect(UP).toEqual({ x: 0, y: 1, z: 0 });
    expect(MODEL_FORWARD).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('heading forward vector matches the yaw quaternion applied to the model forward axis', () => {
    for (const h of [0, HALF_PI, PI, -HALF_PI, 0.7, -2.3]) {
      const q = [0, 0, 0, 0];
      writeYawQuat(h, q, 0);
      const f = rotate(q, MODEL_FORWARD);
      expect(f[0]).toBeCloseTo(headingForwardX(h), 12);
      expect(f[1]).toBeCloseTo(0, 12);
      expect(f[2]).toBeCloseTo(headingForwardZ(h), 12);
    }
  });

  it('heading pi/2 faces -Z (three.js right-handed, Y up)', () => {
    expect(headingForwardX(HALF_PI)).toBeCloseTo(0, 12);
    expect(headingForwardZ(HALF_PI)).toBeCloseTo(-1, 12);
  });
});
