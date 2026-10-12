/**
 * Drives a World from wall-clock time: fixed steps, time scaling, a per-
 * iteration time budget, snapshot publishing and statistics. Free of worker
 * APIs (time source and snapshot sink are injected) so it runs in Node tests.
 */

import { FixedStepClock } from '../core/clock.ts';
import { isSharedBuffer } from '../core/soa.ts';
import { MS_PER_S } from '../core/units.ts';
import type { Config } from '../config/params.ts';
import { AgentFlag, AgentState, Caste, CarryKind } from '../sim/agents/store.ts';
import { BroodStage } from '../sim/colony/brood.ts';
import { World } from '../sim/world.ts';
import { BROOD_FLOATS, type FieldInfo, type NestInfo, type SimStats, type SnapshotView, type SoilChunk } from './protocol.ts';
import { writeSnapshot } from './snapshot-writer.ts';

export interface SnapshotSink {
  /** Snapshot to write into now. */
  target(): SnapshotView;
  /** Make the written snapshot visible to the reader. */
  commit(): void;
}

/** Optional multi-threaded stepping (parallel.ts); results are identical to world.step(). */
export interface Stepper {
  attach(world: World): void;
  step(world: World): void;
  /** Threads stepping when active. */
  readonly threads: number;
  /** True once helpers are attached (otherwise steps run single-threaded). */
  readonly active: boolean;
  /** Threads that stepped the last tick. */
  readonly lastThreads: number;
}

export class SimRunner {
  world: World;
  clock: FixedStepClock;
  private config: Config;
  private seq = 0;
  private lastNow: number | null = null;
  private dirty = true;
  // stats window
  private statStart: number;
  private statSteps = 0;
  private statStepMs = 0;
  private statSimStart = 0;
  private dropped = 0;

  private readonly sink: SnapshotSink | null;
  private readonly now: () => number;
  private readonly stepper: Stepper | null;

  constructor(config: Config, sink: SnapshotSink | null, now: () => number, stepper: Stepper | null = null) {
    this.sink = sink;
    this.now = now;
    this.stepper = stepper;
    this.config = config;
    this.world = this.makeWorld(config);
    this.clock = new FixedStepClock(config.sim.dt);
    this.clock.timeScale = config.time.initialSpeed;
    this.statStart = now();
  }

  private makeWorld(config: Config): World {
    const world = new World(config, { sharedAgents: this.stepper !== null, sharedField: globalThis.crossOriginIsolated === true });
    this.stepper?.attach(world);
    return world;
  }

  private diggingCounts(): { dug: number; pellets: number; underground: number } {
    const w = this.world, a = w.agents.a;
    let underground = 0;
    for (let s = 0; s < w.agents.highWater; s++) if ((a.flags[s]! & (AgentFlag.ALIVE | AgentFlag.UNDERGROUND)) === (AgentFlag.ALIVE | AgentFlag.UNDERGROUND)) underground++;
    return { dug: (w.soil!.dug - w.pitVoxels) * w.config.soil.pellet, pellets: w.mound!.pellets, underground };
  }

  private colonyCounts(): NonNullable<SimStats['colony']> {
    const w = this.world, a = w.agents.a, c = w.colony!;
    const tasks = [0, 0, 0];
    let crop = 0;
    for (let s = 0; s < w.agents.highWater; s++) {
      if ((a.flags[s]! & AgentFlag.ALIVE) === 0 || a.caste[s] !== Caste.WORKER) continue;
      tasks[a.task[s]!] = (tasks[a.task[s]!] ?? 0) + 1;
      crop += a.crop[s]!;
    }
    const workers = tasks.reduce((p, x) => p + x, 0);
    const b = c.brood;
    return {
      tasks, brood: [b.countStage(BroodStage.EGG), b.countStage(BroodStage.LARVA), b.countStage(BroodStage.PUPA)],
      intake: c.intake, cropFill: workers > 0 ? crop / workers / w.config.colony.crop : 0, eclosed: c.eclosed, died: c.died, queen: c.queen >= 0,
    };
  }

  private foragingCounts(): { states: number[]; carrying: number } {
    const a = this.world.agents.a;
    const states = new Array<number>(Object.keys(AgentState).length).fill(0);
    let carrying = 0;
    for (let s = 0; s < this.world.agents.highWater; s++) {
      if ((a.flags[s]! & AgentFlag.ALIVE) === 0) continue;
      states[a.state[s]!] = (states[a.state[s]!] ?? 0) + 1;
      if (a.carryKind[s] !== CarryKind.NONE) carrying++;
    }
    return { states, carrying };
  }

  /** The pheromone grid for display (null without a field). */
  fieldInfo(): FieldInfo | null {
    const f = this.world.pheromone;
    if (!f) return null;
    const b = f.buffer;
    return { x0: f.x0, z0: f.z0, cell: f.cell, nx: f.nx, nz: f.nz, shared: isSharedBuffer(b) ? b : null };
  }

  /** The nest of a digging world for display (null otherwise). */
  nestInfo(): NestInfo | null {
    const m = this.world.mound;
    if (!m) return null;
    const b = m.buffer;
    return { mound: { x0: m.x0, z0: m.z0, cell: m.cell, nx: m.n, nz: m.n, shared: isSharedBuffer(b) ? b : null } };
  }

  /** Soil chunks dug into since the last call (empty without soil). */
  takeSoilChunks(): SoilChunk[] {
    return this.world.soil ? this.world.soil.takeDirty() : [];
  }

  /** Positions of the colony's brood for display: [x, y, z, stage, growth] per item (null without a colony). */
  broodCopy(): Float32Array | null {
    const c = this.world.colony;
    if (!c) return null;
    const b = c.brood, soil = this.world.soil!, cc = this.world.config.colony;
    const out = new Float32Array(b.count * BROOD_FLOATS);
    const v = new Int32Array(3);
    let k = 0;
    for (let i = 0; i < b.highWater; i++) {
      if (b.stage[i] === BroodStage.NONE) continue;
      soil.unindex(b.cell[i]!, v);
      out[k] = soil.centreX(v[0]!); out[k + 1] = soil.centreY(v[1]!); out[k + 2] = soil.centreZ(v[2]!);
      out[k + 3] = b.stage[i]!;
      out[k + 4] = b.stage[i] === BroodStage.LARVA ? b.eaten[i]! / cc.larvalFood : 1;
      k += BROOD_FLOATS;
    }
    return out;
  }

  /** A copy of the mound when the renderer cannot read it directly, if it changed since the last copy. */
  moundCopy(): Float32Array | null {
    const m = this.world.mound;
    if (!m || isSharedBuffer(m.buffer) || m.version === this.moundVersion) return null;
    this.moundVersion = m.version;
    return m.heights.slice();
  }

  private moundVersion = -1;

  /** A copy of the pheromone grid when the renderer cannot read it directly (no shared memory), else null. */
  fieldCopy(): Float32Array | null {
    const f = this.world.pheromone;
    return f && !isSharedBuffer(f.buffer) ? f.data.slice() : null;
  }

  /** Rebuild the world (e.g. new agent count) keeping speed and pause state. */
  reset(config: Config): void {
    const { timeScale, paused } = this.clock;
    this.config = config;
    this.world = this.makeWorld(config);
    this.moundVersion = -1;
    this.clock = new FixedStepClock(config.sim.dt);
    this.clock.timeScale = timeScale;
    this.clock.paused = paused;
    this.lastNow = null;
    this.statSimStart = 0;
    this.dirty = true;
  }

  setSpeed(scale: number): void {
    this.clock.timeScale = scale;
    this.dirty = true;
  }

  setPaused(paused: boolean): void {
    this.clock.paused = paused;
    this.lastNow = null;
    this.dirty = true;
  }

  requestStep(): void {
    this.clock.requestSingleStep();
  }

  /**
   * Run due steps within the time budget and publish if anything changed.
   * Returns true if steps are still owed (caller should reschedule at once).
   */
  iterate(): boolean {
    const t0 = this.now();
    if (this.lastNow !== null) this.clock.advance((t0 - this.lastNow) / MS_PER_S);
    this.lastNow = t0;

    const budget = this.config.sim.loopBudget;
    let steps = 0;
    let t = t0;
    while (this.clock.consumeStep()) {
      if (this.stepper) this.stepper.step(this.world); else this.world.step();
      this.clock.completeStep();
      steps++;
      t = this.now();
      if (t - t0 > budget) break; // yield so commands and snapshots stay responsive
    }
    // Owed steps beyond `maxCatchUp` of wall time cannot be caught up: drop them.
    const keep = (this.config.sim.maxCatchUp / MS_PER_S) * this.clock.timeScale / this.clock.dt;
    this.dropped += this.clock.dropBacklog(keep);
    if (steps > 0) {
      this.statSteps += steps;
      this.statStepMs += t - t0;
    }
    if (steps > 0 || this.dirty) this.publish(t);
    return this.clock.backlog() > 0;
  }

  private publish(wallTime: number): void {
    if (!this.sink) return;
    writeSnapshot(this.world, this.sink.target(), ++this.seq, wallTime, this.clock.timeScale, this.clock.paused);
    this.sink.commit();
    this.dirty = false;
  }

  /** Statistics since the previous call, or null if the interval has not elapsed. */
  takeStats(): SimStats | null {
    const now = this.now();
    const elapsed = now - this.statStart;
    if (elapsed < this.config.sim.statsInterval) return null;
    const simNow = this.world.simTime();
    const stats: SimStats = {
      tick: this.world.tick,
      simTime: simNow,
      alive: this.world.agents.alive,
      msPerTick: this.statSteps > 0 ? this.statStepMs / this.statSteps : 0,
      ticksPerSec: (this.statSteps * MS_PER_S) / elapsed,
      achievedSpeed: ((simNow - this.statSimStart) * MS_PER_S) / elapsed,
      targetSpeed: this.clock.timeScale,
      paused: this.clock.paused,
      droppedSteps: this.dropped,
      threads: this.stepper?.lastThreads ?? 1,
      foraging: this.world.nest ? this.foragingCounts() : null,
      digging: this.world.soil ? this.diggingCounts() : null,
      colony: this.world.colony ? this.colonyCounts() : null,
    };
    this.statStart = now;
    this.statSteps = 0;
    this.statStepMs = 0;
    this.statSimStart = simNow;
    return stats;
  }
}
