/**
 * Units and coordinate conventions. (docs/ARCHITECTURE.md §2)
 *
 *   length      1 world unit = 1 mm
 *   time        seconds (s)
 *   mass        milligrams (mg)
 *   temperature degrees Celsius
 *   angle       radians
 *
 * Axes (same as three.js): right-handed, +Y up. Ground surface at y = 0,
 * underground is y < 0. A model's local forward axis is +X, local up is +Y.
 * A heading angle h rotates about +Y, so forward = (cos h, 0, -sin h).
 *
 * The aliases below document intent in signatures; the authoritative unit of
 * every configurable value is the `unit` field of its Param (src/config).
 */

import { dcos, dsin } from './dmath.ts';

export type Mm = number;
export type Sec = number;
export type Ms = number;
export type Mg = number;
export type Rad = number;

export const MM_PER_M = 1000;
export const MS_PER_S = 1000;

export const UP = { x: 0, y: 1, z: 0 } as const;
export const MODEL_FORWARD = { x: 1, y: 0, z: 0 } as const;

/** Unit forward vector on the ground plane for heading h. */
export function headingForwardX(h: Rad): number {
  return dcos(h);
}
export function headingForwardZ(h: Rad): number {
  return -dsin(h);
}

/** Write the quaternion for a yaw of h about +Y into out[o..o+3] as (x,y,z,w). */
export function writeYawQuat(h: Rad, out: { [i: number]: number }, o: number): void {
  const half = h * 0.5;
  out[o] = 0;
  out[o + 1] = dsin(half);
  out[o + 2] = 0;
  out[o + 3] = dcos(half);
}
