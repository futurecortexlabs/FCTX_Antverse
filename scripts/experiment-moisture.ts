/**
 * Soil-moisture acceptance (ENG-EXP-007): experiment.moistSeeds colonies in
 * the field scenario from a pit of experiment.nestPit, seeds from
 * experiment.moistFirstSeed (never used while developing). Criteria:
 *   1. dry   digging over moistDuration with env.deepMoisture = moistDry is at
 *            least moistDryShare smaller than in the default soil, in
 *            ≥ passFraction of the seed pairs;
 *   2. rain  over moistRainWindow after the shower moistRain ends, the colony
 *            digs more than the same colony without it, in ≥ passFraction.
 *
 *   node scripts/experiment-moisture.ts [name] [--set path=value ...]
 *
 * Writes docs/reports/moisture/<name>-dig.csv.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { buildConfig, overlayFromAssignment, type Overlay } from '../src/config/load.ts';
import { DEFAULT_PARAMS } from '../src/config/params.ts';
import { runMoistDigTrial, type DigSeries } from '../src/sim/experiments/moisture.ts';

type Variant = 'moist' | 'dry' | 'rain';
interface Job { overlays: Overlay[]; seed: number; variant: Variant }
interface Result extends DigSeries { variant: Variant }

const S_PER_H = 3600;

if (!isMainThread) {
  parentPort!.on('message', (job: Job | null) => {
    if (job === null) process.exit(0);
    const ex = buildConfig(job.overlays).config.experiment;
    const extra: Overlay = job.variant === 'dry' ? { env: { deepMoisture: ex.moistDry } } : job.variant === 'rain' ? { env: { rain: ex.moistRain } } : {};
    const rain = ex.moistRain as readonly number[];
    const hours = job.variant === 'dry' ? ex.moistDuration / S_PER_H : Math.max(ex.moistDuration / S_PER_H, rain[0]! + rain[1]! + ex.moistRainWindow / S_PER_H);
    const r = runMoistDigTrial(buildConfig([...job.overlays, { soil: { pit: ex.nestPit }, sim: { seed: job.seed } }, extra]).config, Math.round(hours));
    parentPort!.postMessage({ ...r, variant: job.variant });
  });
} else {
  const args = process.argv.slice(2);
  const name = args[0] && !args[0].startsWith('--') ? args.shift()! : 'moisture';
  const overlays: Overlay[] = [JSON.parse(readFileSync('config/presets/field.json', 'utf8')) as Overlay];
  for (let i = 0; i < args.length; i++) if (args[i] === '--set') {
    const [path, raw] = args[++i]!.split('=') as [string, string];
    overlays.push(overlayFromAssignment(DEFAULT_PARAMS, path, raw));
  }
  const { config } = buildConfig(overlays);
  const ex = config.experiment;
  const seeds = Array.from({ length: ex.moistSeeds }, (_, k) => (ex.moistFirstSeed + k) >>> 0);
  const jobs: Job[] = seeds.flatMap((seed) => (['rain', 'moist', 'dry'] as Variant[]).map((variant) => ({ overlays, seed, variant })));
  const threads = Math.min(jobs.length, Math.max(1, availableParallelism() - 1));
  const results: Result[] = [];
  const t0 = performance.now();
  let next = 0;
  await Promise.all(Array.from({ length: threads }, () => new Promise<void>((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url));
    const feed = (): void => {
      if (next >= jobs.length) { w.postMessage(null); resolve(); return; }
      w.postMessage(jobs[next++]!);
    };
    w.on('message', (r: Result) => {
      results.push(r);
      console.log(`${r.variant} seed ${r.seed}: ${r.hourly.reduce((a, b) => a + b, 0)} pellets (${results.length}/${jobs.length}, ${((performance.now() - t0) / 60000).toFixed(0)} min)`);
      feed();
    });
    w.on('error', reject);
    feed();
  })));
  const rain = ex.moistRain as readonly number[];
  const sum = (r: Result, from: number, to: number): number => r.hourly.slice(from, to).reduce((a, b) => a + b, 0);
  const total = ex.moistDuration / S_PER_H, after = rain[0]! + rain[1]!, window = ex.moistRainWindow / S_PER_H;
  let dryOk = 0, rainOk = 0, pairs = 0;
  const rows: string[] = [];
  for (const seed of seeds) {
    const m = results.find((r) => r.seed === seed && r.variant === 'moist');
    const d = results.find((r) => r.seed === seed && r.variant === 'dry');
    const w = results.find((r) => r.seed === seed && r.variant === 'rain');
    if (!m || !d || !w) continue;
    pairs++;
    const dm = sum(m, 0, total), dd = sum(d, 0, total), am = sum(m, after, after + window), aw = sum(w, after, after + window);
    if (dd <= (1 - ex.moistDryShare) * dm) dryOk++;
    if (aw > am) rainOk++;
    rows.push([seed, dm, dd, (1 - dd / dm).toFixed(3), am, aw, (aw / am).toFixed(3), m.hourly.join(' '), d.hourly.join(' '), w.hourly.join(' ')].join(','));
  }
  const pass = (k: number): boolean => pairs > 0 && k / pairs >= ex.passFraction;
  const header = [
    `# date: ${new Date().toISOString()} | node ${process.version} | cpu ${cpus()[0]?.model ?? '?'} | ${threads} threads | ${((performance.now() - t0) / 60000).toFixed(0)} min`,
    `# overlays: ${JSON.stringify(overlays)}`,
    `# protocol: ${seeds.length} seeds from ${ex.moistFirstSeed}; pit ${JSON.stringify(ex.nestPit)} mm; dry soil θ ${ex.moistDry} vs ${config.env.deepMoisture} over ${total} h; rain ${JSON.stringify(ex.moistRain)}, then ${window} h`,
    `# result dry: ${dryOk}/${pairs} colonies dig ≥ ${ex.moistDryShare * 100}% less in dry soil → ${pass(dryOk) ? 'PASS' : 'FAIL'}`,
    `# result rain: ${rainOk}/${pairs} colonies dig more in the ${window} h after the rain than without it → ${pass(rainOk) ? 'PASS' : 'FAIL'}`,
  ];
  const dir = 'docs/reports/moisture';
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}-dig.csv`, [...header, 'seed,moist_total,dry_total,dry_reduction,after_rain_control,after_rain_rain,rain_ratio,moist_hourly,dry_hourly,rain_hourly', ...rows].join('\n') + '\n');
  console.log(header.slice(3).join('\n'));
}
