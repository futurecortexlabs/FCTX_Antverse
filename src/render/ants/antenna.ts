/**
 * Geniculate antenna pose in the body frame: scape from the socket on the
 * head, elbow, funiculus. The scape sweeps sideways while walking
 * (ASM-SEN-001); `phase` is the sweep phase in radians. Visual only for now —
 * Phase 3 will use antenna tip positions for chemical sensing.
 */

import type { Config } from '../../config/params.ts';
import type { Morphology } from '../../locomotion/morphology.ts';

/**
 * Writes socket, elbow and tip (body frame) into out[0..8].
 * side: -1 left, +1 right.
 */
export function antennaPoints(m: Morphology, cfg: Config, side: number, phase: number, out: Float64Array): Float64Array {
  const [elev, spread] = [cfg.morphology.antennaPose[0]!, cfg.morphology.antennaPose[1]!];
  const sweep = cfg.antennae.sweepAmplitude * Math.sin(phase + (side > 0 ? Math.PI : 0));
  const sx = m.antennaBase[0], sy = m.antennaBase[1], sz = side * Math.abs(m.antennaBase[2]);
  const az = spread + sweep;
  // Scape: forward, raised by elev, splayed outward by az.
  const dx = Math.cos(elev) * Math.cos(az), dy = Math.sin(elev), dz = side * Math.cos(elev) * Math.sin(az);
  const ex = sx + dx * m.scape, ey = sy + dy * m.scape, ez = sz + dz * m.scape;
  // Funiculus: the scape direction bent down by the elbow angle (in the vertical plane of the scape).
  const horiz = Math.hypot(dx, dz) || 1;
  const pitch = Math.atan2(dy, horiz) - m.antennaElbow;
  const fx = (dx / horiz) * Math.cos(pitch), fz = (dz / horiz) * Math.cos(pitch), fy = Math.sin(pitch);
  out[0] = sx; out[1] = sy; out[2] = sz;
  out[3] = ex; out[4] = ey; out[5] = ez;
  out[6] = ex + fx * m.funiculus; out[7] = ey + fy * m.funiculus; out[8] = ez + fz * m.funiculus;
  return out;
}
