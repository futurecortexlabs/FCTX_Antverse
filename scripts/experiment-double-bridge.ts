/**
 * Phase 3 acceptance experiment: config.experiment.trials double-bridge runs
 * with different seeds, in parallel worker threads. Each trial converges if
 * the short branch carries > convergedShare of the crossings over the final
 * window; the phase passes if ≥ passFraction of trials converge.
 *
 *   node scripts/experiment-double-bridge.ts [name] [--dir phase-n] [--set path=value ...]
 *
 * Writes docs/reports/<dir>/<name>.csv (one row per trial; dir defaults to
 * phase-3) and <name>-bins.csv (crossings per bin), and prints the verdict.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { buildConfig, overlayFromAssignment, type Overlay } from '../src/config/load.ts';
import { DEFAULT_PARAMS } from '../src/config/params.ts';
import { runBridgeTrial, type TrialResult } from '../src/sim/experiments/double-bridge.ts';

interface Job { overlays: Overlay[]; seed: number }

if (!isMainThread) {
  parentPort!.on('message', (job: Job | null) => {
    if (job === null) { process.exit(0); }
    const { config } = buildConfig([...job.overlays, { sim: { seed: job.seed } }]);
    parentPort!.postMessage(runBridgeTrial(config));
  });
} else {
  const args = process.argv.slice(2);
  const name = args[0] && !args[0].startsWith('--') ? args.shift()! : 'double-bridge';
  const overlays: Overlay[] = [JSON.parse(readFileSync('config/presets/double-bridge.json', 'utf8')) as Overlay];
  let dir = 'docs/reports/phase-3';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--set') {
      const [path, raw] = args[++i]!.split('=') as [string, string];
      overlays.push(overlayFromAssignment(DEFAULT_PARAMS, path, raw));
    } else if (args[i] === '--dir') dir = `docs/reports/${args[++i]!}`;
  }
  const { config } = buildConfig(overlays);
  const ex = config.experiment;
  const seeds = Array.from({ length: ex.trials }, (_, k) => (ex.firstSeed + k) >>> 0);
  const threads = Math.min(seeds.length, Math.max(1, availableParallelism() - 1));
  const results: TrialResult[] = [];
  const t0 = performance.now();
  let next = 0;
  await Promise.all(Array.from({ length: threads }, () => new Promise<void>((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: null });
    const feed = (): void => {
      if (next >= seeds.length) { w.postMessage(null); resolve(); return; }
      w.postMessage({ overlays, seed: seeds[next++]! } satisfies Job);
    };
    w.on('message', (r: TrialResult) => {
      results.push(r);
      console.log(`seed ${r.seed}: final short share ${r.finalShare.toFixed(3)} ${r.converged ? 'converged' : '—'}  (${results.length}/${seeds.length})`);
      feed();
    });
    w.on('error', reject);
    feed();
  })));
  void workerData;
  results.sort((a, b) => a.seed - b.seed);
  const converged = results.filter((r) => r.converged).length;
  const frac = converged / results.length;
  const pass = frac >= ex.passFraction;
  const minutes = ((performance.now() - t0) / 60000).toFixed(1);
  const header = [
    `# date: ${new Date().toISOString()} | node ${process.version} | cpu ${cpus()[0]?.model ?? '?'} | ${threads} threads | ${minutes} min`,
    `# overlays: ${JSON.stringify(overlays)}`,
    `# protocol: ${ex.trials} trials × ${ex.duration} s, final window ${ex.window} s, converged if short share > ${ex.convergedShare}, pass if ≥ ${ex.passFraction}`,
    `# result: ${converged}/${results.length} converged (${(frac * 100).toFixed(0)}%) → ${pass ? 'PASS' : 'FAIL'}`,
  ];
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}.csv`, [...header, 'seed,final_short_share,converged,total_short,total_long,total_trips',
    ...results.map((r) => {
      const t = r.bins.reduce((s, b) => ({ short: s.short + b.short, long: s.long + b.long, trips: s.trips + b.trips }), { short: 0, long: 0, trips: 0 });
      return `${r.seed},${r.finalShare.toFixed(4)},${r.converged ? 1 : 0},${t.short},${t.long},${t.trips}`;
    })].join('\n') + '\n');
  writeFileSync(`${dir}/${name}-bins.csv`, ['seed,bin,t_end_s,short,long,trips,searching',
    ...results.flatMap((r) => r.bins.map((b, i) => `${r.seed},${i},${(i + 1) * ex.bin},${b.short},${b.long},${b.trips},${b.searching}`))].join('\n') + '\n');
  console.log(header.slice(2).join('\n'));
}
