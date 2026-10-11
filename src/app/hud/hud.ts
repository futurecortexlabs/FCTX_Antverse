/**
 * Heads-up display: performance numbers, simulation status, and the time
 * controls (pause / single step / speed presets / MAX fast-forward).
 *
 * Keyboard: Space = pause/resume, "." = single step (while paused),
 * "[" / "]" = slower / faster, "M" = MAX.
 */

import type { Config } from '../../config/params.ts';
import type { RendererInfo } from '../../render/renderer.ts';
import type { DeterminismReport, SimStats, Transport } from '../../worker/protocol.ts';

export interface PerfSnapshot {
  fps: number;
  frameP50: number;
  frameP95: number;
  cpuMs: number;
  gpuMs: number | null;
  visible: number;
}

export interface HudActions {
  setSpeed(scale: number): void;
  setPaused(paused: boolean): void;
  /** Source of truth for the pause state (the app may pause on its own, e.g. when hidden). */
  isPaused(): boolean;
  step(): void;
  determinismCheck(): void;
  screenshot?: () => void;
}

const fmt = (x: number, digits = 1): string => (Number.isFinite(x) ? x.toFixed(digits) : '–');

export class Hud {
  readonly root: HTMLDivElement;
  private readonly statsEl: HTMLPreElement;
  private readonly noteEl: HTMLDivElement;
  private readonly speedButtons = new Map<number, HTMLButtonElement>();
  private readonly pauseBtn: HTMLButtonElement;
  private readonly collapseBtn: HTMLButtonElement;
  private readonly summaryEl: HTMLSpanElement;
  private readonly speeds: readonly number[];
  private speedIndex: number;
  private speed: number;
  private collapsed: boolean;
  private readonly cfg: Config;
  private readonly tier: string;
  private readonly actions: HudActions;

  constructor(cfg: Config, tier: string, actions: HudActions) {
    this.cfg = cfg;
    this.tier = tier;
    this.actions = actions;
    this.speeds = [...cfg.time.speeds, cfg.time.maxSpeed];
    this.speed = cfg.time.initialSpeed;
    this.speedIndex = Math.max(0, this.speeds.indexOf(this.speed));

    this.collapsed = cfg.ui.hudCollapsed;
    this.root = document.createElement('div');
    this.root.className = 'hud';

    const head = document.createElement('div');
    head.className = 'hud-head';
    this.collapseBtn = this.button(head, '', 'Show / hide details', () => this.setCollapsed(!this.collapsed));
    this.summaryEl = document.createElement('span');
    this.summaryEl.className = 'hud-summary';
    head.appendChild(this.summaryEl);
    this.root.appendChild(head);

    this.statsEl = document.createElement('pre');
    this.statsEl.className = 'hud-detail';
    this.root.appendChild(this.statsEl);

    const bar = document.createElement('div');
    bar.className = 'hud-controls';
    this.pauseBtn = this.button(bar, '⏸', 'Pause / resume (Space)', () => this.togglePause());
    this.button(bar, '⏭', 'Single step while paused (.)', () => this.actions.step());
    for (const s of this.speeds) {
      const label = s === cfg.time.maxSpeed ? 'MAX' : `×${s}`;
      const b = this.button(bar, label, s === cfg.time.maxSpeed ? 'As fast as the CPU allows (M)' : `Sim speed ×${s}`, () => this.setSpeed(s));
      this.speedButtons.set(s, b);
    }
    this.root.appendChild(bar);

    const tools = document.createElement('div');
    tools.className = 'hud-controls hud-detail';
    this.button(tools, 'Determinism check', 'Run the configured tick count twice + other seed, and compare the live world with a headless replay', () => this.actions.determinismCheck());
    if (actions.screenshot) this.button(tools, '📷', 'Save screenshot to docs/reports (dev server only)', actions.screenshot);
    this.root.appendChild(tools);

    this.noteEl = document.createElement('div');
    this.noteEl.className = 'hud-note';
    this.root.appendChild(this.noteEl);

    document.body.appendChild(this.root);
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.setCollapsed(this.collapsed);
  }

  private setCollapsed(c: boolean): void {
    this.collapsed = c;
    this.root.classList.toggle('collapsed', c);
    this.collapseBtn.textContent = c ? '≡' : '×';
    this.refreshButtons();
  }

  private button(parent: HTMLElement, label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') { e.preventDefault(); this.togglePause(); }
    else if (e.key === '.') this.actions.step();
    else if (e.key === ']') this.setSpeed(this.speeds[Math.min(this.speeds.length - 1, this.speedIndex + 1)]!);
    else if (e.key === '[') this.setSpeed(this.speeds[Math.max(0, this.speedIndex - 1)]!);
    else if (e.key === 'm' || e.key === 'M') this.setSpeed(this.cfg.time.maxSpeed);
  }

  private togglePause(): void {
    this.actions.setPaused(!this.actions.isPaused());
    this.refreshButtons();
  }

  private setSpeed(s: number): void {
    this.speed = s;
    this.speedIndex = this.speeds.indexOf(s);
    if (this.actions.isPaused()) this.actions.setPaused(false);
    this.actions.setSpeed(s);
    this.refreshButtons();
  }

  private refreshButtons(): void {
    this.pauseBtn.textContent = this.actions.isPaused() ? '▶' : '⏸';
    for (const [s, b] of this.speedButtons) b.classList.toggle('active', s === this.speed);
  }

  note(html: string): void {
    this.noteEl.innerHTML = html;
  }

  showDeterminism(r: DeterminismReport): void {
    const ok = (b: boolean): string => (b ? '<b class="ok">OK</b>' : '<b class="ng">NG</b>');
    this.note(
      `Determinism (${r.ticks} ticks, ${fmt(r.ms, 0)} ms)<br>` +
      `same seed: ${r.hashA} / ${r.hashB} ${ok(r.identical)}<br>` +
      `seed+1: ${r.hashOtherSeed} ${ok(r.seedSensitive)} (must differ)<br>` +
      `live @${r.liveTick}: ${r.liveHash} vs headless ${r.liveHeadlessHash} ${ok(r.liveMatchesHeadless)}`,
    );
  }

  render(perf: PerfSnapshot, sim: SimStats | null, info: RendererInfo, transport: Transport, extra: readonly string[] = []): void {
    const speedLabel = (s: number): string => (s >= this.cfg.time.maxSpeed ? 'MAX' : `×${s}`);
    const lines = [
      `Antverse — Phase 4`,
      `${info.backend} | depth ${info.depth} | ${transport === 'shared' ? 'SharedArrayBuffer' : 'copy transfer'} | ${this.tier}`,
      `GPU ${info.adapter}`,
      `FPS ${fmt(perf.fps)} | frame p50 ${fmt(perf.frameP50, 2)} / p95 ${fmt(perf.frameP95, 2)} ms`,
      `main CPU ${fmt(perf.cpuMs, 2)} ms | GPU ${perf.gpuMs === null ? 'n/a' : fmt(perf.gpuMs, 2) + ' ms'} | drawn ${perf.visible}`,
    ];
    if (sim) {
      lines.push(
        `sim tick ${sim.tick} | t = ${fmt(sim.simTime, 2)} s | agents ${sim.alive}`,
        `speed ${sim.paused ? 'PAUSED' : speedLabel(sim.targetSpeed)} → achieved ×${fmt(sim.achievedSpeed, 2)} | ${fmt(sim.ticksPerSec, 0)} tick/s | ${fmt(sim.msPerTick, 3)} ms/tick | ${sim.threads} thread${sim.threads > 1 ? 's' : ''}`,
      );
    }
    lines.push(...extra);
    lines.push(`seed ${this.cfg.sim.seed} | 1 unit = 1 mm | scale bar ${this.cfg.render.scaleBarLength} mm`);
    this.statsEl.textContent = lines.join('\n');
    const speed = sim ? (sim.paused ? 'PAUSED' : `${speedLabel(sim.targetSpeed)} (×${fmt(sim.achievedSpeed, 2)})`) : '';
    this.summaryEl.textContent = `Antverse · FPS ${fmt(perf.fps, 0)} · ${speed} · ${sim?.alive ?? 0} ants`;
    this.refreshButtons();
  }
}
