/**
 * Automatic quality reduction for hosted and mobile tiers: keep the frame
 * rate above a floor on slow machines by lowering the knob that relieves the
 * bottleneck first — terrain detail (fewer chunks, less main-thread work)
 * when the CPU is the limit, render resolution (fewer pixels) when the GPU is
 * or when GPU time is unknown — then the other one. Quality is restored when
 * there is clear headroom, never above the tier's own settings.
 * Pure logic — the app applies the returned knobs to the renderer.
 */

export interface QualityKnobs {
  pixelRatio: number;
  maxScreenError: number;
}

export interface GovernorParams {
  /** Frame interval above which quality is reduced (ms). */
  targetFrameMs: number;
  /** Seconds of frames averaged per decision. */
  window: number;
  minPixelRatio: number;
  maxScreenErrorCeil: number;
  /** Multiplicative step (< 1) applied to pixel ratio; its inverse to screen error. */
  step: number;
  /** Restore quality only if frame work < headroom × target. */
  upgradeHeadroom: number;
  /** Consecutive calm windows required before restoring a step. */
  upgradeWindows: number;
}

export type GovernorAction = 'down' | 'up' | null;

const MS_PER_S = 1000;
const EPS = 1e-6;

export class QualityGovernor {
  readonly knobs: QualityKnobs;
  private readonly base: QualityKnobs;
  private readonly p: GovernorParams;
  private start: number | null = null;
  private frames = 0;
  private frameSum = 0;
  private cpuSum = 0;
  private gpuSum = 0;
  private gpuFrames = 0;
  private calm = 0;

  constructor(base: QualityKnobs, p: GovernorParams) {
    this.base = { ...base };
    this.knobs = { ...base };
    this.p = p;
  }

  /** Feed one frame: wall interval, main-thread CPU time and GPU time (null if unknown), in ms. */
  sample(now: number, frameMs: number, cpuMs: number, gpuMs: number | null): GovernorAction {
    if (this.start === null) this.start = now;
    this.frames++;
    this.frameSum += frameMs;
    this.cpuSum += cpuMs;
    if (gpuMs !== null) { this.gpuSum += gpuMs; this.gpuFrames++; }
    if (now - this.start < this.p.window * MS_PER_S) return null;
    const frame = this.frameSum / this.frames, cpu = this.cpuSum / this.frames;
    const gpu = this.gpuFrames > 0 ? this.gpuSum / this.gpuFrames : null;
    const work = cpu + (gpu ?? 0);
    this.start = now; this.frames = 0; this.frameSum = 0; this.cpuSum = 0; this.gpuSum = 0; this.gpuFrames = 0;

    const k = this.knobs, p = this.p;
    if (frame > p.targetFrameMs) {
      this.calm = 0;
      const lowerDetail = (): boolean => {
        if (k.maxScreenError >= p.maxScreenErrorCeil - EPS) return false;
        k.maxScreenError = Math.min(p.maxScreenErrorCeil, k.maxScreenError / p.step);
        return true;
      };
      const lowerResolution = (): boolean => {
        if (k.pixelRatio <= p.minPixelRatio + EPS) return false;
        k.pixelRatio = Math.max(p.minPixelRatio, k.pixelRatio * p.step);
        return true;
      };
      const cpuBound = gpu !== null && gpu < cpu;
      const changed = cpuBound ? lowerDetail() || lowerResolution() : lowerResolution() || lowerDetail();
      return changed ? 'down' : null;
    }
    if (work < p.upgradeHeadroom * p.targetFrameMs && this.degraded()) {
      if (++this.calm < p.upgradeWindows) return null;
      this.calm = 0;
      if (k.maxScreenError > this.base.maxScreenError + EPS) { k.maxScreenError = Math.max(this.base.maxScreenError, k.maxScreenError * p.step); return 'up'; }
      k.pixelRatio = Math.min(this.base.pixelRatio, k.pixelRatio / p.step);
      return 'up';
    }
    this.calm = 0;
    return null;
  }

  degraded(): boolean {
    return this.knobs.pixelRatio < this.base.pixelRatio - EPS || this.knobs.maxScreenError > this.base.maxScreenError + EPS;
  }
}
