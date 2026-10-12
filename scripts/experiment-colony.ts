/**
 * Phase 6 acceptance experiments (ENG-EXP-004), experiment.colonySeeds
 * colonies each, seeds from experiment.colonyFirstSeed (never used while
 * developing the model). Criteria:
 *   1. removal      half the foragers removed: the forager count is back to
 *                   ≥ recoveredShare of its level within removalRecovery, in
 *                   ≥ passFraction of the colonies;
 *   2. polyethism   median forager age > median nurse age, in ≥ passFraction;
 *   3. economy      over economyDuration, colony food rises with food at the
 *                   feeders and falls without, and larvae grow more with
 *                   food, in ≥ passFraction of the seed pairs;
 *   4. recruitment  a hungry colony takes in ≥ recruitRatio × more food in
 *                   recruitDuration with trail pheromone than without (means).
 *
 *   node scripts/experiment-colony.ts [name] [--only removal,economy,recruit] [--set path=value ...]
 *
 * Writes docs/reports/phase-6/<name>-*.csv.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { buildConfig, overlayFromAssignment, type Overlay } from '../src/config/load.ts';
import { DEFAULT_PARAMS } from '../src/config/params.ts';
import {
  runEconomyTrial, runRecruitTrial, runRemovalTrial, type EconomyResult, type RecruitResult, type RemovalResult,
} from '../src/sim/experiments/colony.ts';

type Kind = 'removal' | 'economy' | 'recruit';
interface Job { kind: Kind; overlays: Overlay[]; seed: number; variant: boolean }
type Result = { kind: 'removal'; r: RemovalResult } | { kind: 'economy'; r: EconomyResult } | { kind: 'recruit'; r: RecruitResult };

if (!isMainThread) {
  parentPort!.on('message', (job: Job | null) => {
    if (job === null) process.exit(0);
    const base = [...job.overlays, { sim: { seed: job.seed } }];
    if (job.kind === 'removal') {
      parentPort!.postMessage({ kind: 'removal', r: runRemovalTrial(buildConfig(base).config, job.variant) });
    } else if (job.kind === 'economy') {
      const extra: Overlay = job.variant ? {} : { scenario: { feeders: [] } };
      parentPort!.postMessage({ kind: 'economy', r: runEconomyTrial(buildConfig([...base, extra]).config) });
    } else {
      const fill = buildConfig(base).config.experiment.recruitFill;
      const extra: Overlay = { colony: { initialFill: [0.8, fill] }, ...(job.variant ? {} : { pheromone: { depositReturn: 0, depositSearch: 0 } }) };
      parentPort!.postMessage({ kind: 'recruit', r: runRecruitTrial(buildConfig([...base, extra]).config) });
    }
  });
} else {
  const args = process.argv.slice(2);
  const name = args[0] && !args[0].startsWith('--') ? args.shift()! : 'colony';
  const overlays: Overlay[] = [JSON.parse(readFileSync('config/presets/colony.json', 'utf8')) as Overlay];
  let only: Kind[] = ['removal', 'economy', 'recruit'];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--set') {
      const [path, raw] = args[++i]!.split('=') as [string, string];
      overlays.push(overlayFromAssignment(DEFAULT_PARAMS, path, raw));
    } else if (args[i] === '--only') only = args[++i]!.split(',') as Kind[];
  }
  const { config } = buildConfig(overlays);
  const ex = config.experiment;
  const seeds = Array.from({ length: ex.colonySeeds }, (_, k) => (ex.colonyFirstSeed + k) >>> 0);
  const jobs: Job[] = [];
  // Longest first.
  if (only.includes('economy')) for (const seed of seeds) for (const variant of [true, false]) jobs.push({ kind: 'economy', overlays, seed, variant });
  if (only.includes('removal')) for (const seed of seeds) for (const variant of [true, false]) jobs.push({ kind: 'removal', overlays, seed, variant });
  if (only.includes('recruit')) for (const seed of seeds) for (const variant of [true, false]) jobs.push({ kind: 'recruit', overlays, seed, variant });
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
    w.on('message', (m: Result) => {
      results.push(m);
      const tag = `${results.length}/${jobs.length} ${((performance.now() - t0) / 60000).toFixed(0)} min`;
      if (m.kind === 'removal') console.log(`${m.r.removal ? 'removal' : 'control'} seed ${m.r.seed}: foragers ${m.r.before.toFixed(1)} → ${m.r.after.toFixed(1)} (removed ${m.r.removed}), ages forager ${m.r.foragerAge.toFixed(0)} d / nurse ${m.r.nurseAge.toFixed(0)} d (${tag})`);
      else if (m.kind === 'economy') console.log(`economy seed ${m.r.seed} ${m.r.food ? 'food' : 'none'}: ${m.r.start.toFixed(1)} → ${m.r.end.toFixed(1)} mg, larvae +${m.r.larvalGrowth.toFixed(2)} mg, intake ${m.r.intake.toFixed(1)} mg (${tag})`);
      else console.log(`recruit seed ${m.r.seed} ${m.r.trails ? 'trails' : 'none'}: intake ${m.r.intake.toFixed(2)} mg, recruits ${m.r.recruitsFound}/${m.r.recruits} (${tag})`);
      feed();
    });
    w.on('error', reject);
    feed();
  })));
  const pass = (k: number, n: number): boolean => n > 0 && k / n >= ex.passFraction;
  const header = [
    `# date: ${new Date().toISOString()} | node ${process.version} | cpu ${cpus()[0]?.model ?? '?'} | ${threads} threads | ${((performance.now() - t0) / 60000).toFixed(0)} min`,
    `# overlays: ${JSON.stringify(overlays)}`,
    `# protocol: ${seeds.length} seeds from ${ex.colonyFirstSeed}; removal: warm-up ${ex.removalWarmup / 3600} h, window ${ex.removalWindow / 3600} h, recovery ${ex.removalRecovery / 3600} h; economy ${ex.economyDuration / 3600} h; recruitment ${ex.recruitDuration / 3600} h from crop fill ${ex.recruitFill}`,
  ];
  const dir = 'docs/reports/phase-6';
  mkdirSync(dir, { recursive: true });
  const rem = results.filter((m): m is Extract<Result, { kind: 'removal' }> => m.kind === 'removal').map((m) => m.r).sort((a, b) => a.seed - b.seed || Number(b.removal) - Number(a.removal));
  if (rem.length) {
    let rec = 0, pairs = 0;
    const ratio = new Map<number, number>();
    for (const seed of seeds) {
      const r = rem.find((x) => x.seed === seed && x.removal), c = rem.find((x) => x.seed === seed && !x.removal);
      if (!r || !c) continue;
      pairs++;
      ratio.set(seed, r.after / c.after);
      if (r.after >= ex.recoveredShare * c.after) rec++;
    }
    const ctl = rem.filter((r) => !r.removal);
    const old = ctl.filter((r) => r.foragerAge > r.nurseAge).length;
    header.push(`# result removal: ${rec}/${pairs} colonies with ≥ ${ex.recoveredShare * 100}% of the control's foragers ${ex.removalRecovery / 3600} h after the removal → ${pass(rec, pairs) ? 'PASS' : 'FAIL'}`);
    header.push(`# result polyethism: ${old}/${ctl.length} colonies with foragers older than nurses (median ages) → ${pass(old, ctl.length) ? 'PASS' : 'FAIL'}`);
    writeFileSync(`${dir}/${name}-removal.csv`, [...header, 'seed,removal,foragers_before,foragers_after,removed,after_vs_control,forager_age_d,nurse_age_d,nurses',
      ...rem.map((r) => [r.seed, r.removal ? 1 : 0, r.before.toFixed(2), r.after.toFixed(2), r.removed, r.removal ? (ratio.get(r.seed) ?? NaN).toFixed(3) : '', r.foragerAge.toFixed(1), r.nurseAge.toFixed(1), r.nurses.toFixed(1)].join(','))].join('\n') + '\n');
    writeFileSync(`${dir}/${name}-removal-series.csv`, ['seed,removal,t_min,foragers,nurses',
      ...rem.flatMap((r) => r.foragers.map((f, i) => `${r.seed},${r.removal ? 1 : 0},${i + 1},${f},${r.nursesSeries[i]}`))].join('\n') + '\n');
  }
  const eco = results.filter((m): m is Extract<Result, { kind: 'economy' }> => m.kind === 'economy').map((m) => m.r).sort((a, b) => a.seed - b.seed || Number(b.food) - Number(a.food));
  if (eco.length) {
    let ok = 0, pairs = 0;
    for (const seed of seeds) {
      const f = eco.find((r) => r.seed === seed && r.food), n = eco.find((r) => r.seed === seed && !r.food);
      if (!f || !n) continue;
      pairs++;
      if (f.end > f.start && n.end < n.start && f.larvalGrowth > n.larvalGrowth) ok++;
    }
    header.push(`# result economy: ${ok}/${pairs} seed pairs (food rises with food, falls without; larvae grow more with food) → ${pass(ok, pairs) ? 'PASS' : 'FAIL'}`);
    writeFileSync(`${dir}/${name}-economy.csv`, [...header, 'seed,food,start_mg,end_mg,larval_growth_mg,intake_mg,workers_end',
      ...eco.map((r) => [r.seed, r.food ? 1 : 0, r.start.toFixed(3), r.end.toFixed(3), r.larvalGrowth.toFixed(3), r.intake.toFixed(2), r.workers].join(','))].join('\n') + '\n');
    writeFileSync(`${dir}/${name}-economy-series.csv`, ['seed,food,t_h,colony_food_mg',
      ...eco.flatMap((r) => r.series.map((f, i) => `${r.seed},${r.food ? 1 : 0},${i},${f.toFixed(3)}`))].join('\n') + '\n');
  }
  const rcr = results.filter((m): m is Extract<Result, { kind: 'recruit' }> => m.kind === 'recruit').map((m) => m.r).sort((a, b) => a.seed - b.seed || Number(b.trails) - Number(a.trails));
  if (rcr.length) {
    const mean = (xs: number[]): number => xs.reduce((p, x) => p + x, 0) / Math.max(1, xs.length);
    const withT = mean(rcr.filter((r) => r.trails).map((r) => r.intake)), without = mean(rcr.filter((r) => !r.trails).map((r) => r.intake));
    const ratio = withT / without;
    header.push(`# result recruitment: intake ${withT.toFixed(2)} mg with trails vs ${without.toFixed(2)} mg without (× ${ratio.toFixed(2)}) → ${ratio >= ex.recruitRatio ? 'PASS' : 'FAIL'}`);
    const share = (t: boolean): number => {
      const rs = rcr.filter((r) => r.trails === t);
      return rs.reduce((p, r) => p + r.recruitsFound, 0) / Math.max(1, rs.reduce((p, r) => p + r.recruits, 0));
    };
    header.push(`# info recruits: naive workers reaching food within ${ex.recruitTime} s: ${(share(true) * 100).toFixed(1)}% with trails vs ${(share(false) * 100).toFixed(1)}% without (× ${(share(true) / share(false)).toFixed(2)})`);
    writeFileSync(`${dir}/${name}-recruit.csv`, [...header, 'seed,trails,intake_mg,recruits,recruits_found,intake_by_10min',
      ...rcr.map((r) => [r.seed, r.trails ? 1 : 0, r.intake.toFixed(3), r.recruits, r.recruitsFound, r.intakeSeries.map((x) => x.toFixed(2)).join(' ')].join(','))].join('\n') + '\n');
  }
  console.log(header.slice(3).join('\n'));
}
