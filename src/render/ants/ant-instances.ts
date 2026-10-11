/**
 * Instanced ant bodies driven by interpolated snapshots.
 *
 * Phase 0 uses a placeholder body (three ellipsoids: gaster, mesosoma,
 * head) sized by the worker body length. Real morphology, legs and LOD
 * arrive in Phase 2.
 */

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Config } from '../../config/params.ts';
import { META_BYTE, META_FLAG_SHIFT, META_GEN_SHIFT, SNAP_FLAG_ALIVE, SNAP_FLOATS } from '../../worker/protocol.ts';
import type { InterpolationState } from '../interpolation.ts';
import { rgb } from '../environment.ts';

const SEGMENT_STRIDE = 3;
const SPHERE_WIDTH_SEGMENTS = 12;
const SPHERE_HEIGHT_SEGMENTS = 8;

function placeholderGeometry(cfg: Config): THREE.BufferGeometry {
  const L = cfg.ant.workerBodyLength;
  const seg = cfg.render.placeholderSegments;
  const parts: THREE.BufferGeometry[] = [];
  let maxRadius = 0;
  for (let i = 0; i + SEGMENT_STRIDE - 1 < seg.length; i += SEGMENT_STRIDE) {
    const cx = seg[i]! * L;
    const halfLen = seg[i + 1]! * L;
    const radius = seg[i + 2]! * L;
    maxRadius = Math.max(maxRadius, radius);
    const g = new THREE.SphereGeometry(1, SPHERE_WIDTH_SEGMENTS, SPHERE_HEIGHT_SEGMENTS);
    g.scale(halfLen, radius, radius);
    g.translate(cx, 0, 0);
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('placeholder geometry merge failed');
  merged.translate(0, maxRadius, 0); // rest on the ground until legs exist
  return merged;
}

export class AntInstances {
  readonly mesh: THREE.InstancedMesh;
  visible = 0;

  constructor(cfg: Config) {
    const material = new THREE.MeshStandardNodeMaterial({ color: rgb(cfg.render.antColor), roughness: cfg.render.antRoughness });
    this.mesh = new THREE.InstancedMesh(placeholderGeometry(cfg), material, cfg.sim.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = 'ants';
  }

  /** Interpolate prev -> curr by alpha and write compact instance matrices for live agents. */
  update(s: InterpolationState): void {
    const alpha = s.alpha();
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const P = s.prev, C = s.curr;
    let k = 0;
    for (let slot = 0; slot < s.count; slot++) {
      const meta = s.currMeta[slot]!;
      if ((((meta >>> META_FLAG_SHIFT) & META_BYTE) & SNAP_FLAG_ALIVE) === 0) continue;
      const o = slot * SNAP_FLOATS;
      // Interpolate only if the same individual occupied the slot in both snapshots.
      const prevMeta = s.prevMeta[slot]!;
      const same = (((prevMeta >>> META_FLAG_SHIFT) & SNAP_FLAG_ALIVE) !== 0)
        && ((prevMeta >>> META_GEN_SHIFT) === (meta >>> META_GEN_SHIFT));
      const t = same ? alpha : 1;
      const u = 1 - t;
      const px = u * P[o]! + t * C[o]!;
      const py = u * P[o + 1]! + t * C[o + 1]!;
      const pz = u * P[o + 2]! + t * C[o + 2]!;
      // nlerp along the shorter arc
      let qx0 = P[o + 3]!, qy0 = P[o + 4]!, qz0 = P[o + 5]!, qw0 = P[o + 6]!;
      const qx1 = C[o + 3]!, qy1 = C[o + 4]!, qz1 = C[o + 5]!, qw1 = C[o + 6]!;
      if (qx0 * qx1 + qy0 * qy1 + qz0 * qz1 + qw0 * qw1 < 0) { qx0 = -qx0; qy0 = -qy0; qz0 = -qz0; qw0 = -qw0; }
      let x = u * qx0 + t * qx1, y = u * qy0 + t * qy1, z = u * qz0 + t * qz1, w = u * qw0 + t * qw1;
      const inv = 1 / Math.sqrt(x * x + y * y + z * z + w * w);
      x *= inv; y *= inv; z *= inv; w *= inv;

      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2;
      const yy = y * y2, yz = y * z2, zz = z * z2;
      const wx = w * x2, wy = w * y2, wz = w * z2;
      const b = k * 16;
      m[b] = 1 - (yy + zz); m[b + 1] = xy + wz; m[b + 2] = xz - wy; m[b + 3] = 0;
      m[b + 4] = xy - wz; m[b + 5] = 1 - (xx + zz); m[b + 6] = yz + wx; m[b + 7] = 0;
      m[b + 8] = xz + wy; m[b + 9] = yz - wx; m[b + 10] = 1 - (xx + yy); m[b + 11] = 0;
      m[b + 12] = px; m[b + 13] = py; m[b + 14] = pz; m[b + 15] = 1;
      k++;
    }
    this.mesh.count = k;
    this.visible = k;
    const attr = this.mesh.instanceMatrix;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, k * 16);
    attr.needsUpdate = true;
  }
}
