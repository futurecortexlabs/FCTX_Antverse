/**
 * Simulation-only benchmark in Node (no rendering): mean wall time per
 * fixed step for each agent count in bench.counts. Writes
 * docs/reports/bench/phase-3-sim-node.csv.
 *
 *   npm run bench:sim
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { buildConfig } from '../src/config/load.ts';
import { World } from '../src/sim/world.ts';

const { config } = buildConfig();
const ticks = config.bench.simTicks;
const lines = [
  `# date: ${new Date().toISOString()}`,
  `# node: ${process.version} | cpu: ${cpus()[0]?.model ?? 'unknown'}`,
  `# ticks per count: ${ticks} (after ${Math.ceil(ticks / 10)} warm-up ticks)`,
  'count,ms_per_tick,max_realtime_speed',
];
for (const count of config.bench.counts) {
  const { config: c } = buildConfig([{ population: { count } }]);
  const world = new World(c);
  for (let i = 0; i < Math.ceil(ticks / 10); i++) world.step();
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) world.step();
  const ms = (performance.now() - t0) / ticks;
  const speed = (c.sim.dt * 1000) / ms;
  lines.push(`${count},${ms.toFixed(4)},${speed.toFixed(1)}`);
  console.log(`${String(count).padStart(7)} agents: ${ms.toFixed(4)} ms/tick  (max ×${speed.toFixed(1)} real time)`);
}
mkdirSync('docs/reports/bench', { recursive: true });
writeFileSync('docs/reports/bench/phase-3-sim-node.csv', lines.join('\n') + '\n');
