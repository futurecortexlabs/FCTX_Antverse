/**
 * Leg kinematics for one walking ant: alternating-tripod stepping driven by
 * the gait phase, footholds placed on the terrain support surface, and an
 * analytic IK solve of coxa–femur–tibia–tarsus for every leg.
 *
 *  - Stance (leg phase φ < duty): the foot stays planted where it touched down.
 *  - Swing  (φ ≥ duty): the foot travels on an arc towards the foothold it will
 *    land on at touchdown (predicted from the body's motion), never below the
 *    support surface under it.
 *  - Footholds: a stance foot stays put while the body moves over it, so it is
 *    placed where the body will be at the *middle* of that stance — predicted
 *    from the body's observed translation and turning per gait cycle — at the
 *    neutral foot position, projected onto the support. Straight walking,
 *    curves and turning on the spot are all handled by the same rule.
 *
 * Pure logic over a support-height function, so it is identical in the
 * renderer and in headless tests. Used for presentation: the simulation moves
 * the body; legs are solved for ants close enough to see them (LOD0).
 */

import { dcos, dhypot, dsin, PI } from '../core/dmath.ts';
import { quatRotate, type Vec3 } from '../core/quat.ts';
import type { Config } from '../config/params.ts';
import { LEGS, strideLength, type Morphology } from './morphology.ts';

export type SupportFn = (x: number, z: number) => number;

/** What the legs need from the terrain. */
export interface TerrainProbe {
  /** Height a foot stands on at (x, z). */
  support: SupportFn;
  /** Is the point inside solid matter (soil, grain, pebble, leaf sheet)? */
  solid: (x: number, y: number, z: number) => boolean;
}

export interface BodyPose {
  x: number; y: number; z: number;
  /** orientation quaternion (x, y, z, w) */
  q: ArrayLike<number>;
  /** heading (yaw) used for footholds */
  yaw: number;
}

/** Joint points per leg, in order: coxa base, femur base (coxa tip), knee, ankle, foot. */
export const JOINTS = 5;

export interface RigStats {
  /** Legs whose ankle target was beyond femur + tibia reach this update. */
  overstretched: number;
  /** Swing feet lifted above the support because their arc would have gone below it. */
  swingClamped: number;
}

const t3: Vec3 = [0, 0, 0];

export class LegRig {
  readonly foot = new Float64Array(LEGS * 3);
  readonly stance = new Uint8Array(LEGS);
  /** Points in world space: LEGS × JOINTS × 3. */
  readonly joints = new Float64Array(LEGS * JOINTS * 3);
  readonly stats: RigStats = { overstretched: 0, swingClamped: 0 };
  private readonly from = new Float64Array(LEGS * 3);
  private unwrapped = NaN;
  /** Observed body motion per gait cycle: translation (x, z) and yaw change, smoothed. */
  private vx = 0;
  private vz = 0;
  private vyaw = 0;
  private lastX = 0;
  private lastZ = 0;
  private lastYaw = 0;
  private readonly m: Morphology;
  private readonly cfg: Config;

  constructor(m: Morphology, cfg: Config) {
    this.m = m;
    this.cfg = cfg;
  }

  get initialised(): boolean {
    return !Number.isNaN(this.unwrapped);
  }

  /**
   * Foothold of leg i for the stance whose middle is `mid` gait cycles from now
   * (negative = in the past): where the neutral foot position will be at that
   * moment, given the observed body motion per cycle, projected onto the
   * support. If that point is out of the leg's reach (e.g. on top of a tall
   * pebble beside the body) or the coxa–ankle line would pass through solid
   * matter, the foothold is pulled in towards the body step by step.
   */
  private foothold(i: number, pose: BodyPose, mid: number, probe: TerrainProbe, out: Vec3): Vec3 {
    const support = probe.support;
    const leg = this.m.legs[i]!;
    const lc = this.cfg.locomotion;
    const px = pose.x + this.vx * mid, pz = pose.z + this.vz * mid, yaw = pose.yaw + this.vyaw * mid;
    const fx = dcos(yaw), fz = -dsin(yaw);
    const rx = dsin(yaw), rz = dcos(yaw); // right (+Z body) on the ground plane
    // Coxa tip, carried along with the body.
    quatRotate(pose.q, 0, leg.base[0] + leg.coxaDir[0] * leg.coxa, leg.base[1] + leg.coxaDir[1] * leg.coxa, leg.base[2] + leg.coxaDir[2] * leg.coxa, t3);
    const cx = px + t3[0], cy = pose.y + t3[1], cz = pz + t3[2];
    const nx = px + fx * leg.neutral[0] + rx * leg.neutral[1], nz = pz + fz * leg.neutral[0] + rz * leg.neutral[1];
    const reach = (leg.femur + leg.tibia) * lc.reachMargin;
    const ct = dcos(lc.tarsusAngle) * leg.tarsus, st = dsin(lc.tarsusAngle) * leg.tarsus;
    let best = Infinity;
    for (let k = 0; k < FOOTHOLD_TRIES; k++) {
      const pull = 1 - (k / FOOTHOLD_TRIES) * lc.footholdPullMax;
      const x = cx + (nx - cx) * pull, z = cz + (nz - cz) * pull;
      const y = support(x, z);
      // Ankle sits tarsus-length back towards the coxa, raised by the tarsus angle.
      let ox = x - cx, oz = z - cz;
      const on = dhypot(ox, oz) || 1;
      ox /= on; oz /= on;
      const excess = dhypot(x - ox * ct - cx, y + st - cy, z - oz * ct - cz) - reach;
      // Prefer footholds the leg can reach without passing through anything solid
      // (e.g. through the raised edge of a leaf beside the body).
      const score = excess + (this.lineClear(cx, cy, cz, x, y + st, z, probe) ? 0 : BLOCKED_PENALTY);
      if (score < best) { best = score; out[0] = x; out[1] = y; out[2] = z; }
      if (score <= 0) break;
    }
    return out;
  }

  /** Does the straight line between two points stay out of solid matter (sampled)? */
  private lineClear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, probe: TerrainProbe): boolean {
    for (let k = 1; k < LINE_SAMPLES; k++) {
      const t = k / LINE_SAMPLES;
      if (probe.solid(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t)) return false;
    }
    return true;
  }

  /** Place all feet consistently with the current phase (first sight, or after a jump). */
  reset(pose: BodyPose, phase: number, speed: number, probe: TerrainProbe): void {
    const D = this.cfg.locomotion.dutyFactor;
    const S = strideLength(this.cfg, speed);
    this.unwrapped = phase;
    // No history yet: assume straight walking at this speed.
    this.vx = dcos(pose.yaw) * S;
    this.vz = -dsin(pose.yaw) * S;
    this.vyaw = 0;
    this.remember(pose);
    for (let i = 0; i < LEGS; i++) {
      const phi = frac(phase + this.m.legs[i]!.phaseOffset);
      if (phi < D) {
        this.stance[i] = 1;
        this.foothold(i, pose, D / 2 - phi, probe, t3);
        this.foot.set(t3, 3 * i);
      } else {
        this.stance[i] = 0;
        // Its last stance (centred D/2 after its start) is behind it.
        this.foothold(i, pose, D / 2 - phi, probe, t3);
        this.from.set(t3, 3 * i);
        this.swing(i, pose, phi, probe);
      }
    }
    this.solveAll(pose, probe);
  }

  /** Advance to a new body pose and gait phase (fraction in [0,1)). */
  update(pose: BodyPose, phase: number, speed: number, probe: TerrainProbe): void {
    const support = probe.support;
    if (!this.initialised) { this.reset(pose, phase, speed, probe); return; }
    let delta = phase - frac(this.unwrapped);
    if (delta < -0.5) delta += 1;
    if (delta > 0.5 || delta < 0) { this.reset(pose, phase, speed, probe); return; } // jumped (fast-forward) or reversed
    const before = this.unwrapped;
    const after = before + delta;
    this.unwrapped = after;
    const D = this.cfg.locomotion.dutyFactor;
    // Observed motion per gait cycle (smoothed).
    if (delta > MIN_PHASE_STEP) {
      let dyaw = pose.yaw - this.lastYaw;
      if (dyaw > PI) dyaw -= 2 * PI; else if (dyaw < -PI) dyaw += 2 * PI;
      const k = this.cfg.locomotion.motionSmoothing;
      this.vx += k * ((pose.x - this.lastX) / delta - this.vx);
      this.vz += k * ((pose.z - this.lastZ) / delta - this.vz);
      this.vyaw += k * (dyaw / delta - this.vyaw);
    }
    this.remember(pose);
    this.stats.swingClamped = 0;
    for (let i = 0; i < LEGS; i++) {
      const off = this.m.legs[i]!.phaseOffset;
      const u0 = before + off, u1 = after + off;
      const phi = frac(u1);
      const newCycle = Math.floor(u1) > Math.floor(u0);
      if (newCycle) {
        // Touchdown: plant on the foothold.
        this.foothold(i, pose, D / 2 - phi, probe, t3);
        this.foot.set(t3, 3 * i);
        this.stance[i] = 1;
      }
      if (phi < D) {
        if (!this.stance[i]) { this.foothold(i, pose, D / 2 - phi, probe, t3); this.foot.set(t3, 3 * i); this.stance[i] = 1; }
        continue; // planted
      }
      if (this.stance[i]) {
        // Lift-off: remember where the swing starts.
        this.from.set(this.foot.subarray(3 * i, 3 * i + 3), 3 * i);
        this.stance[i] = 0;
      }
      this.swing(i, pose, phi, probe);
    }
    this.solveAll(pose, probe);
  }

  private remember(pose: BodyPose): void {
    this.lastX = pose.x; this.lastZ = pose.z; this.lastYaw = pose.yaw;
  }

  private swing(i: number, pose: BodyPose, phi: number, probe: TerrainProbe): void {
    const support = probe.support;
    const lc = this.cfg.locomotion;
    const D = lc.dutyFactor;
    const t = (phi - D) / (1 - D);
    // Touchdown at φ = 1; the coming stance is centred D/2 later.
    this.foothold(i, pose, 1 - phi + D / 2, probe, t3);
    const e = t * t * (3 - 2 * t);
    const o = 3 * i;
    const x = this.from[o]! + (t3[0] - this.from[o]!) * e;
    const z = this.from[o + 2]! + (t3[2] - this.from[o + 2]!) * e;
    let y = this.from[o + 1]! + (t3[1] - this.from[o + 1]!) * e + lc.swingHeight * dsin(PI * t);
    const floor = support(x, z) + lc.swingClearance;
    if (y < floor) { y = floor; this.stats.swingClamped++; }
    this.foot[o] = x; this.foot[o + 1] = y; this.foot[o + 2] = z;
  }

  private solveAll(pose: BodyPose, probe: TerrainProbe): void {
    this.stats.overstretched = 0;
    for (let i = 0; i < LEGS; i++) if (!this.solve(i, pose, probe)) this.stats.overstretched++;
  }

  /** IK for leg i; returns false if the foot was out of reach. */
  private solve(i: number, pose: BodyPose, probe: TerrainProbe): boolean {
    const support = probe.support;
    const leg = this.m.legs[i]!;
    const J = this.joints, o = i * JOINTS * 3;
    const set = (k: number, x: number, y: number, z: number): void => { J[o + 3 * k] = x; J[o + 3 * k + 1] = y; J[o + 3 * k + 2] = z; };
    quatRotate(pose.q, 0, leg.base[0], leg.base[1], leg.base[2], t3);
    const bx = pose.x + t3[0], by = pose.y + t3[1], bz = pose.z + t3[2];
    set(0, bx, by, bz);
    quatRotate(pose.q, 0, leg.coxaDir[0] * leg.coxa, leg.coxaDir[1] * leg.coxa, leg.coxaDir[2] * leg.coxa, t3);
    const cx = bx + t3[0], cy = by + t3[1], cz = bz + t3[2];
    set(1, cx, cy, cz);
    const fx = this.foot[3 * i]!, fy = this.foot[3 * i + 1]!, fz = this.foot[3 * i + 2]!;
    set(4, fx, fy, fz);

    // Tarsus: from the ankle down to the foot. Preferred: pointing outwards at tarsusAngle to the
    // ground (steeper if the ground between ankle and foot pokes through it). If the ankle is then
    // out of femur + tibia reach, the tarsus turns towards the coxa just enough to bring it in reach.
    let ox = fx - cx, oz = fz - cz;
    const on = dhypot(ox, oz);
    if (on < 1e-9) { ox = leg.side * dsin(pose.yaw); oz = leg.side * dcos(pose.yaw); } else { ox /= on; oz /= on; }
    const lc = this.cfg.locomotion;
    const a = leg.femur, b = leg.tibia;
    const reach = a + b;
    let ang = lc.tarsusAngle;
    // Preferred tarsus direction (foot → ankle), unit.
    let ux = 0, uy = 0, uz = 0;
    for (let k = 0; k < TARSUS_TRIES; k++) {
      ux = -ox * dcos(ang); uz = -oz * dcos(ang); uy = dsin(ang);
      if (fy + leg.tarsus * uy >= support(fx + leg.tarsus * ux, fz + leg.tarsus * uz) + lc.swingClearance) break;
      ang += (PI / 2 - lc.tarsusAngle) / TARSUS_TRIES;
    }
    const ankleAt = (t: number, out: Vec3): Vec3 => {
      // Blend the preferred direction with the straight foot → coxa-tip direction.
      let wx = cx - fx, wy = cy - fy, wz = cz - fz;
      const wn = dhypot(wx, wy, wz) || 1;
      wx /= wn; wy /= wn; wz /= wn;
      let vx = ux + (wx - ux) * t, vy = uy + (wy - uy) * t, vz = uz + (wz - uz) * t;
      const vn = dhypot(vx, vy, vz) || 1;
      vx /= vn; vy /= vn; vz /= vn;
      out[0] = fx + leg.tarsus * vx; out[1] = fy + leg.tarsus * vy; out[2] = fz + leg.tarsus * vz;
      return out;
    };
    const dist = (p: Vec3): number => dhypot(p[0] - cx, p[1] - cy, p[2] - cz);
    ankleAt(0, t3);
    if (dist(t3) > reach && dist(ankleAt(1, t3)) <= reach) {
      let lo = 0, hi = 1;
      for (let k = 0; k < BISECT_STEPS; k++) {
        const mid = (lo + hi) / 2;
        if (dist(ankleAt(mid, t3)) > reach) lo = mid; else hi = mid;
      }
      ankleAt(hi, t3);
    } else if (dist(t3) > reach) {
      ankleAt(1, t3); // foot beyond full leg reach: point the tarsus straight at the coxa
    }
    let ax = t3[0], ay = t3[1], az = t3[2];
    // Still inside an obstacle: lift the ankle onto it.
    const ankleFloor = support(ax, az) + lc.swingClearance;
    if (ay < ankleFloor) ay = ankleFloor;
    set(3, ax, ay, az);

    // Two-bone IK coxa tip → ankle, knee bending up and outwards.
    let dx = ax - cx, dy = ay - cy, dz = az - cz;
    const d = dhypot(dx, dy, dz);
    dx /= d; dy /= d; dz /= d;
    const ok = d <= reach + REACH_EPS;
    const dd = Math.min(Math.max(d, Math.abs(a - b) + 1e-9), reach - 1e-9);
    const along = (a * a - b * b + dd * dd) / (2 * dd);
    const h = Math.sqrt(Math.max(0, a * a - along * along));
    // Pole: mostly world up, leaning outward, made perpendicular to the femur–ankle line.
    // If that line is itself near vertical, bend outward instead.
    let px = ox * lc.kneeOutward, py = 1, pz = oz * lc.kneeOutward;
    if (Math.abs(dy) > NEAR_VERTICAL) { px = ox; py = 0; pz = oz; }
    const pd = px * dx + py * dy + pz * dz;
    px -= pd * dx; py -= pd * dy; pz -= pd * dz;
    const pn = dhypot(px, py, pz);
    px /= pn; py /= pn; pz /= pn;
    // Second in-plane axis q = d × p, to swing the knee around the femur–ankle line if needed.
    const qx = dy * pz - dz * py, qy = dz * px - dx * pz, qz = dx * py - dy * px;
    const mx = cx + dx * along, my = cy + dy * along, mz = cz + dz * along;
    let kx = mx + px * h, ky = my + py * h, kz = mz + pz * h;
    if (probe.solid(kx, ky, kz)) {
      // Knee inside an obstacle: rotate its bending plane (±15°, ±30°, … ±165°) until it is clear.
      for (let k = 1; k <= KNEE_TRIES; k++) {
        const ang2 = (k >> 1) * KNEE_STEP * (k % 2 === 1 ? 1 : -1) + (k % 2 === 1 ? KNEE_STEP : 0);
        const c = dcos(ang2), sn = dsin(ang2);
        const tx = mx + (px * c + qx * sn) * h, ty = my + (py * c + qy * sn) * h, tz = mz + (pz * c + qz * sn) * h;
        if (!probe.solid(tx, ty, tz)) { kx = tx; ky = ty; kz = tz; break; }
      }
    }
    set(2, kx, ky, kz);
    return ok;
  }
}

const TARSUS_TRIES = 6;
/** Phase steps smaller than this carry no usable motion estimate. */
const MIN_PHASE_STEP = 1e-4;
const FOOTHOLD_TRIES = 6;
const LINE_SAMPLES = 6;
/** Score penalty (mm) for a foothold whose coxa–ankle line passes through solid matter. */
const BLOCKED_PENALTY = 100;
const BISECT_STEPS = 12;
const KNEE_TRIES = 22;
const KNEE_STEP = PI / 12;
/** Reach tolerance (mm) for float rounding in the IK. */
const REACH_EPS = 1e-6;
/** |vertical component| of the femur–ankle direction above which the pole switches to outward. */
const NEAR_VERTICAL = 0.95;

export function frac(x: number): number {
  return x - Math.floor(x);
}
