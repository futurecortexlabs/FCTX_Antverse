/**
 * Phase 5 acceptance experiment: nest excavation by groups of
 * experiment.digCounts workers, experiment.digSeeds seeds each, for
 * experiment.digDuration (ENG-EXP-003). Criteria:
 *   1. saturation  ≥ passFraction of runs dig less than slowFraction of their
 *                  peak rate over the last lateFraction of the run;
 *   2. scaling     the final volume regressed on group size has R² ≥ minR2;
 *   3. integrity   every run: no dug voxel disconnected from the entrance,
 *                  no pellet unaccounted for.
 *
 *   node scripts/experiment-digging.ts [name] [--set path=value ...]
 *
 * Writes docs/reports/phase-5/<name>.csv and <name>-bins.csv.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { buildConfig, overlayFromAssignment, type Overlay } from '../src/config/load.ts';
import { DEFAULT_PARAMS } from '../src/config/params.ts';
import { runDiggingTrial, type DigResult } from '../src/sim/experiments/digging.ts';

interface Job { overlays: Overlay[]; seed: number; workers: number }

if (!isMainThread) {
  parentPort!.on('message', (job: Job | null) => {
    if (job === null) process.exit(0);
    const { config } = buildConfig([...job.overlays, { population: { count: job.workers }, sim: { seed: job.seed } }]);
    parentPort!.postMessage(runDiggingTrial(config));
  });
} else {
  const args = process.argv.slice(2);
  const name = args[0] && !args[0].startsWith('--') ? args.shift()! : 'digging';
  const overlays: Overlay[] = [JSON.parse(readFileSync('config/presets/digging.json', 'utf8')) as Overlay];
  for (let i = 0; i < args.length; i++) if (args[i] === '--set') {
    const [path, raw] = args[++i]!.split('=') as [string, string];
    overlays.push(overlayFromAssignment(DEFAULT_PARAMS, path, raw));
  }
  const { config } = buildConfig(overlays);
  const ex = config.experiment;
  const jobs: Job[] = [];
  for (const workers of [...(ex.digCounts as number[])].sort((p, q) => q - p)) {
    for (let k = 0; k < ex.digSeeds; k++) jobs.push({ overlays, seed: (ex.digFirstSeed + k) >>> 0, workers });
  }
  const threads = Math.min(jobs.length, Math.max(1, availableParallelism() - 1));
  const results: DigResult[] = [];
  const t0 = performance.now();
  let next = 0;
  await Promise.all(Array.from({ length: threads }, () => new Promise<void>((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url));
    const feed = (): void => {
      if (next >= jobs.length) { w.postMessage(null); resolve(); return; }
      w.postMessage(jobs[next++]!);
    };
    w.on('message', (r: DigResult) => {
      results.push(r);
      console.log(`N=${r.workers} seed ${r.seed}: ${r.volume} mm³, depth ${r.depth} mm, late/peak ${(r.lateRate / r.peakRate).toFixed(2)} (${results.length}/${jobs.length})`);
      feed();
    });
    w.on('error', reject);
    feed();
  })));
  results.sort((a, b) => a.workers - b.workers || a.seed - b.seed);
  // Least-squares fit V = a + b·N and its R².
  const xs = results.map((r) => r.workers), ys = results.map((r) => r.volume);
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length, my = ys.reduce((s, y) => s + y, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; syy += (ys[i]! - my) ** 2; }
  const slope = sxy / sxx, intercept = my - slope * mx, r2 = (sxy * sxy) / (sxx * syy);
  const saturated = results.filter((r) => r.saturated).length;
  const intact = results.every((r) => r.disconnected === 0 && r.unaccounted === 0);
  const pass1 = saturated / results.length >= ex.passFraction, pass2 = r2 >= ex.minR2;
  const header = [
    `# date: ${new Date().toISOString()} | node ${process.version} | cpu ${cpus()[0]?.model ?? '?'} | ${threads} threads | ${((performance.now() - t0) / 60000).toFixed(0)} min`,
    `# overlays: ${JSON.stringify(overlays)}`,
    `# protocol: N = ${(ex.digCounts as number[]).join(', ')} × ${ex.digSeeds} seeds (from ${ex.digFirstSeed}), ${ex.digDuration / 3600} h, bins ${ex.digBin} s`,
    `# result saturation: ${saturated}/${results.length} runs (last ${ex.lateFraction * 100}% of the run below ${ex.slowFraction * 100}% of the peak rate) → ${pass1 ? 'PASS' : 'FAIL'}`,
    `# result scaling: V = ${intercept.toFixed(0)} + ${slope.toFixed(1)}·N mm³, R² = ${r2.toFixed(3)} → ${pass2 ? 'PASS' : 'FAIL'}`,
    `# result integrity: ${intact ? 'all runs connected and conserved → PASS' : 'FAIL'}`,
  ];
  mkdirSync('docs/reports/phase-5', { recursive: true });
  writeFileSync(`docs/reports/phase-5/${name}.csv`, [...header,
    'workers,seed,volume_mm3,volume_per_worker_mm3,depth_mm,peak_per_bin,late_per_bin,saturated,disconnected,unaccounted,volume_by_10mm_depth',
    ...results.map((r) => [r.workers, r.seed, r.volume, (r.volume / r.workers).toFixed(1), r.depth, r.peakRate, r.lateRate.toFixed(1), r.saturated ? 1 : 0, r.disconnected, r.unaccounted, r.byDepth.join(' ')].join(','))].join('\n') + '\n');
  writeFileSync(`docs/reports/phase-5/${name}-bins.csv`, ['workers,seed,bin,t_end_s,dug',
    ...results.flatMap((r) => r.bins.map((b, i) => `${r.workers},${r.seed},${i},${(i + 1) * ex.digBin},${b}`))].join('\n') + '\n');
  console.log(header.slice(2).join('\n'));
}
