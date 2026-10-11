/**
 * Worker body plan in millimetres, derived from config.morphology (fractions
 * of body length; ASM-MOR-002…004). Body frame: origin at the mesosoma
 * centre, +X forward, +Y up, +Z right (see core/quat.ts).
 *
 * Legs are indexed pair*2 + side: 0 L1, 1 R1, 2 L2, 3 R2, 4 L3, 5 R3
 * (side 0 = left, z < 0). Tripod groups: A = {L1, R2, L3}, B = {R1, L2, R3}.
 */

import { dcos, dsin } from '../core/dmath.ts';
import type { Config } from '../config/params.ts';

export const LEGS = 6;
export const PAIRS = 3;

export interface Segment {
  /** centre x, y in the body frame */
  cx: number;
  cy: number;
  /** full length (x), width (z), height (y) */
  l: number;
  w: number;
  h: number;
}

export interface LegPlan {
  /** coxa base in the body frame */
  base: [number, number, number];
  /** unit direction of the coxa in the body frame (down and outward) */
  coxaDir: [number, number, number];
  coxa: number;
  femur: number;
  tibia: number;
  tarsus: number;
  /** neutral foot position in the body frame, on the ground plane (y unused) */
  neutral: [number, number];
  /** -1 left, +1 right */
  side: number;
  /** 0 or 0.5: phase offset of the leg's tripod group */
  phaseOffset: number;
}

export interface Morphology {
  length: number;
  head: Segment;
  mesosoma: Segment;
  petiole: Segment;
  gaster: Segment;
  eye: number;
  mandible: number;
  scape: number;
  funiculus: number;
  antennaElbow: number;
  /** antenna socket on the head front, body frame, for the left side (mirror z for right) */
  antennaBase: [number, number, number];
  legs: LegPlan[];
  legRadius: [number, number, number];
  antennaRadius: number;
}

/** Tripod group of each leg: A (offset 0) = L1, R2, L3; B (offset 0.5) = R1, L2, R3. */
export const TRIPOD_OFFSET = [0, 0.5, 0.5, 0, 0, 0.5] as const;

export function buildMorphology(cfg: Config): Morphology {
  const L = cfg.ant.workerBodyLength;
  const m = cfg.morphology;
  const seg = (v: readonly number[], cx: number, cy: number): Segment => ({ cx, cy, l: v[0]! * L, w: v[1]! * L, h: v[2]! * L });
  const mes = seg(m.mesosoma, 0, 0);
  const head = seg(m.head, 0, 0);
  const pet = seg(m.petiole, 0, 0);
  const gas = seg(m.gaster, 0, 0);
  // Segments touch end to end along the body axis.
  head.cx = mes.l / 2 + head.l / 2;
  head.cy = mes.h * m.segmentRaise[0]!;
  pet.cx = -(mes.l / 2 + pet.l / 2);
  pet.cy = 0;
  gas.cx = pet.cx - pet.l / 2 - gas.l / 2;
  gas.cy = mes.h * m.segmentRaise[1]!;

  const legs: LegPlan[] = [];
  const nf = cfg.locomotion.neutralFoot;
  for (let pair = 0; pair < PAIRS; pair++) {
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      const i = pair * 2 + s;
      // Coxae hang below the mesosoma sides, pointing down and outwards.
      const [down, outward] = [m.coxaBase[0]!, m.coxaBase[1]!];
      const ca = m.coxaAngle, dy = -dcos(ca), dz = side * dsin(ca);
      legs.push({
        base: [m.coxaAttach[pair]! * L, -mes.h * down, side * mes.w * outward],
        coxaDir: [0, dy, dz],
        coxa: m.coxa[pair]! * L,
        femur: m.femur[pair]! * L,
        tibia: m.tibia[pair]! * L,
        tarsus: m.tarsus[pair]! * L,
        neutral: [nf[pair * 2]! * L, side * nf[pair * 2 + 1]! * L],
        side,
        phaseOffset: TRIPOD_OFFSET[i]!,
      });
    }
  }
  return {
    length: L, head, mesosoma: mes, petiole: pet, gaster: gas,
    eye: m.eye * L, mandible: m.mandible * L, scape: m.scape * L, funiculus: m.funiculus * L,
    antennaElbow: m.antennaElbow,
    antennaBase: [head.cx + head.l * m.antennaSocket[0]!, head.cy + head.h * m.antennaSocket[1]!, -head.w * m.antennaSocket[2]!],
    legs,
    legRadius: [m.legRadius[0]! * L, m.legRadius[1]! * L, m.legRadius[2]! * L],
    antennaRadius: m.antennaRadius * L,
  };
}

/** Stride length (mm per gait cycle) at speed v (mm/s). */
export function strideLength(cfg: Config, v: number): number {
  return cfg.locomotion.strideBase + cfg.locomotion.strideSlope * v;
}
