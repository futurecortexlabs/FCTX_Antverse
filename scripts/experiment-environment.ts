/**
 * Phase 7 acceptance experiments (ENG-EXP-005), experiment.envSeeds colonies
 * in the field scenario, seeds from experiment.envFirstSeed (never used while
 * developing). Criteria:
 *   1. day/night     foragers out by day ≥ dayNightRatio × by night, in ≥ passFraction;
 *   2. brood warmth  over the second day the brood's mean distance from broodTemp is
 *                    ≥ thermoReduction smaller than in the same colony without brood
 *                    carrying, and the brood lies shallower at morningHours than at
 *                    afternoonHours, in ≥ passFraction;
 *   3. temperature   a cool day (coolTemp) brings in less food than a warm one, in ≥ passFraction;
 *   4. rain          during a shower foragers out fall to ≤ rainDuringShare of the hour
 *                    before, and recover to ≥ rainAfterShare within rainRecovery, in
 *                    ≥ passFraction; no free ant ever steps into a water drop;
 *   5. recruitment   a new distant feeder: crop fills there in newFoodWindow after it is
 *                    found ≥ recruitRatio × more with trail pheromone than without (means).
 *
 *   node scripts/experiment-environment.ts [name] [--only day,temp,rain,food] [--set path=value ...]
 *
 * Writes docs/reports/phase-7/<name>-*.csv.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { buildConfig, overlayFromAssignment, type Overlay } from '../src/config/load.ts';
import { DEFAULT_PARAMS } from '../src/config/params.ts';
import {
  runDayTrial, runNewFoodTrial, runRainTrial, runTempTrial, type DayResult, type NewFoodResult, type RainResult, type TempResult,
} from '../src/sim/experiments/environment.ts';

type Kind = 'day' | 'temp' | 'rain' | 'food';
interface Job { kind: Kind; overlays: Overlay[]; seed: number; variant: boolean }
type Result = { kind: 'day'; r: DayResult } | { kind: 'temp'; r: TempResult } | { kind: 'rain'; r: RainResult } | { kind: 'food'; r: NewFoodResult };

if (!isMainThread) {
  parentPort!.on('message', (job: Job | null) => {
    if (job === null) process.exit(0);
    const base = [...job.overlays, { sim: { seed: job.seed } }];
    const ex = buildConfig(base).config.experiment;
    if (job.kind === 'day') {
      parentPort!.postMessage({ kind: 'day', r: runDayTrial(buildConfig([...base, job.variant ? {} : { colony: { pickRate: 0 } }]).config, job.variant) });
    } else if (job.kind === 'temp') {
      parentPort!.postMessage({ kind: 'temp', r: runTempTrial(buildConfig([...base, job.variant ? {} : { env: { meanTemp: ex.coolTemp } }]).config) });
    } else if (job.kind === 'rain') {
      parentPort!.postMessage({ kind: 'rain', r: runRainTrial(buildConfig([...base, { env: { rain: ex.rainShower } }]).config) });
    } else {
      const extra: Overlay = { scenario: { lateFeeders: ex.newFood }, ...(job.variant ? {} : { pheromone: { depositReturn: 0, depositSearch: 0 } }) };
      parentPort!.postMessage({ kind: 'food', r: runNewFoodTrial(buildConfig([...base, extra]).config) });
    }
  });
} else {
  const args = process.argv.slice(2);
  const name = args[0] && !args[0].startsWith('--') ? args.shift()! : 'environment';
  const overlays: Overlay[] = [JSON.parse(readFileSync('config/presets/field.json', 'utf8')) as Overlay];
  let only: Kind[] = ['day', 'temp', 'rain', 'food'];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--set') {
      const [path, raw] = args[++i]!.split('=') as [string, string];
      overlays.push(overlayFromAssignment(DEFAULT_PARAMS, path, raw));
    } else if (args[i] === '--only') only = args[++i]!.split(',') as Kind[];
  }
  const { config } = buildConfig(overlays);
  const ex = config.experiment;
  const seeds = Array.from({ length: ex.envSeeds }, (_, k) => (ex.envFirstSeed + k) >>> 0);
  const jobs: Job[] = [];
  for (const kind of ['day', 'food', 'temp', 'rain'] as Kind[]) {
    if (!only.includes(kind)) continue;
    for (const seed of seeds) for (const variant of kind === 'rain' ? [true] : [true, false]) jobs.push({ kind, overlays, seed, variant });
  }
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
      if (m.kind === 'day') console.log(`day seed ${m.r.seed} ${m.r.carry ? 'carry' : 'still'}: out by day ${m.r.day.toFixed(2)} / night ${m.r.night.toFixed(2)}, brood off ${m.r.off.toFixed(2)} °C, depth ${m.r.morningDepth.toFixed(0)} → ${m.r.afternoonDepth.toFixed(0)} mm (${tag})`);
      else if (m.kind === 'temp') console.log(`temp seed ${m.r.seed} ${m.r.meanTemp} °C: intake ${m.r.intake.toFixed(1)} mg, out ${m.r.out.toFixed(2)} (${tag})`);
      else if (m.kind === 'rain') console.log(`rain seed ${m.r.seed}: out ${m.r.before.toFixed(2)} → ${m.r.during.toFixed(2)} → ${m.r.after.toFixed(2)}, hits ${m.r.hits}, entered drops ${m.r.entered}, drops ${m.r.dropsAtEnd} → ${m.r.dropsLeft} (${tag})`);
      else console.log(`food seed ${m.r.seed} ${m.r.trails ? 'trails' : 'none'}: found at ${(m.r.found / 3600).toFixed(2)} h, fills ${m.r.fills}, recruits ${m.r.recruits} (${tag})`);
      feed();
    });
    w.on('error', reject);
    feed();
  })));
  const pass = (k: number, n: number): boolean => n > 0 && k / n >= ex.passFraction;
  const mean = (xs: number[]): number => xs.reduce((p, x) => p + x, 0) / Math.max(1, xs.length);
  const header = [
    `# date: ${new Date().toISOString()} | node ${process.version} | cpu ${cpus()[0]?.model ?? '?'} | ${threads} threads | ${((performance.now() - t0) / 60000).toFixed(0)} min`,
    `# overlays: ${JSON.stringify(overlays)}`,
    `# protocol: ${seeds.length} seeds from ${ex.envFirstSeed}; day ${ex.dayDuration / 3600} h (control: no brood carrying); temp ${ex.tempDuration / 3600} h at ${ex.coolTemp} °C vs default; rain ${JSON.stringify(ex.rainShower)}; new food ${JSON.stringify(ex.newFood)}, window ${ex.newFoodWindow / 3600} h`,
  ];
  const dir = 'docs/reports/phase-7';
  mkdirSync(dir, { recursive: true });
  const day = results.flatMap((m) => (m.kind === 'day' ? [m.r] : []));
  const temp = results.flatMap((m) => (m.kind === 'temp' ? [m.r] : []));
  const rain = results.flatMap((m) => (m.kind === 'rain' ? [m.r] : []));
  const food = results.flatMap((m) => (m.kind === 'food' ? [m.r] : []));
  if (day.length) {
    const carry = day.filter((r) => r.carry);
    const dn = carry.filter((r) => r.day >= ex.dayNightRatio * r.night && r.day > 0).length;
    let warm = 0, pairs = 0;
    for (const seed of seeds) {
      const c = day.find((r) => r.seed === seed && r.carry), s = day.find((r) => r.seed === seed && !r.carry);
      if (!c || !s) continue;
      pairs++;
      if (c.off <= (1 - ex.thermoReduction) * s.off && c.morningDepth < c.afternoonDepth) warm++;
    }
    header.push(`# result day/night: ${dn}/${carry.length} colonies with ≥ ${ex.dayNightRatio}× as many foragers out by day as by night → ${pass(dn, carry.length) ? 'PASS' : 'FAIL'}`);
    header.push(`# result brood warmth: ${warm}/${pairs} colonies whose brood is ≥ ${ex.thermoReduction * 100}% closer to ${config.colony.broodTemp} °C than without carrying and shallower in the morning than the afternoon → ${pass(warm, pairs) ? 'PASS' : 'FAIL'}`);
    writeFileSync(`${dir}/${name}-day.csv`, [...header, 'seed,carry,out_day,out_night,brood_off_C,depth_morning_mm,depth_afternoon_mm',
      ...day.sort((a, b) => a.seed - b.seed || Number(b.carry) - Number(a.carry)).map((r) => [r.seed, r.carry ? 1 : 0, r.day.toFixed(3), r.night.toFixed(3), r.off.toFixed(3), r.morningDepth.toFixed(1), r.afternoonDepth.toFixed(1)].join(','))].join('\n') + '\n');
    writeFileSync(`${dir}/${name}-day-series.csv`, ['seed,carry,hour,out,brood_depth_mm,brood_off_C,light',
      ...day.flatMap((r) => r.hourly.map((h, i) => `${r.seed},${r.carry ? 1 : 0},${i},${h.map((x) => x.toFixed(3)).join(',')}`))].join('\n') + '\n');
  }
  if (temp.length) {
    let less = 0, pairs = 0;
    for (const seed of seeds) {
      const warm = temp.find((r) => r.seed === seed && r.meanTemp !== ex.coolTemp), cool = temp.find((r) => r.seed === seed && r.meanTemp === ex.coolTemp);
      if (!warm || !cool) continue;
      pairs++;
      if (cool.intake < warm.intake) less++;
    }
    header.push(`# result temperature: ${less}/${pairs} colonies bringing in less food on a ${ex.coolTemp} °C day → ${pass(less, pairs) ? 'PASS' : 'FAIL'}`);
    writeFileSync(`${dir}/${name}-temp.csv`, [...header, 'seed,mean_temp_C,intake_mg,out_mean',
      ...temp.sort((a, b) => a.seed - b.seed || b.meanTemp - a.meanTemp).map((r) => [r.seed, r.meanTemp, r.intake.toFixed(2), r.out.toFixed(3)].join(','))].join('\n') + '\n');
  }
  if (rain.length) {
    const ok = rain.filter((r) => r.during <= ex.rainDuringShare * r.before && r.after >= ex.rainAfterShare * r.before && r.before > 0).length;
    const dry = rain.every((r) => r.entered === 0);
    header.push(`# result rain: ${ok}/${rain.length} colonies down to ≤ ${ex.rainDuringShare * 100}% in the rain and back to ≥ ${ex.rainAfterShare * 100}% after → ${pass(ok, rain.length) ? 'PASS' : 'FAIL'}; steps into drops: ${rain.reduce((p, r) => p + r.entered, 0)} → ${dry ? 'PASS' : 'FAIL'}`);
    writeFileSync(`${dir}/${name}-rain.csv`, [...header, 'seed,out_before,out_during,out_after,hits,entered_drops,drops_at_end_of_rain,drops_left',
      ...rain.sort((a, b) => a.seed - b.seed).map((r) => [r.seed, r.before.toFixed(3), r.during.toFixed(3), r.after.toFixed(3), r.hits, r.entered, r.dropsAtEnd, r.dropsLeft].join(','))].join('\n') + '\n');
    writeFileSync(`${dir}/${name}-rain-series.csv`, ['seed,minute,out', ...rain.flatMap((r) => r.series.map((f, i) => `${r.seed},${i + 1},${f}`))].join('\n') + '\n');
  }
  if (food.length) {
    const withT = mean(food.filter((r) => r.trails && r.found >= 0).map((r) => r.fills)), without = mean(food.filter((r) => !r.trails && r.found >= 0).map((r) => r.fills));
    const found = food.filter((r) => r.found >= 0).length;
    const ratio = withT / without;
    header.push(`# result recruitment: fills at the new feeder in ${ex.newFoodWindow / 3600} h after its discovery ${withT.toFixed(1)} with trails vs ${without.toFixed(1)} without (× ${ratio.toFixed(2)}; found in ${found}/${food.length} runs) → ${ratio >= ex.recruitRatio ? 'PASS' : 'FAIL'}`);
    writeFileSync(`${dir}/${name}-food.csv`, [...header, 'seed,trails,found_h,fills,recruits',
      ...food.sort((a, b) => a.seed - b.seed || Number(b.trails) - Number(a.trails)).map((r) => [r.seed, r.trails ? 1 : 0, (r.found / 3600).toFixed(3), r.fills, r.recruits].join(','))].join('\n') + '\n');
  }
  console.log(header.slice(3).join('\n'));
}
