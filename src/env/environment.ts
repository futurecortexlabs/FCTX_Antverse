/**
 * The physical environment over time (Phase 7): the sun's position and the
 * light it gives, the temperature at the soil surface and in the soil, and
 * (step D) rain. A pure function of the configuration and the simulated time,
 * so the simulation threads and the renderer compute exactly the same values.
 *
 * - Sun: declination δ = 23.44° · sin(2π (284 + N) / 365) (Cooper 1969) and
 *   the hour angle of local solar time; elevation from the latitude
 *   (PHY-ENV-001). World axes: +X east, −Z north, +Y up.
 * - Light: relative irradiance, the sine of the elevation, faded to zero over
 *   civil twilight (PHY-ENV-001).
 * - Surface temperature: a daily cosine around its mean, warmest at peakHour
 *   (ASM-ENV-001). In the soil the daily wave is damped and delayed with
 *   depth z by e^(−z/D) and z/D (heat conduction; damping depth D,
 *   PHY-ENV-002).
 * - Ectotherm rates (walking speed, metabolism) change with temperature by
 *   Q10, up to an optimum, then fall to zero at the critical maximum; below
 *   the critical minimum ants are torpid (BIO-ENV-001, ASM-ENV-002).
 * Disabled (env.enabled = false), the environment is a constant noon at the
 * reference temperature: light 1, every rate factor 1.
 */

import { datan2, dcos, dexp, dpow, dsin, PI, TAU } from '../core/dmath.ts';
import { S_PER_DAY, S_PER_H } from '../core/units.ts';
import type { Config } from '../config/params.ts';

const DEG = PI / 180;
const DAYS_PER_YEAR = 365;
const HOURS_PER_DAY = 24;
/** Cooper's declination formula: day offset and amplitude. */
const COOPER_OFFSET = 284;
const COOPER_AMPLITUDE = 23.44 * DEG;
/** Degrees of hour angle per hour. */
const DEG_PER_HOUR = 15;
const NOON = 12;
/** Q10 is the factor per 10 °C. */
const Q10_SPAN = 10;

export interface Sun {
  /** Elevation above the horizon and azimuth clockwise from north (rad). */
  elevation: number;
  azimuth: number;
  /** Unit vector towards the sun in world axes (+X east, +Y up, −Z north). */
  x: number;
  y: number;
  z: number;
}

const asin = (v: number): number => datan2(v, Math.sqrt(Math.max(0, 1 - v * v)));

export class Environment {
  readonly enabled: boolean;
  private readonly cfg: Config;

  constructor(cfg: Config) {
    this.cfg = cfg;
    this.enabled = cfg.env.enabled;
  }

  /** Local solar time (hours since midnight, 0–24) at simulated time t (s). */
  hour(t: number): number {
    const h = this.cfg.env.startHour + t / S_PER_H;
    return h - HOURS_PER_DAY * Math.floor(h / HOURS_PER_DAY);
  }

  /** Day of the year at simulated time t. */
  day(t: number): number {
    return this.cfg.env.dayOfYear + Math.floor((this.cfg.env.startHour + t / S_PER_H) / HOURS_PER_DAY);
  }

  sun(t: number, out: Sun): Sun {
    const lat = this.cfg.env.latitude * DEG;
    const decl = COOPER_AMPLITUDE * dsin((TAU * (COOPER_OFFSET + this.day(t))) / DAYS_PER_YEAR);
    const ha = (this.hour(t) - NOON) * DEG_PER_HOUR * DEG;
    const sinEl = dsin(lat) * dsin(decl) + dcos(lat) * dcos(decl) * dcos(ha);
    const el = asin(sinEl);
    // Horizontal components: east and north.
    const east = -dcos(decl) * dsin(ha);
    const north = dsin(decl) * dcos(lat) - dcos(decl) * dsin(lat) * dcos(ha);
    out.elevation = el;
    out.azimuth = datan2(east, north);
    const ce = dcos(el), h = Math.sqrt(east * east + north * north) || 1;
    out.x = (ce * east) / h; out.y = sinEl; out.z = (-ce * north) / h;
    return out;
  }

  /** Relative irradiance 0–1: the sine of the sun's elevation, faded out over twilight. */
  light(t: number): number {
    if (!this.enabled) return 1;
    const el = this.sun(t, scratch).elevation;
    const tw = this.cfg.env.twilight * DEG;
    if (el <= -tw) return 0;
    if (el <= 0) return (this.cfg.env.twilightLight * (el + tw)) / tw;
    return Math.max(this.cfg.env.twilightLight, dsin(el));
  }

  /** Temperature at the soil surface (°C). */
  surfaceTemp(t: number): number {
    return this.soilTemp(0, t);
  }

  /** Temperature at depth z (mm below the surface, °C). */
  soilTemp(z: number, t: number): number {
    const e = this.cfg.env;
    if (!this.enabled) return e.referenceTemp;
    const D = e.dampingDepth;
    const phase = (TAU * (t + (e.startHour - e.peakHour) * S_PER_H)) / S_PER_DAY - z / D;
    return e.meanTemp + e.surfaceAmplitude * dexp(-z / D) * dcos(phase);
  }

  /** Factor on rates of an ectotherm at temperature T (1 at the reference temperature). */
  rate(T: number): number {
    const e = this.cfg.env;
    if (!this.enabled) return 1;
    const [tMin, tOpt, tMax] = e.thermalLimits as readonly [number, number, number];
    if (T <= tMin || T >= tMax) return e.torpidRate;
    const q = dpow(e.q10, (Math.min(T, tOpt) - e.referenceTemp) / Q10_SPAN);
    if (T <= tOpt) return Math.max(e.torpidRate, q);
    // Above the optimum the rate falls linearly to the critical maximum.
    return Math.max(e.torpidRate, (q * (tMax - T)) / (tMax - tOpt));
  }
}

const scratch: Sun = { elevation: 0, azimuth: 0, x: 0, y: 1, z: 0 };
