/**
 * Double-bridge apparatus (Goss et al. 1989; Beckers et al. 1992): a nest
 * arena and a feeding arena joined by a stem, two branches of different
 * length between two forks, and another stem. At both forks the branches
 * leave at the same angle either side of the axis, so the choice point
 * itself does not favour either branch — only what ants do afterwards can.
 *
 * Geometry on the ground plane (x along the axis, nest at negative x):
 *   nest ── stem ── fork A ═╤═ short branch (above the axis, +z) ═╤═ fork B ── stem ── feeder
 *                           └═ long branch  (below the axis, −z) ═┘
 * Short branch: two straight legs at ±a meeting at an apex.
 * Long branch: the mirror image of the short branch's first `forkLeg` fraction
 * at each end, then straight down, across and back up — the detour depth is
 * solved so that its length is bridgeRatio × the short one. With
 * bridgeRatio = 1 the lower branch is the mirror image of the upper one.
 * Walkable space = union of capsules (segments of width w) and the two arenas.
 */

import { dcos, dsin, dhypot, PI } from '../core/dmath.ts';
import { rand, Stream } from '../core/rng.ts';
import type { Config } from '../config/params.ts';

/** A place an ant recognises on contact: the nest entrance or a food source (disc on the ground). */
export interface Site {
  x: number;
  z: number;
  r: number;
}

/**
 * Open-ground homing scenario (Phase 4, ENG-SCN-003): the nest entrance at
 * the origin and one feeder feederDistance away, in a direction drawn from
 * the seed. Shared by the simulation and the renderer.
 */
export function homingSites(cfg: Config): { nest: Site; feeder: Site } {
  const sc = cfg.scenario;
  const ang = rand(cfg.sim.seed >>> 0, Stream.SCENARIO, 0, 0) * 2 * PI;
  return {
    nest: { x: 0, z: 0, r: sc.nestRadius },
    feeder: { x: sc.feederDistance * dcos(ang), z: -sc.feederDistance * dsin(ang), r: sc.feederRadius },
  };
}

export interface Segment {
  x0: number; z0: number; x1: number; z1: number;
}

export const Branch = { NONE: 0, SHORT: 1, LONG: 2 } as const;

export class DoubleBridge {
  readonly half: number;
  readonly segments: Segment[] = [];
  readonly short: Segment[] = [];
  readonly long: Segment[] = [];
  readonly nest: { x: number; z: number; r: number };
  readonly feeder: { x: number; z: number; r: number };
  readonly forkA: number;
  readonly forkB: number;
  readonly lengthShort: number;
  readonly lengthLong: number;
  /** Bounding box of the walkable space. */
  readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number;

  constructor(cfg: Config) {
    const s = cfg.scenario;
    const D = s.bridgeSpan, a = s.bridgeAngle, w = s.bridgeWidth;
    this.half = w / 2;
    this.forkA = 0;
    this.forkB = D;
    // Short branch: A → apex → B, two straight legs at ±a.
    const apexZ = (D / 2) * dsin(a) / dcos(a);
    this.short.push({ x0: 0, z0: 0, x1: D / 2, z1: apexZ }, { x0: D / 2, z0: apexZ, x1: D, z1: 0 });
    const ls = 2 * dhypot(D / 2, apexZ);
    let h: number;
    if (s.bridgeRatio === 1) {
      // Control set-up with equal branches (Deneubourg et al. 1990): the mirror image.
      h = apexZ;
      this.long.push({ x0: 0, z0: 0, x1: D / 2, z1: -apexZ }, { x0: D / 2, z0: -apexZ, x1: D, z1: 0 });
    } else {
      // Long branch: A → P1 (leg p at −a) → down to depth h → across → up → leg back to B.
      // Length = 2p + 2(h − p·sin a) + (D − 2p·cos a) = r·ls  →  solve for h.
      const p = s.forkLeg * ls / 2;
      const px = p * dcos(a), pz = p * dsin(a);
      h = (s.bridgeRatio * ls - 2 * p - (D - 2 * px)) / 2 + pz;
      if (h < pz + w) throw new Error('DoubleBridge: bridgeRatio too small for this geometry (use 1 for equal branches)');
      this.long.push(
        { x0: 0, z0: 0, x1: px, z1: -pz },
        { x0: px, z0: -pz, x1: px, z1: -h },
        { x0: px, z0: -h, x1: D - px, z1: -h },
        { x0: D - px, z0: -h, x1: D - px, z1: -pz },
        { x0: D - px, z0: -pz, x1: D, z1: 0 },
      );
    }
    this.lengthShort = ls;
    this.lengthLong = this.long.reduce((t, g) => t + dhypot(g.x1 - g.x0, g.z1 - g.z0), 0);
    const L = s.stemLength, R = s.arenaRadius;
    this.nest = { x: -L - R, z: 0, r: R };
    this.feeder = { x: D + L + R, z: 0, r: R };
    this.segments.push({ x0: this.nest.x, z0: 0, x1: 0, z1: 0 }, ...this.short, ...this.long, { x0: D, z0: 0, x1: this.feeder.x, z1: 0 });
    this.minX = this.nest.x - R; this.maxX = this.feeder.x + R;
    this.minZ = -h - w; this.maxZ = Math.max(apexZ + w, R);
  }

  /** Can an ant stand at (x, z)? */
  walkable(x: number, z: number): boolean {
    if (inCircle(x, z, this.nest) || inCircle(x, z, this.feeder)) return true;
    for (const g of this.segments) if (segmentDistance(x, z, g) <= this.half) return true;
    return false;
  }

  inNest(x: number, z: number): boolean {
    return inCircle(x, z, this.nest);
  }

  inFeeder(x: number, z: number): boolean {
    return inCircle(x, z, this.feeder);
  }

  /**
   * Counting gate: a strip across both branches half-way between the forks,
   * where they are far apart (short above the axis, long below).
   */
  gateAt(x: number, z: number): number {
    if (Math.abs(x - (this.forkA + this.forkB) / 2) > this.half) return Branch.NONE;
    return z > 0 ? Branch.SHORT : Branch.LONG;
  }

  /**
   * Which branch (if any) the point is on, away from the forks. Near the
   * forks the two branches' walkways overlap and the short one is reported;
   * use gateAt to count traffic.
   */
  branchAt(x: number, z: number): number {
    if (x <= this.forkA + this.half || x >= this.forkB - this.half) return Branch.NONE;
    for (const g of this.short) if (segmentDistance(x, z, g) <= this.half) return Branch.SHORT;
    for (const g of this.long) if (segmentDistance(x, z, g) <= this.half) return Branch.LONG;
    return Branch.NONE;
  }
}

function inCircle(x: number, z: number, c: { x: number; z: number; r: number }): boolean {
  const dx = x - c.x, dz = z - c.z;
  return dx * dx + dz * dz <= c.r * c.r;
}

export function segmentDistance(x: number, z: number, g: Segment): number {
  const vx = g.x1 - g.x0, vz = g.z1 - g.z0;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 0 ? ((x - g.x0) * vx + (z - g.z0) * vz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return dhypot(x - g.x0 - t * vx, z - g.z0 - t * vz);
}
