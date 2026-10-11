/**
 * Ant geometry built from the body plan (locomotion/morphology.ts): head with
 * compound eyes and mandibles, mesosoma, scale-like petiole, gaster; legs and
 * geniculate antennae as tapered cylinders. Colours are vertex colours.
 * Model origin = mesosoma centre, +X forward, +Y up, +Z right.
 */

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Config } from '../../config/params.ts';
import { LegRig, JOINTS, type TerrainProbe } from '../../locomotion/legs.ts';
import { LEGS, type Morphology } from '../../locomotion/morphology.ts';
import { antennaPoints } from './antenna.ts';

export interface ModelDetail {
  /** sphere segments (width, height) for body parts */
  body: [number, number];
  /** radial segments of leg / antenna cylinders */
  limb: number;
}

function colored(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // Keep attribute sets identical for merging.
  g.deleteAttribute('uv');
  return g;
}

function ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, seg: [number, number], c: THREE.Color): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg[0], seg[1]);
  g.scale(rx, ry, rz);
  g.translate(cx, cy, cz);
  return colored(g, c);
}

/** Cylinder from p0 to p1, radii r0 → r1. */
export function limb(p0: THREE.Vector3, p1: THREE.Vector3, r0: number, r1: number, radial: number, c: THREE.Color): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(p1, p0);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(p0.x, p0.y, p0.z);
  return colored(g, c);
}

const rgb = (v: readonly number[], o = 0): THREE.Color => new THREE.Color(v[o] ?? 0, v[o + 1] ?? 0, v[o + 2] ?? 0);

/** Body only (head, eyes, mandibles, mesosoma, petiole, gaster). */
export function bodyGeometry(m: Morphology, cfg: Config, detail: ModelDetail): THREE.BufferGeometry {
  const r = cfg.render;
  const body = rgb(r.antColor), eye = rgb(r.antEyeColor), mand = rgb(r.antMandibleColor);
  const parts: THREE.BufferGeometry[] = [];
  const { head, mesosoma: ms, petiole: pt, gaster: gs } = m;
  parts.push(ellipsoid(head.cx, head.cy, 0, head.l / 2, head.h / 2, head.w / 2, detail.body, body));
  parts.push(ellipsoid(ms.cx, ms.cy, 0, ms.l / 2, ms.h / 2, ms.w / 2, detail.body, body));
  // Petiole: an upright scale (Formica).
  parts.push(ellipsoid(pt.cx, pt.cy + pt.h * r.petioleRaise, 0, pt.l / 2, pt.h / 2, pt.w / 2, detail.body, body));
  parts.push(ellipsoid(gs.cx, gs.cy, 0, gs.l / 2, gs.h / 2, gs.w / 2, detail.body, body));
  const small: [number, number] = [Math.max(4, detail.body[0] >> 1), Math.max(3, detail.body[1] >> 1)];
  for (const side of [-1, 1]) {
    // Compound eyes on the sides of the head, mandibles at its front.
    parts.push(ellipsoid(head.cx + head.l * r.eyePlacement[0]!, head.cy + head.h * r.eyePlacement[1]!, side * head.w * r.eyePlacement[2]!, m.eye / 2, m.eye / 2, m.eye * r.eyeFlatness, small, eye));
    const [mf, mu, ml] = [r.mandiblePlacement[0]!, r.mandiblePlacement[1]!, r.mandiblePlacement[2]!];
    parts.push(ellipsoid(head.cx + head.l / 2 + m.mandible * mf, head.cy + head.h * mu, side * head.w * ml, m.mandible / 2, m.mandible * r.mandibleShape[0]!, m.mandible * r.mandibleShape[1]!, small, mand));
  }
  return mergeGeometries(parts, false)!;
}

/** Body plus legs and antennae baked in a neutral standing pose (mid-distance LOD). */
export function bodyWithLegsGeometry(m: Morphology, cfg: Config, detail: ModelDetail): THREE.BufferGeometry {
  const parts = [bodyGeometry(m, cfg, detail)];
  const legColor = rgb(cfg.render.antLegColor);
  const [tCoxa, tTip, tClub] = [cfg.render.limbTaper[0]!, cfg.render.limbTaper[1]!, cfg.render.limbTaper[2]!];
  // Solve the legs once on flat ground with the body at ride height.
  const flat: TerrainProbe = { support: () => -cfg.locomotion.rideHeight, solid: (_x, y) => y < -cfg.locomotion.rideHeight };
  const rig = new LegRig(m, cfg);
  rig.reset({ x: 0, y: 0, z: 0, q: [0, 0, 0, 1], yaw: 0 }, cfg.locomotion.dutyFactor / 2, cfg.locomotion.speed, flat);
  const v = (k: number): THREE.Vector3 => new THREE.Vector3(rig.joints[k], rig.joints[k + 1], rig.joints[k + 2]);
  const [rf, rt, rs] = m.legRadius;
  for (let i = 0; i < LEGS; i++) {
    // Neutral stance for the baked pose: all six feet down at their neutral spots.
    const o = i * JOINTS * 3;
    parts.push(limb(v(o), v(o + 3), rf * tCoxa, rf, detail.limb, legColor));
    parts.push(limb(v(o + 3), v(o + 6), rf, rt, detail.limb, legColor));
    parts.push(limb(v(o + 6), v(o + 9), rt, rs, detail.limb, legColor));
    parts.push(limb(v(o + 9), v(o + 12), rs, rs * tTip, detail.limb, legColor));
  }
  const pts = new Float64Array(9);
  for (const side of [-1, 1]) {
    antennaPoints(m, cfg, side, 0, pts);
    const p = (k: number): THREE.Vector3 => new THREE.Vector3(pts[k], pts[k + 1], pts[k + 2]);
    parts.push(limb(p(0), p(3), m.antennaRadius, m.antennaRadius, detail.limb, legColor));
    parts.push(limb(p(3), p(6), m.antennaRadius, m.antennaRadius * tClub, detail.limb, legColor));
  }
  return mergeGeometries(parts, false)!;
}

/** Unit limb: radius 1, length 1 along +Y from the origin (scaled per instance). */
export function unitLimbGeometry(radial: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, radial, 1, true);
  g.translate(0, 0.5, 0);
  return g;
}
