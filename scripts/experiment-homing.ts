/**
 * Phase 4 acceptance experiment: homing by path integration on open ground
 * with no pheromone. config.experiment.trials single-forager trials (seeds
 * homingFirstSeed…), each run twice: normal and displaced (ENG-EXP-002).
 *
 *   normal     passes if ≥ passFraction of trials get back into the nest
 *              within homingLimit of turning for home;
 *   displaced  passes if ≥ passFraction of trials centre their nest search
 *              within searchTolerance of the fictive nest (and nearer to it
 *              than to the real nest).
 *
 *   node scripts/experiment-homing.ts [name] [--set path=value ...]
 *
 * Writes docs/reports/phase-4/<name>.csv (one row per trial and condition)
 * and <name>-paths.json (trajectories of the first PATHS_KEPT trials, for plotting).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { buildConfig, overlayFromAssignment, type Overlay } from '../src/config/load.ts';
import { DEFAULT_PARAMS } from '../src/config/params.ts';
import { runHomingTrial, type HomingResult } from '../src/sim/experiments/homing.ts';

interface Job { overlays: Overlay[]; seed: number; displaced: boolean }
/** Trajectories written for plotting: the first trials of each condition, every PATH_STRIDE-th sample. */
const PATHS_KEPT = 6;
const PATH_STRIDE = 2;

if (!isMainThread) {
  parentPort!.on('message', (job: Job | null) => {
    if (job === null) process.exit(0);
    const { config } = buildConfig([...job.overlays, { population: { count: 1 }, sim: { seed: job.seed } }]);
    parentPort!.postMessage(runHomingTrial(config, job.displaced));
  });
} else {
  const args = process.argv.slice(2);
  const name = args[0] && !args[0].startsWith('--') ? args.shift()! : 'homing';
  const overlays: Overlay[] = [JSON.parse(readFileSync('config/presets/homing.json', 'utf8')) as Overlay];
  for (let i = 0; i < args.length; i++) if (args[i] === '--set') {
    const [path, raw] = args[++i]!.split('=') as [string, string];
    overlays.push(overlayFromAssignment(DEFAULT_PARAMS, path, raw));
  }
  const { config } = buildConfig(overlays);
  const ex = config.experiment;
  const jobs: Job[] = [];
  for (const displaced of [false, true]) for (let k = 0; k < ex.trials; k++) jobs.push({ overlays, seed: (ex.homingFirstSeed + k) >>> 0, displaced });
  const threads = Math.min(jobs.length, Math.max(1, availableParallelism() - 1));
  const results: HomingResult[] = [];
  const t0 = performance.now();
  let next = 0;
  await Promise.all(Array.from({ length: threads }, () => new Promise<void>((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url));
    const feed = (): void => {
      if (next >= jobs.length) { w.postMessage(null); resolve(); return; }
      w.postMessage(jobs[next++]!);
    };
    w.on('message', (r: HomingResult) => { results.push(r); feed(); });
    w.on('error', reject);
    feed();
  })));
  results.sort((a, b) => Number(a.displaced) - Number(b.displaced) || a.seed - b.seed);
  const normal = results.filter((r) => !r.displaced), displaced = results.filter((r) => r.displaced);
  const reached = normal.filter((r) => r.reached).length;
  const nearFictive = displaced.filter((r) => r.searchCentreToFictive !== null && r.searchCentreToFictive <= ex.searchTolerance
    && r.searchCentreToFictive < r.searchCentreToReal!).length;
  const passN = reached / normal.length >= ex.passFraction, passD = nearFictive / displaced.length >= ex.passFraction;
  const pct = (k: number, n: number): string => `${k}/${n} (${((100 * k) / n).toFixed(0)}%)`;
  const header = [
    `# date: ${new Date().toISOString()} | node ${process.version} | cpu ${cpus()[0]?.model ?? '?'} | ${threads} threads | ${((performance.now() - t0) / 1000).toFixed(0)} s`,
    `# overlays: ${JSON.stringify(overlays)}`,
    `# protocol: ${ex.trials} trials (seeds ${ex.homingFirstSeed}–${ex.homingFirstSeed + ex.trials - 1}), homing limit ${ex.homingLimit} s, displacement ${ex.displacement} mm, search window ${ex.searchWindow} s, tolerance ${ex.searchTolerance} mm, pass if ≥ ${ex.passFraction}`,
    `# result normal: reached the nest ${pct(reached, normal.length)} → ${passN ? 'PASS' : 'FAIL'}`,
    `# result displaced: searched at the fictive nest ${pct(nearFictive, displaced.length)} → ${passD ? 'PASS' : 'FAIL'}`,
  ];
  const f = (v: number | null): string => (v === null ? '' : v.toFixed(2));
  mkdirSync('docs/reports/phase-4', { recursive: true });
  writeFileSync(`docs/reports/phase-4/${name}.csv`, [...header,
    'condition,seed,found_food,outbound_mm,max_distance_mm,home_distance_mm,reached,time_to_nest_s,vector_end_error_mm,straightness,search_centre_to_fictive_mm,search_centre_to_real_mm',
    ...results.map((r) => [r.displaced ? 'displaced' : 'normal', r.seed, r.foundFood ? 1 : 0, f(r.outboundLength), f(r.maxDistance), f(r.homeDistance),
      r.reached ? 1 : 0, f(r.reached ? r.timeToNest : null), f(r.vectorEndError), f(r.straightness), f(r.searchCentreToFictive), f(r.searchCentreToReal)].join(','))].join('\n') + '\n');
  const keep = (list: HomingResult[]): unknown[] => list.slice(0, PATHS_KEPT).map((r) => ({
    seed: r.seed, returnIndex: Math.floor(r.returnIndex / PATH_STRIDE), fictive: r.fictive, feeder: r.feeder, reached: r.reached,
    path: r.path.filter((_, i) => i % PATH_STRIDE === 0).map(([x, z, s]) => [+x.toFixed(1), +z.toFixed(1), s]),
  }));
  writeFileSync(`docs/reports/phase-4/${name}-paths.json`, JSON.stringify({ normal: keep(normal), displaced: keep(displaced), displacement: ex.displacement }) + '\n');
  console.log(header.slice(2).join('\n'));
}
