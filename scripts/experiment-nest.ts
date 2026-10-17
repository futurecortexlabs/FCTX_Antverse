/**
 * Nest-shape acceptance (ENG-EXP-006): experiment.nestSeeds colonies in the
 * field scenario, each starting from a pit of experiment.nestPit, seeds from
 * experiment.nestFirstSeed (never used while developing). Criterion: at
 * least nestMinChambers flat chambers and more than nestUpperShare of the
 * volume in the upper half, in ≥ passFraction of the colonies.
 *
 *   node scripts/experiment-nest.ts [name] [--set path=value ...]
 *
 * Writes docs/reports/nest-shape/<name>.csv and <name>-areas.csv.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { buildConfig, overlayFromAssignment, type Overlay } from '../src/config/load.ts';
import { DEFAULT_PARAMS } from '../src/config/params.ts';
import { runNestTrial, type NestTrialResult } from '../src/sim/experiments/nest-shape.ts';

interface Job { overlays: Overlay[]; seed: number }

if (!isMainThread) {
  parentPort!.on('message', (job: Job | null) => {
    if (job === null) process.exit(0);
    const base = buildConfig(job.overlays).config;
    parentPort!.postMessage(runNestTrial(buildConfig([...job.overlays, { soil: { pit: base.experiment.nestPit }, sim: { seed: job.seed } }]).config));
  });
} else {
  const args = process.argv.slice(2);
  const name = args[0] && !args[0].startsWith('--') ? args.shift()! : 'nest';
  const overlays: Overlay[] = [JSON.parse(readFileSync('config/presets/field.json', 'utf8')) as Overlay];
  for (let i = 0; i < args.length; i++) if (args[i] === '--set') {
    const [path, raw] = args[++i]!.split('=') as [string, string];
    overlays.push(overlayFromAssignment(DEFAULT_PARAMS, path, raw));
  }
  const { config } = buildConfig(overlays);
  const ex = config.experiment;
  const seeds = Array.from({ length: ex.nestSeeds }, (_, k) => (ex.nestFirstSeed + k) >>> 0);
  const jobs: Job[] = seeds.map((seed) => ({ overlays, seed }));
  const threads = Math.min(jobs.length, Math.max(1, availableParallelism() - 1));
  const results: NestTrialResult[] = [];
  const t0 = performance.now();
  let next = 0;
  await Promise.all(Array.from({ length: threads }, () => new Promise<void>((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url));
    const feed = (): void => {
      if (next >= jobs.length) { w.postMessage(null); resolve(); return; }
      w.postMessage(jobs[next++]!);
    };
    w.on('message', (r: NestTrialResult) => {
      results.push(r);
      console.log(`seed ${r.seed}: ${r.volume} mm³, depth ${r.depth} mm, shaft ${r.shaftWidth.toFixed(1)} mm, flat chambers ${r.flatChambers}, upper ${(r.upperShare * 100).toFixed(0)}% (${results.length}/${jobs.length}, ${((performance.now() - t0) / 60000).toFixed(0)} min)`);
      feed();
    });
    w.on('error', reject);
    feed();
  })));
  results.sort((a, b) => a.seed - b.seed);
  const ok = results.filter((r) => r.pass).length;
  const pass = ok / results.length >= ex.passFraction;
  const header = [
    `# date: ${new Date().toISOString()} | node ${process.version} | cpu ${cpus()[0]?.model ?? '?'} | ${threads} threads | ${((performance.now() - t0) / 60000).toFixed(0)} min`,
    `# overlays: ${JSON.stringify(overlays)}`,
    `# protocol: ${seeds.length} seeds from ${ex.nestFirstSeed}; pit ${JSON.stringify(ex.nestPit)} mm; ${ex.nestDuration / 3600} h; chamber ≥ ${ex.nestChamberRatio}× the shaft's area, flat if width ≥ ${ex.nestFlatRatio}× height`,
    `# result nest shape: ${ok}/${results.length} colonies with ≥ ${ex.nestMinChambers} flat chamber(s) and > ${ex.nestUpperShare * 100}% of the volume in the upper half → ${pass ? 'PASS' : 'FAIL'}`,
  ];
  const dir = 'docs/reports/nest-shape';
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}.csv`, [...header, 'seed,volume_mm3,depth_mm,shaft_area_mm2,shaft_width_mm,flat_chambers,chambers,upper_share,pass',
    ...results.map((r) => [r.seed, r.volume, r.depth, r.shaftArea, r.shaftWidth.toFixed(2), r.flatChambers,
      r.chambers.map((c) => `${c.top}+${c.height}:${c.area}${c.flat ? 'F' : ''}`).join(' '), r.upperShare.toFixed(3), r.pass ? 1 : 0].join(','))].join('\n') + '\n');
  writeFileSync(`${dir}/${name}-areas.csv`, ['seed,depth_mm,area_mm2', ...results.flatMap((r) => r.areas.map((a, d) => `${r.seed},${d},${a}`))].join('\n') + '\n');
  console.log(header.slice(3).join('\n'));
}
