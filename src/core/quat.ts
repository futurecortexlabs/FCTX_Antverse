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

/**
 * Orientation whose body axes are forward = f, up = u (both unit, f ⟂ u);
 * right = f × u. Writes q into out at offset o (Shepperd's method).
 */
export function quatFromBasis(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number, out: { [i: number]: number }, o = 0): void {
  // Columns of the rotation matrix: X = f, Y = u, Z = f × u.
  const rx = fy * uz - fz * uy, ry = fz * ux - fx * uz, rz = fx * uy - fy * ux;
  const m00 = fx, m10 = fy, m20 = fz, m01 = ux, m11 = uy, m21 = uz, m02 = rx, m12 = ry, m22 = rz;
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = w;
}
