/**
 * Headless runs: advance a fresh World for N ticks without any clock or
 * renderer. Used by tests, scripts, experiments and the in-app
 * determinism check — all of which must agree on the resulting hash.
 */

import { formatHash } from '../core/statehash.ts';
import type { Config } from '../config/params.ts';
import { World } from './world.ts';

export function runHeadless(config: Config, ticks: number): World {
  const world = new World(config);
  for (let i = 0; i < ticks; i++) world.step();
  return world;
}

export interface DeterminismResult {
  ticks: number;
  hashA: string;
  hashB: string;
  hashOtherSeed: string;
  identical: boolean;
  seedSensitive: boolean;
}

/** Run twice with the same seed and once with seed+1. */
export function checkDeterminism(config: Config, ticks: number): DeterminismResult {
  const hashA = formatHash(runHeadless(config, ticks).stateHash());
  const hashB = formatHash(runHeadless(config, ticks).stateHash());
  const other: Config = { ...config, sim: { ...config.sim, seed: (config.sim.seed + 1) >>> 0 } };
  const hashOtherSeed = formatHash(runHeadless(other, ticks).stateHash());
  return { ticks, hashA, hashB, hashOtherSeed, identical: hashA === hashB, seedSensitive: hashA !== hashOtherSeed };
}
