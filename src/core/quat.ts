/**
 * Quaternion helpers (x, y, z, w) on plain arrays, using deterministic math.
 * Body convention (units.ts): forward +X, up +Y, right +Z.
 *   yaw   about +Y (heading; forward = (cos h, 0, -sin h))
 *   pitch about +Z (positive = nose up)
 *   roll  about +X (positive = right side down)
 * Body orientation q = qYaw ⊗ qPitch ⊗ qRoll.
 */

import { dcos, dsin } from './dmath.ts';

export type Quat = [number, number, number, number];
export type Vec3 = [number, number, number];

export function quatYawPitchRoll(yaw: number, pitch: number, roll: number, out: { [i: number]: number } = [0, 0, 0, 1], o = 0): { [i: number]: number } {
  const hy = yaw * 0.5, hp = pitch * 0.5, hr = roll * 0.5;
  const cy = dcos(hy), sy = dsin(hy), cp = dcos(hp), sp = dsin(hp), cr = dcos(hr), sr = dsin(hr);
  // qy = (0, sy, 0, cy); qp = (0, 0, sp, cp); qr = (sr, 0, 0, cr)
  // a = qy ⊗ qp
  const ax = sy * sp, ay = sy * cp, az = cy * sp, aw = cy * cp;
  // out = a ⊗ qr
  out[o] = aw * sr + ax * cr;
  out[o + 1] = ay * cr + az * sr;
  out[o + 2] = az * cr - ay * sr;
  out[o + 3] = aw * cr - ax * sr;
  return out;
}

/** Rotate v by unit quaternion q (array with offset), writing into out. */
export function quatRotate(q: ArrayLike<number>, qo: number, vx: number, vy: number, vz: number, out: Vec3): Vec3 {
  const x = q[qo]!, y = q[qo + 1]!, z = q[qo + 2]!, w = q[qo + 3]!;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  out[0] = vx + w * tx + (y * tz - z * ty);
  out[1] = vy + w * ty + (z * tx - x * tz);
  out[2] = vz + w * tz + (x * ty - y * tx);
  return out;
}
