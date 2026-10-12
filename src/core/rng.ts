/**
 * Counter-based random numbers.
 *
 * Every random draw is a pure function of (seed, stream, entity, tick, k).
 * There is no hidden generator state, so results do not depend on update
 * order, on how agents are partitioned across workers, or on how many other
 * draws happened before. This is the foundation of seed reproducibility
 * (see docs/ARCHITECTURE.md §3).
 *
 * Only integer ops (Math.imul, shifts, xor) are used: bit-exact on every
 * JavaScript engine.
 */

import { dlog, dcos, TAU } from './dmath.ts';

/**
 * Stream ids separate independent uses of randomness so that adding a new
 * consumer never shifts the numbers an existing consumer sees.
 * Append new ids; never renumber.
 */
export const Stream = {
  DEBUG_WALK_INIT: 1,
  DEBUG_WALK_STEP: 2,
  TERRAIN_SALT: 3,
  TERRAIN_PEBBLE: 4,
  TERRAIN_GRAIN: 5,
  TERRAIN_LEAF: 6,
  TERRAIN_GRASS: 7,
  /** Initial placement and individual traits of agents. */
  AGENT_INIT: 8,
  /** Exploratory heading noise. */
  EXPLORE_STEP: 9,
  /** Resting ants leaving the nest. */
  NEST_EXIT: 10,
  /** Spontaneous U-turns. */
  UTURN: 11,
  /** Path integration: compass error, odometer gain, give-up time. */
  PATH_INTEGRATION: 12,
  /** Scenario layout (e.g. where the feeder is). */
  SCENARIO: 13,
  /** Underground walking (choice of the next voxel). */
  BURROW: 14,
  /** Digging (whether and where) and dumping (how far out). */
  DIG: 15,
  /** Phase 6: founding the colony, laying, development, deaths. */
  COLONY: 16,
  /** Phase 6: choosing a nestmate in contact. */
  CONTACT: 17,
  /** Phase 6: taking up and leaving tasks. */
  TASK: 18,
  TEST: 0xffff,
} as const;
export type StreamId = (typeof Stream)[keyof typeof Stream];

/** 32-bit finalizer ("lowbias32", C. Wellons). Good avalanche, integer-only. */
export function mix32(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

const GOLDEN = 0x9e3779b9;

/** Hash an ordered tuple of 32-bit integers into one uint32. */
export function hashKey(seed: number, stream: number, entity: number, tick: number, k: number): number {
  let h = mix32((seed ^ GOLDEN) >>> 0);
  h = mix32((h + Math.imul(stream >>> 0, GOLDEN)) >>> 0);
  h = mix32((h ^ (entity >>> 0)) >>> 0);
  h = mix32((h + Math.imul(tick >>> 0, 0x85ebca6b)) >>> 0);
  h = mix32((h ^ Math.imul(k >>> 0, 0xc2b2ae35)) >>> 0);
  return h;
}

const INV_2_32 = 1 / 4294967296;

/** Uniform in [0, 1). */
export function rand(seed: number, stream: number, entity: number, tick: number, k = 0): number {
  return hashKey(seed, stream, entity, tick, k) * INV_2_32;
}

/** Uniform in (0, 1] — safe as a log() argument. */
export function randOpen0(seed: number, stream: number, entity: number, tick: number, k = 0): number {
  return (hashKey(seed, stream, entity, tick, k) + 1) * INV_2_32;
}

/** Uniform in [lo, hi). */
export function randRange(lo: number, hi: number, seed: number, stream: number, entity: number, tick: number, k = 0): number {
  return lo + (hi - lo) * rand(seed, stream, entity, tick, k);
}

/**
 * Standard normal via Box–Muller using deterministic dmath functions.
 * Consumes sub-keys 2k and 2k+1.
 */
export function randNormal(seed: number, stream: number, entity: number, tick: number, k = 0): number {
  const u1 = randOpen0(seed, stream, entity, tick, 2 * k);
  const u2 = rand(seed, stream, entity, tick, 2 * k + 1);
  return Math.sqrt(-2 * dlog(u1)) * dcos(TAU * u2);
}
