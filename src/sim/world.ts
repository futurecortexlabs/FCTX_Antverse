/**
 * The authoritative simulation state and its fixed-step update.
 *
 * World knows nothing about wall-clock time, threads or rendering: step()
 * advances exactly one dt. The same World runs in the sim worker, in Node
 * tests and in headless experiments, and must produce the same stateHash()
 * for the same (config, seed, tick) everywhere.
 *
 * Rules operate on a slot range and only read/write the agents in it, so a
 * step can be split across threads (worker/parallel.ts) without changing the
 * result: stepRange() over any partition of [0, highWater), followed by one
 * completeStep(), equals step().
 */

import { isSharedBuffer } from '../core/soa.ts';
import { dexp } from '../core/dmath.ts';
import { StateHasher } from '../core/statehash.ts';
import type { Config } from '../config/params.ts';
import { Terrain } from '../terrain/terrain.ts';
import { DoubleBridge, homingSites, type Site } from '../terrain/apparatus.ts';
import { PheromoneField } from './pheromone/field.ts';
import { forage } from './rules/forage.ts';
import { navigate, pathIntegrate } from './rules/navigate.ts';
import { burrow } from './rules/burrow.ts';
import { excavate } from './rules/excavate.ts';
import { DensityGrid, type ContactBuffers } from './nest/density.ts';
import { Colony } from './colony/colony.ts';
import { tend } from './rules/tend.ts';
import { avoid } from './rules/avoid.ts';
import { Climate } from './env/climate.ts';
import { Drops, type DropBuffers } from './env/drops.ts';
import { weather } from './env/weather.ts';
import { SurfaceGrid, type SurfaceBuffers } from './space/surface-grid.ts';
import { DigLog } from './nest/dig-log.ts';
import { Soil } from '../soil/soil.ts';
import { Mound } from '../soil/mound.ts';
import { AgentFlag, AgentState, CarryKind, Request } from './agents/store.ts';
import { layTrail, trail } from './rules/trail.ts';
import { AgentStore } from './agents/store.ts';
import { spawnWorkers } from './population.ts';
import { bodyPose } from './rules/body-pose.ts';
import { explore } from './rules/explore.ts';

export type Rule = (world: World, from: number, to: number) => void;

/**
 * Rules in update order. Each reads the shared environment (terrain, the
 * pheromone field as it was at the start of the tick) and writes only its own
 * agents; pheromone deposits are recorded per agent and applied afterwards.
 * trail and navigate request turns, explore moves on the surface and burrow
 * underground, pathIntegrate measures the move. excavate decides to dig or
 * drop soil (requests applied in completeStep).
 */
export const RULES: readonly Rule[] = [forage, excavate, tend, trail, navigate, avoid, explore, burrow, pathIntegrate, layTrail, bodyPose];

export type { Site };

export interface WorldOptions {
  /** Use these agents instead of allocating and spawning (thread helpers attach to shared memory). */
  agents?: AgentStore;
  /** Allocate the agents in shared memory so helper threads can step slices of them. */
  sharedAgents?: boolean;
  /** Attach to an existing pheromone grid (thread helpers). */
  pheromoneBuffer?: SharedArrayBuffer;
  /** Allocate the pheromone grid (and the mound) in shared memory (helpers or the renderer read them). */
  sharedField?: boolean;
  /** Attach to an existing mound heightfield. */
  moundBuffer?: SharedArrayBuffer;
  /** Thread helpers of a digging world: the coordinator's density counts and dig log (see sharedNest()). */
  densityBuffer?: SharedArrayBuffer;
  digLogBuffer?: SharedArrayBuffer;
  /** Thread helpers of a colony: the coordinator's contact index. */
  contactBuffers?: ContactBuffers;
  /** Thread helpers: the coordinator's surface grid (collision avoidance). */
  surfaceBuffers?: SurfaceBuffers;
  /** Thread helpers: the coordinator's water drops. */
  dropBuffers?: DropBuffers;
}

/** Shared memory a helper thread needs to step a slice of a digging world. */
export interface SharedNest {
  mound: SharedArrayBuffer;
  density: SharedArrayBuffer;
  digLog: SharedArrayBuffer;
  contacts: ContactBuffers | null;
}

export class World {
  readonly config: Config;
  readonly seed: number;
  /** Index of the next step to compute (= number of completed steps). */
  tick = 0;
  readonly agents: AgentStore;
  readonly terrain: Terrain;
  /** Per-step blend factor of the body pose filter: 1 - exp(-dt/τ). */
  readonly poseAlpha: number;
  /** Experimental apparatus, if the scenario uses one. */
  readonly bridge: DoubleBridge | null;
  /** Nest and food source of a foraging scenario (null on open ground without one). */
  readonly nest: Site | null;
  readonly feeder: Site | null;
  /**
   * Trail pheromone over the apparatus. Open ground has no field yet: nothing
   * there lays trail until the colony forages (Phase 6), and a 1 mm grid over
   * the whole 2 m square would cost 16 MB per world for nothing.
   */
  readonly pheromone: PheromoneField | null;
  /** Nest excavation (Phase 5): the soil below the entrance, the mound of dug-out soil, nestmate density. */
  readonly soil: Soil | null;
  readonly mound: Mound | null;
  readonly density: DensityGrid | null;
  /** Voxels of the starting pit (dug by the set-up, not by workers). */
  readonly pitVoxels: number;
  /**
   * Digging with helper threads: the coordinator writes the log, helpers
   * replay it (readsDigLog) before each slice. Null when stepping alone.
   */
  readonly digLog: DigLog | null;
  /** Light and temperatures of the current interval (Phase 7; constant when env is off). */
  readonly climate: Climate;
  /** Water drops on leaves and stones (Phase 7; null when the environment is off). */
  readonly drops: Drops | null;
  /** Surface neighbours for collision avoidance (Phase 7; null unless explore.collide). */
  readonly surface: SurfaceGrid | null;
  /** Colony life (Phase 6): queen, brood, physiology. Only the coordinator's copy changes. */
  readonly colony: Colony | null;
  private readonly readsDigLog: boolean;
  private readonly terrainDigest: number;

  constructor(config: Config, opts: WorldOptions = {}) {
    this.config = config;
    this.seed = config.sim.seed >>> 0;
    this.terrain = new Terrain(config);
    this.terrainDigest = this.terrain.digest();
    this.poseAlpha = 1 - dexp(-config.sim.dt / config.locomotion.poseSmoothing);
    this.bridge = config.scenario.doubleBridge ? new DoubleBridge(config) : null;
    if (this.bridge) {
      this.nest = this.bridge.nest;
      this.feeder = this.bridge.feeder;
    } else if (config.scenario.homing) {
      ({ nest: this.nest, feeder: this.feeder } = homingSites(config));
    } else if (config.scenario.digging || config.scenario.colony) {
      this.nest = { x: 0, z: 0, r: config.scenario.nestRadius };
      this.feeder = null;
    } else {
      this.nest = null;
      this.feeder = null;
    }
    this.pheromone = this.makeField(opts);
    if (config.scenario.digging || config.scenario.colony) {
      this.soil = new Soil(config, this.terrain);
      const mc = config.mound;
      this.mound = new Mound({ cx: 0, cz: 0, radius: mc.radius, cell: mc.cell, repose: mc.repose, open: config.scenario.nestRadius },
        opts.moundBuffer, opts.sharedAgents === true || opts.sharedField === true);
      this.terrain.overlay = this.mound;
      const shared = opts.sharedAgents === true;
      this.density = new DensityGrid(this.soil, config.soil.densityCell, shared, opts.densityBuffer);
      if (config.scenario.colony) this.density.withContacts(config.sim.capacity, shared, opts.contactBuffers);
      this.pitVoxels = this.digPit();
      this.readsDigLog = opts.digLogBuffer !== undefined;
      this.digLog = opts.digLogBuffer ? new DigLog(0, opts.digLogBuffer) : shared ? new DigLog(config.soil.digLog) : null;
    } else {
      this.soil = null;
      this.mound = null;
      this.density = null;
      this.pitVoxels = 0;
      this.digLog = null;
      this.readsDigLog = false;
    }
    this.climate = new Climate(this);
    this.drops = config.env.enabled
      ? new Drops(config.env.dropCapacity, config.world.arenaSize, config.env.dropCell, opts.sharedAgents === true, opts.dropBuffers)
      : null;
    this.colony = config.scenario.colony ? new Colony(this) : null;
    this.surface = config.explore.collide
      ? new SurfaceGrid(config.world.arenaSize, config.explore.collideCell, config.sim.capacity, opts.sharedAgents === true, opts.surfaceBuffers)
      : null;
    if (opts.agents) {
      this.agents = opts.agents;
    } else {
      this.agents = new AgentStore(config.sim.capacity, { shared: opts.sharedAgents === true });
      if (this.colony) {
        this.colony.found(this, config.population.count);
        this.rebuildDensity();
      } else spawnWorkers(this, config.population.count);
      this.rebuildSurface();
    }
  }

  /** The starting pit under the entrance (soil.pit: radius, depth), so the first workers can get in. */
  private digPit(): number {
    const soil = this.soil!;
    const [radius, depth] = this.config.soil.pit as [number, number];
    const ix0 = soil.voxelX(0), iz0 = soil.voxelZ(0);
    const r = Math.ceil(radius);
    let n = 0;
    for (let iz = iz0 - r; iz <= iz0 + r; iz++) for (let ix = ix0 - r; ix <= ix0 + r; ix++) {
      const dx = soil.centreX(ix), dz = soil.centreZ(iz);
      if (dx * dx + dz * dz > radius * radius && !(ix === ix0 && iz === iz0)) continue;
      const top = soil.airTop[ix + iz * soil.nx]!;
      for (let d = top; d < top + depth; d++) if (soil.dig(ix, d, iz)) { this.density!.dug(ix, d, iz); n++; }
    }
    return n;
  }

  private makeField(opts: WorldOptions): PheromoneField | null {
    const pc = this.config.pheromone;
    const b = this.bridge;
    if (!b && this.config.scenario.colony) {
      // The colony's foraging ground: a square around the entrance, on cell multiples.
      const c = pc.cell, half = Math.ceil(this.config.scenario.fieldSize / 2 / c) * c;
      return new PheromoneField(
        { x0: -half, z0: -half, width: 2 * half, depth: 2 * half, cell: c, lifetime: pc.lifetime, diffusion: pc.diffusion, dt: pc.period * this.config.sim.dt, epsilon: pc.epsilon },
        opts.sharedAgents === true || opts.sharedField === true,
        opts.pheromoneBuffer,
      );
    }
    if (!b) return null;
    const margin = this.config.scenario.bridgeWidth;
    // Grid nodes on multiples of the cell, so the axis z = 0 is a row of nodes and
    // mirror-image geometry gives a mirror-image grid.
    const c = pc.cell;
    const x0 = Math.floor((b.minX - margin) / c) * c, z0 = Math.floor((b.minZ - margin) / c) * c;
    const x1 = Math.ceil((b.maxX + margin) / c) * c, z1 = Math.ceil((b.maxZ + margin) / c) * c;
    const rect = { x0, z0, width: x1 - x0, depth: z1 - z0 };
    return new PheromoneField(
      { ...rect, cell: pc.cell, lifetime: pc.lifetime, diffusion: pc.diffusion, dt: pc.period * this.config.sim.dt, epsilon: pc.epsilon },
      opts.sharedAgents === true || opts.sharedField === true,
      opts.pheromoneBuffer,
    );
  }

  /** Run every rule on slots [from, to) for the current tick (does not advance the tick). */
  stepRange(from: number, to: number): void {
    if (this.readsDigLog) this.replayDigs();
    this.climate.update(this);
    this.agents.a.request.fill(Request.NONE, from, to);
    for (const rule of RULES) rule(this, from, to);
  }

  /** A helper's world catches up with the coordinator's digging. */
  private replayDigs(): void {
    const soil = this.soil!, density = this.density!;
    this.digLog!.replay((voxel) => {
      soil.unindex(voxel, this.cell3);
      if (soil.dig(this.cell3[0]!, this.cell3[1]!, this.cell3[2]!)) density.dug(this.cell3[0]!, this.cell3[1]!, this.cell3[2]!);
    });
  }

  /** Buffers a helper thread attaches to (null unless this world digs and was built with shared agents). */
  sharedNest(): SharedNest | null {
    if (!this.digLog || this.readsDigLog) return null;
    const m = this.mound!.buffer, d = this.density!.buffer;
    if (!isSharedBuffer(m) || !isSharedBuffer(d)) return null;
    return { mound: m, density: d, digLog: this.digLog.buffer, contacts: this.density!.contactBuffers() };
  }

  /**
   * Finish the tick on the coordinating thread: lay this tick's pheromone in
   * slot order (deterministic regardless of threads), update the field on its
   * own period, advance the tick.
   */
  completeStep(): void {
    this.climate.update(this);
    const field = this.pheromone;
    const a = this.agents.a;
    if (field) {
      for (let s = 0; s < this.agents.highWater; s++) {
        const q = a.deposit[s]!;
        if (q > 0) { field.deposit(a.posX[s]!, a.posZ[s]!, q); a.deposit[s] = 0; }
      }
      if ((this.tick + 1) % this.config.pheromone.period === 0) field.step();
    }
    const soil = this.soil;
    if (soil) {
      // Digging and dropping, in slot order: the first request for a voxel gets it.
      const mound = this.mound!, density = this.density!;
      const pellet = this.config.soil.pellet;
      for (let s = 0; s < this.agents.highWater; s++) {
        const r = a.request[s]!;
        if (r === Request.NONE) continue;
        a.request[s] = Request.NONE;
        if (r === Request.DIG) {
          soil.unindex(a.requestCell[s]!, this.cell3);
          if (soil.dig(this.cell3[0]!, this.cell3[1]!, this.cell3[2]!)) {
            density.dug(this.cell3[0]!, this.cell3[1]!, this.cell3[2]!);
            this.digLog?.append(a.requestCell[s]!);
            a.carryKind[s] = CarryKind.SOIL;
            a.state[s] = AgentState.HAUL;
          }
        } else if (r === Request.DROP) {
          mound.drop(a.posX[s]!, a.posZ[s]!, pellet);
          a.carryKind[s] = CarryKind.NONE;
          a.state[s] = AgentState.REENTER;
        } else if (r === Request.GIVE) this.colony!.give(this, s, a.requestCell[s]!);
        else if (r === Request.FEED) this.colony!.feed(this, s, a.requestCell[s]!);
        else if (r === Request.FILL) this.colony!.fill(this, s, a.requestCell[s]!);
        else if (r === Request.PICK) this.colony!.pick(this, s, a.requestCell[s]!);
        else if (r === Request.PUT) this.colony!.put(this, s);
      }
      this.colony?.live(this);
      this.rebuildDensity();
    }
    weather(this);
    this.rebuildSurface();
    this.tick++;
  }

  /** Sort the agents on the surface into the surface grid (collision avoidance). */
  private rebuildSurface(): void {
    const g = this.surface;
    if (!g) return;
    const a = this.agents.a;
    g.clear();
    for (let s = 0; s < this.agents.highWater; s++) if ((a.flags[s]! & (AgentFlag.ALIVE | AgentFlag.UNDERGROUND)) === AgentFlag.ALIVE) g.add(a.posX[s]!, a.posZ[s]!);
    g.layout();
    for (let s = 0; s < this.agents.highWater; s++) if ((a.flags[s]! & (AgentFlag.ALIVE | AgentFlag.UNDERGROUND)) === AgentFlag.ALIVE) g.place(s, a.posX[s]!, a.posZ[s]!, a.heading[s]!);
  }

  /** The water drops' buffers for helper threads (null without the environment or shared memory). */
  sharedDrops(): DropBuffers | null {
    return this.drops ? this.drops.buffers() : null;
  }

  /** The surface grid's buffers for helper threads (null without collisions or shared memory). */
  sharedSurface(): SurfaceBuffers | null {
    return this.surface ? this.surface.buffers() : null;
  }

  /** Count the underground agents per density cell (and, in a colony, index them for contacts). */
  private rebuildDensity(): void {
    const soil = this.soil!, density = this.density!, a = this.agents.a;
    const both = AgentFlag.ALIVE | AgentFlag.UNDERGROUND;
    density.clear();
    for (let s = 0; s < this.agents.highWater; s++) {
      if ((a.flags[s]! & both) !== both) continue;
      soil.unindex(a.cell[s]!, this.cell3);
      density.add(this.cell3[0]!, this.cell3[1]!, this.cell3[2]!);
    }
    if (!density.contacts) return;
    density.layout();
    for (let s = 0; s < this.agents.highWater; s++) {
      if ((a.flags[s]! & both) !== both) continue;
      soil.unindex(a.cell[s]!, this.cell3);
      density.place(this.cell3[0]!, this.cell3[1]!, this.cell3[2]!, s, a.posX[s]!, a.posY[s]!, a.posZ[s]!);
    }
  }

  private readonly cell3 = new Int32Array(3);

  step(): void {
    this.stepRange(0, this.agents.highWater);
    this.completeStep();
  }

  simTime(): number {
    return this.tick * this.config.sim.dt;
  }

  stateHash(): number {
    const h = new StateHasher().word(this.seed).word(this.tick).word(this.terrainDigest);
    h.word(this.agents.highWater).word(this.agents.alive);
    for (const s of this.agents.freeSlots()) h.word(s);
    for (const v of this.agents.views()) h.view(v);
    if (this.pheromone) h.view(this.pheromone.data);
    if (this.soil) { this.soil.hashInto(h); h.word(this.mound!.pellets).view(this.mound!.heights); }
    this.colony?.hashInto(h);
    if (this.drops) for (const v of this.drops.views()) h.view(v);
    return h.digest();
  }
}
