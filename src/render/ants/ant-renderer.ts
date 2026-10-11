/**
 * Draws all ants from interpolated snapshots, with three levels of detail by
 * on-screen size:
 *   LOD0  nearest ants (up to rigMaxAnts, at least rigMinPixels long):
 *         body + legs solved by the LegRig on the terrain + sweeping antennae
 *   LOD1  body with legs and antennae baked in a standing pose
 *   LOD2  low-poly body only (smaller than lod2Pixels)
 * Leg rigs are kept per agent slot while it stays in LOD0.
 */

import * as THREE from 'three/webgpu';
import type { Config } from '../../config/params.ts';
import { quatRotate, type Vec3 } from '../../core/quat.ts';
import { JOINTS, LegRig, type BodyPose, type TerrainProbe } from '../../locomotion/legs.ts';
import { buildMorphology, LEGS, type Morphology } from '../../locomotion/morphology.ts';
import { META_BYTE, META_FLAG_SHIFT, META_GEN_SHIFT, SNAP_FLAG_ALIVE, SNAP_FLAG_UNDERGROUND, SNAP_FLOATS, SnapF } from '../../worker/protocol.ts';
import type { InterpolationState } from '../interpolation.ts';
import { antennaPoints } from './antenna.ts';
import { bodyGeometry, bodyWithLegsGeometry, unitLimbGeometry } from './ant-model.ts';

/** Limb segments per rigged ant: 6 legs × 4 + 2 antennae × 2. */
const SEGMENTS_PER_RIG = LEGS * 4 + 4;
const TAU = 2 * Math.PI;

interface RigEntry {
  rig: LegRig;
  gen: number;
  used: number;
}

export interface AntRenderStats {
  lod0: number;
  lod1: number;
  lod2: number;
  overstretched: number;
}

export class AntRenderer {
  readonly group = new THREE.Group();
  readonly stats: AntRenderStats = { lod0: 0, lod1: 0, lod2: 0, overstretched: 0 };
  private readonly lod: THREE.InstancedMesh[];
  private readonly limbs: THREE.InstancedMesh;
  private readonly rigs = new Map<number, RigEntry>();
  private readonly m: Morphology;
  private readonly cfg: Config;
  private frame = 0;
  // Per-frame interpolated poses (capacity sized).
  private pose: Float32Array;
  private dist: Float32Array;
  private readonly order: number[] = [];

  constructor(cfg: Config) {
    this.cfg = cfg;
    this.m = buildMorphology(cfg);
    const r = cfg.render;
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: r.antRoughness, metalness: 0 });
    const detail0 = { body: [r.antDetail[0]!, r.antDetail[1]!] as [number, number], limb: r.antDetail[2]! };
    const detail2 = { body: [r.antDetailFar[0]!, r.antDetailFar[1]!] as [number, number], limb: r.antDetailFar[2]! };
    const geoms = [bodyGeometry(this.m, cfg, detail0), bodyWithLegsGeometry(this.m, cfg, detail0), bodyGeometry(this.m, cfg, detail2)];
    this.lod = geoms.map((g, i) => {
      const mesh = new THREE.InstancedMesh(g, mat, cfg.sim.capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.castShadow = cfg.terrainRender.shadows;
      mesh.receiveShadow = true;
      mesh.name = `ants-lod${i}`;
      this.group.add(mesh);
      return mesh;
    });
    const limbMat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(r.antLegColor[0] ?? 0, r.antLegColor[1] ?? 0, r.antLegColor[2] ?? 0), roughness: r.antRoughness });
    this.limbs = new THREE.InstancedMesh(unitLimbGeometry(detail0.limb), limbMat, r.rigMaxAnts * SEGMENTS_PER_RIG);
    this.limbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.limbs.frustumCulled = false;
    this.limbs.count = 0;
    this.limbs.castShadow = cfg.terrainRender.shadows;
    this.limbs.name = 'ant-limbs';
    this.group.add(this.limbs);
    this.pose = new Float32Array(cfg.sim.capacity * SNAP_FLOATS);
    this.dist = new Float32Array(cfg.sim.capacity);
  }

  get visible(): number {
    return this.stats.lod0 + this.stats.lod1 + this.stats.lod2;
  }

  update(s: InterpolationState, camera: THREE.Vector3, focal: number, probe: TerrainProbe): void {
    this.frame++;
    const r = this.cfg.render;
    const alpha = s.alpha();
    const P = s.prev, C = s.curr, out = this.pose;
    const L = this.m.length;
    const lod0Dist = (L * focal) / r.rigMinPixels;
    const lod2Dist = (L * focal) / r.lod2Pixels;
    const lodOf = new Uint8Array(s.count);
    this.order.length = 0;

    // 1. Interpolate and classify.
    for (let slot = 0; slot < s.count; slot++) {
      const meta = s.currMeta[slot]!;
      if ((((meta >>> META_FLAG_SHIFT) & META_BYTE) & SNAP_FLAG_ALIVE) === 0) { lodOf[slot] = 255; continue; }
      const prevMeta = s.prevMeta[slot]!;
      const same = ((prevMeta >>> META_FLAG_SHIFT) & SNAP_FLAG_ALIVE) !== 0 && (prevMeta >>> META_GEN_SHIFT) === (meta >>> META_GEN_SHIFT);
      const t = same ? alpha : 1, u = 1 - t;
      const o = slot * SNAP_FLOATS;
      for (let k = 0; k < 3; k++) out[o + k] = u * P[o + k]! + t * C[o + k]!;
      // nlerp along the shorter arc
      let sign = 1;
      if (P[o + 3]! * C[o + 3]! + P[o + 4]! * C[o + 4]! + P[o + 5]! * C[o + 5]! + P[o + 6]! * C[o + 6]! < 0) sign = -1;
      let n2 = 0;
      for (let k = 3; k < 7; k++) { out[o + k] = u * sign * P[o + k]! + t * C[o + k]!; n2 += out[o + k]! * out[o + k]!; }
      const inv = 1 / Math.sqrt(n2);
      for (let k = 3; k < 7; k++) out[o + k] = out[o + k]! * inv;
      // Gait phase: interpolate forward across the 1 → 0 wrap.
      let g0 = P[o + SnapF.GAIT]!, g1 = C[o + SnapF.GAIT]!;
      if (!same) g0 = g1;
      if (g1 < g0) g1 += 1;
      const g = u * g0 + t * g1;
      out[o + SnapF.GAIT] = g - Math.floor(g);
      out[o + SnapF.SPEED] = C[o + SnapF.SPEED]!;
      const dx = out[o]! - camera.x, dy = out[o + 1]! - camera.y, dz = out[o + 2]! - camera.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      this.dist[slot] = d;
      // Legs are solved on the ground surface only: ants in the soil are drawn with baked legs (LOD1).
      const underground = (((meta >>> META_FLAG_SHIFT) & META_BYTE) & SNAP_FLAG_UNDERGROUND) !== 0;
      if (d < lod0Dist && !underground) { lodOf[slot] = 0; this.order.push(slot); } else lodOf[slot] = d < lod2Dist ? 1 : 2;
    }
    // Only the nearest rigMaxAnts get rigs; the rest of the candidates fall back to LOD1.
    if (this.order.length > r.rigMaxAnts) {
      this.order.sort((a, b) => this.dist[a]! - this.dist[b]!);
      for (let k = r.rigMaxAnts; k < this.order.length; k++) lodOf[this.order[k]!] = 1;
      this.order.length = r.rigMaxAnts;
    }

    // 2. Instance matrices per LOD.
    const counts = [0, 0, 0];
    const mats = this.lod.map((mesh) => mesh.instanceMatrix.array as Float32Array);
    for (let slot = 0; slot < s.count; slot++) {
      const l = lodOf[slot]!;
      if (l === 255) continue;
      writeMatrix(mats[l]!, counts[l]!++, out, slot * SNAP_FLOATS);
    }
    this.lod.forEach((mesh, i) => {
      mesh.count = counts[i]!;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, counts[i]! * 16);
      mesh.instanceMatrix.needsUpdate = true;
    });

    // 3. Legs and antennae of rigged ants.
    const lm = this.limbs.instanceMatrix.array as Float32Array;
    let seg = 0;
    let over = 0;
    const bp: BodyPose = { x: 0, y: 0, z: 0, q: new Float32Array(4), yaw: 0 };
    const fwd: Vec3 = [0, 0, 0];
    const ant = new Float64Array(9);
    const w0: Vec3 = [0, 0, 0];
    const [rf, rt, rs] = this.m.legRadius;
    const [tCoxa, tTip, tClub] = [r.limbTaper[0]!, r.limbTaper[1]!, r.limbTaper[2]!];
    const time = s.renderTime;
    for (const slot of this.order) {
      const o = slot * SNAP_FLOATS;
      const gen = s.currMeta[slot]! >>> META_GEN_SHIFT;
      let e = this.rigs.get(slot);
      if (!e || e.gen !== gen) { e = { rig: new LegRig(this.m, this.cfg), gen, used: this.frame }; this.rigs.set(slot, e); }
      e.used = this.frame;
      bp.x = out[o]!; bp.y = out[o + 1]!; bp.z = out[o + 2]!;
      (bp.q as Float32Array).set(out.subarray(o + 3, o + 7));
      quatRotate(bp.q, 0, 1, 0, 0, fwd);
      bp.yaw = Math.atan2(-fwd[2], fwd[0]);
      e.rig.update(bp, out[o + SnapF.GAIT]!, out[o + SnapF.SPEED]!, probe);
      over += e.rig.stats.overstretched;
      const J = e.rig.joints;
      for (let i = 0; i < LEGS; i++) {
        const b = i * JOINTS * 3;
        seg = writeLimb(lm, seg, J, b, b + 3, rf * tCoxa, rf);
        seg = writeLimb(lm, seg, J, b + 3, b + 6, rf, rt);
        seg = writeLimb(lm, seg, J, b + 6, b + 9, rt, rs);
        seg = writeLimb(lm, seg, J, b + 9, b + 12, rs, rs * tTip);
      }
      // Antennae: body-frame points → world.
      const sweepPhase = TAU * this.cfg.antennae.sweepFrequency * time + slot;
      for (const side of [-1, 1]) {
        antennaPoints(this.m, this.cfg, side, sweepPhase, ant);
        for (let k = 0; k < 3; k++) {
          quatRotate(bp.q, 0, ant[3 * k]!, ant[3 * k + 1]!, ant[3 * k + 2]!, w0);
          ant[3 * k] = bp.x + w0[0]; ant[3 * k + 1] = bp.y + w0[1]; ant[3 * k + 2] = bp.z + w0[2];
        }
        seg = writeLimb(lm, seg, ant, 0, 3, this.m.antennaRadius, this.m.antennaRadius);
        seg = writeLimb(lm, seg, ant, 3, 6, this.m.antennaRadius, this.m.antennaRadius * tClub);
      }
    }
    this.limbs.count = seg;
    this.limbs.instanceMatrix.clearUpdateRanges();
    this.limbs.instanceMatrix.addUpdateRange(0, seg * 16);
    this.limbs.instanceMatrix.needsUpdate = true;
    // Forget rigs of ants that left LOD0.
    for (const [slot, e] of this.rigs) if (e.used !== this.frame) this.rigs.delete(slot);
    Object.assign(this.stats, { lod0: counts[0]!, lod1: counts[1]!, lod2: counts[2]!, overstretched: over });
  }
}

/** Instance matrix k from position + quaternion at src[o..o+6]. */
function writeMatrix(m: Float32Array, k: number, src: Float32Array, o: number): void {
  const px = src[o]!, py = src[o + 1]!, pz = src[o + 2]!;
  const x = src[o + 3]!, y = src[o + 4]!, z = src[o + 5]!, w = src[o + 6]!;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const b = k * 16;
  m[b] = 1 - (yy + zz); m[b + 1] = xy + wz; m[b + 2] = xz - wy; m[b + 3] = 0;
  m[b + 4] = xy - wz; m[b + 5] = 1 - (xx + zz); m[b + 6] = yz + wx; m[b + 7] = 0;
  m[b + 8] = xz + wy; m[b + 9] = yz - wx; m[b + 10] = 1 - (xx + yy); m[b + 11] = 0;
  m[b + 12] = px; m[b + 13] = py; m[b + 14] = pz; m[b + 15] = 1;
}

/**
 * Instance matrix for a unit limb (radius 1, length 1 along +Y) spanning
 * points a → b of src, radius = mean of r0, r1. Returns the next index.
 */
function writeLimb(m: Float32Array, k: number, src: ArrayLike<number>, a: number, b: number, r0: number, r1: number): number {
  const ax = src[a]!, ay = src[a + 1]!, az = src[a + 2]!;
  let dx = src[b]! - ax, dy = src[b + 1]! - ay, dz = src[b + 2]! - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-9) return k;
  dx /= len; dy /= len; dz /= len;
  // Any unit vector perpendicular to d for the X axis; Z = X × Y.
  let px = -dy, py = dx, pz = 0;
  if (Math.abs(dz) > 0.9) { px = 0; py = -dz; pz = dy; }
  const pn = Math.sqrt(px * px + py * py + pz * pz);
  px /= pn; py /= pn; pz /= pn;
  const qx = py * dz - pz * dy, qy = pz * dx - px * dz, qz = px * dy - py * dx;
  const r = (r0 + r1) / 2;
  const o = k * 16;
  m[o] = px * r; m[o + 1] = py * r; m[o + 2] = pz * r; m[o + 3] = 0;
  m[o + 4] = dx * len; m[o + 5] = dy * len; m[o + 6] = dz * len; m[o + 7] = 0;
  m[o + 8] = qx * r; m[o + 9] = qy * r; m[o + 10] = qz * r; m[o + 11] = 0;
  m[o + 12] = ax; m[o + 13] = ay; m[o + 14] = az; m[o + 15] = 1;
  return k + 1;
}
