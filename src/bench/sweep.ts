/**
 * Render + sim performance sweep over agent counts (?bench=1).
 *
 * For each count: rebuild the world, wait for the snapshot to reflect it,
 * warm up, then sample per-frame timings. Results are shown, exposed as
 * `window.__antverseBench`, and (on the dev server) saved as CSV under
 * docs/reports/bench/.
 *
 * Note: frame interval is capped by display vsync, so headroom is judged
 * from main-thread CPU ms and GPU ms (timestamp queries), not FPS alone.
 */

import type { Config } from '../config/params.ts';
import { RollingStats } from '../core/rolling-stats.ts';
import { MS_PER_S } from '../core/units.ts';

export interface BenchRow {
  count: number;
  fps: number;
  frameP50: number;
  frameP95: number;
  cpuMs: number;
  gpuMs: number | null;
  simMsPerTick: number;
  achievedSpeed: number;
}

export interface BenchHost {
  reset(count: number): void;
  aliveInSnapshot(): number;
  simMsPerTick(): number;
  achievedSpeed(): number;
}

type Phase = 'reset' | 'warmup' | 'sample' | 'done';
const SAMPLE_CAPACITY = 100000;

export class BenchSweep {
  readonly rows: BenchRow[] = [];
  private idx = 0;
  private phase: Phase = 'reset';
  private phaseStart = 0;
  private readonly frames = new RollingStats(SAMPLE_CAPACITY);
  private readonly cpu = new RollingStats(SAMPLE_CAPACITY);
  private readonly gpu = new RollingStats(SAMPLE_CAPACITY);
  private simMs = new RollingStats(SAMPLE_CAPACITY);
  private speed = new RollingStats(SAMPLE_CAPACITY);
  private requested = false;
  private readonly cfg: Config;
  private readonly host: BenchHost;
  private readonly onDone: (rows: BenchRow[]) => void;

  constructor(cfg: Config, host: BenchHost, onDone: (rows: BenchRow[]) => void) {
    this.cfg = cfg;
    this.host = host;
    this.onDone = onDone;
  }

  get done(): boolean {
    return this.phase === 'done';
  }

  status(): string {
    const counts = this.cfg.bench.counts;
    if (this.done) return 'bench done';
    return `bench ${this.idx + 1}/${counts.length}: ${counts[this.idx]} agents — ${this.phase}`;
  }

  onFrame(now: number, frameMs: number, cpuMs: number, gpuMs: number | null): void {
    if (this.done) return;
    const counts = this.cfg.bench.counts;
    const count = counts[this.idx]!;
    switch (this.phase) {
      case 'reset':
        if (!this.requested) { this.host.reset(count); this.requested = true; }
        if (this.host.aliveInSnapshot() === count) { this.phase = 'warmup'; this.phaseStart = now; }
        break;
      case 'warmup':
        if (now - this.phaseStart >= this.cfg.bench.warmup * MS_PER_S) {
          this.phase = 'sample';
          this.phaseStart = now;
          for (const r of [this.frames, this.cpu, this.gpu, this.simMs, this.speed]) r.reset();
        }
        break;
      case 'sample':
        this.frames.push(frameMs);
        this.cpu.push(cpuMs);
        if (gpuMs !== null) this.gpu.push(gpuMs);
        this.simMs.push(this.host.simMsPerTick());
        this.speed.push(this.host.achievedSpeed());
        if (now - this.phaseStart >= this.cfg.bench.sample * MS_PER_S) {
          this.rows.push({
            count,
            fps: MS_PER_S / this.frames.mean(),
            frameP50: this.frames.percentile(0.5),
            frameP95: this.frames.percentile(0.95),
            cpuMs: this.cpu.mean(),
            gpuMs: this.gpu.count > 0 ? this.gpu.mean() : null,
            simMsPerTick: this.simMs.mean(),
            achievedSpeed: this.speed.mean(),
          });
          this.idx++;
          this.requested = false;
          this.phase = this.idx >= counts.length ? 'done' : 'reset';
          if (this.done) this.onDone(this.rows);
        }
        break;
      case 'done':
        break;
    }
  }
}

export function benchCsv(rows: readonly BenchRow[], meta: Record<string, string>): string {
  const head = Object.entries(meta).map(([k, v]) => `# ${k}: ${v}`);
  const cols = ['count', 'fps', 'frame_p50_ms', 'frame_p95_ms', 'main_cpu_ms', 'gpu_ms', 'sim_ms_per_tick', 'achieved_speed'];
  const body = rows.map((r) => [
    r.count, r.fps.toFixed(2), r.frameP50.toFixed(3), r.frameP95.toFixed(3), r.cpuMs.toFixed(3),
    r.gpuMs === null ? '' : r.gpuMs.toFixed(3), r.simMsPerTick.toFixed(4), r.achievedSpeed.toFixed(3),
  ].join(','));
  return [...head, cols.join(','), ...body].join('\n') + '\n';
}
