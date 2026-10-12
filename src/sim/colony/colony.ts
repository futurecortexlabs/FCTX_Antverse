/**
 * Colony life (Phase 6): the queen, the brood and the workers' physiology.
 *
 * Everything here changes shared state, so it runs in World.completeStep on
 * the coordinating thread, in slot order:
 *   - requests made by the rules this tick: trophallaxis (GIVE: crop to the
 *     partner's crop, ASM-COL-007), feeding a larva (FEED), filling the crop
 *     at a feeder (FILL);
 *   - physiology: energy use from the body reserve, the reserve topped up
 *     from the crop, death by starvation or old age (ASM-COL-001…003);
 *   - the queen lays eggs at a rate set by her reserve (ASM-COL-004);
 *   - brood development: egg → larva → pupa → worker (ASM-COL-011); larvae
 *     grow by what they eat and die if left unfed (ASM-COL-005);
 *   - the brood-demand grid that nurses sense (ASM-COL-010): per density
 *     cell, 1 for every egg, larva and pupa plus each larva's gut emptiness;
 *     and the per-cell larva lists FEED searches.
 * Food is counted in mg of sugar throughout.
 */

import { S_PER_DAY, S_PER_H } from '../../core/units.ts';
import { dcos, dsin, PI } from '../../core/dmath.ts';
import type { StateHasher } from '../../core/statehash.ts';
import { rand, randNormal, Stream } from '../../core/rng.ts';
import { AgentFlag, AgentState, CarryKind, Caste, Task } from '../agents/store.ts';
import { nearWall, wallNormal } from '../rules/burrow.ts';
import type { Site, World } from '../world.ts';
import { BroodStage, BroodStore } from './brood.ts';

/** Sub-keys of Stream.COLONY (entity = agent slot or brood index). */
const Key = { PLACE: 0, AGE: 1, LAY: 2, STAGE: 3, HEADING: 4, PHASE: 5, SPEED: 6, DURATION: 7, LIFESPAN_N: 8, BROOD_PLACE: 32 } as const;
/** Brood items draw with entity BROOD + index, apart from agent slots (< 2^20). */
const BROOD = 1 << 24;
/** Tries to find a dug voxel for a new egg near the queen (sub-keys BROOD_PLACE + 2k, +2k+1, …). */
const PLACE_TRIES = 8;
const PLACE_STRIDE = 3;

const v = new Int32Array(3);
const n3 = new Float64Array(3);

export class Colony {
  readonly brood = new BroodStore();
  queen = -1;
  readonly feeders: Site[];
  /** Simulated time each feeder appears (s; 0 for the ones there from the start). */
  readonly feederFrom: number[];
  /** Per feeder: crop fills taken, and the time of the first (−1: none yet). */
  readonly fills: number[];
  readonly firstFill: number[];
  /** Food taken at the feeders so far (mg) and fed to larvae (mg). */
  intake = 0;
  fed = 0;
  /** Workers eclosed and died so far. */
  eclosed = 0;
  died = 0;
  private broodHead: Int32Array;
  private broodNext = new Int32Array(256);
  private headTouched: number[] = [];

  constructor(world: World) {
    const f = world.config.scenario.feeders as readonly number[];
    const r = world.config.scenario.feederRadius;
    this.feeders = [];
    this.feederFrom = [];
    for (let i = 0; i + 1 < f.length; i += 2) { this.feeders.push({ x: f[i]!, z: f[i + 1]!, r }); this.feederFrom.push(0); }
    const late = world.config.scenario.lateFeeders as readonly number[];
    for (let i = 0; i + 2 < late.length; i += 3) { this.feeders.push({ x: late[i]!, z: late[i + 1]!, r }); this.feederFrom.push(late[i + 2]! * S_PER_H); }
    this.fills = this.feeders.map(() => 0);
    this.firstFill = this.feeders.map(() => -1);
    this.broodHead = new Int32Array(world.density!.counts.length).fill(-1);
  }

  /**
   * The starting colony: the queen at the bottom of the starting pit, the
   * workers on its walls, the brood around the queen. Workers are of every
   * age up to colony.initialAge (but younger than their lifespan).
   */
  found(world: World, count: number): void {
    const soil = world.soil!, cc = world.config.colony;
    const spots = this.pitSpots(world);
    // The queen: the deepest spot nearest the axis.
    let q = 0;
    for (let i = 1; i < spots.length; i++) {
      soil.unindex(spots[i]!, v); const di = v[1]!, ri = this.axisDistance(world, v);
      soil.unindex(spots[q]!, v); const dq = v[1]!, rq = this.axisDistance(world, v);
      if (di > dq || (di === dq && ri < rq)) q = i;
    }
    const queen = world.agents.spawn(Caste.QUEEN);
    this.queen = queen;
    this.place(world, queen, spots[q]!);
    const a = world.agents.a;
    a.state[queen] = AgentState.NEST_REST;
    a.reserve[queen] = cc.queenReserve * (cc.initialFill as readonly number[])[0]!;
    a.crop[queen] = cc.crop * (cc.initialFill as readonly number[])[1]!;
    for (let i = 0; i < count; i++) {
      const s = world.agents.spawn(Caste.WORKER);
      const pick = spots[Math.min(spots.length - 1, Math.floor(rand(world.seed, Stream.COLONY, s, 0, Key.PLACE) * spots.length))]!;
      this.initWorker(world, s, pick, true);
    }
    // Starting brood around the queen.
    const [fe, fl, fp] = cc.initialBrood as readonly number[];
    const stages: [number, number, number][] = [
      [BroodStage.EGG, Math.round(fe! * count), 0], [BroodStage.LARVA, Math.round(fl! * count), 0], [BroodStage.PUPA, Math.round(fp! * count), 0],
    ];
    let k = 0;
    for (const [stage, n] of stages) {
      for (let j = 0; j < n; j++, k++) {
        const cell = this.cellNearQueen(world, BROOD + k, 0);
        const u = rand(world.seed, Stream.COLONY, BROOD + k, 0, Key.STAGE);
        const i = this.brood.add(stage, cell, 0);
        if (stage === BroodStage.EGG) this.brood.timer[i] = u * this.draw(world, cc.eggDays as readonly number[], i, 0);
        else if (stage === BroodStage.PUPA) this.brood.timer[i] = u * this.draw(world, cc.pupaDays as readonly number[], i, 0);
        else {
          // A larva part-way through: that share of its minimum period gone and of its food eaten.
          this.brood.timer[i] = (1 - u) * this.draw(world, cc.larvaDays as readonly number[], i, 0);
          this.brood.eaten[i] = u * cc.larvalFood;
          this.brood.gut[i] = cc.larvalGut;
        }
      }
    }
    this.indexBrood(world);
  }

  /** Grant a GIVE request of slot s: crop to crop, down the fill difference (ASM-COL-007). */
  give(world: World, s: number, p: number): void {
    const a = world.agents.a, cc = world.config.colony;
    const both = AgentFlag.ALIVE | AgentFlag.UNDERGROUND;
    if (p < 0 || p === s || p >= world.agents.highWater || (a.flags[p]! & both) !== both || (a.flags[s]! & both) !== both) return;
    const cs = a.crop[s]!, cp = a.crop[p]!;
    if ((cs - cp) / cc.crop <= cc.flowMargin) return;
    const amount = Math.min(cc.flowRate * world.config.sim.dt, (cs - cp) / 2, cc.crop - cp);
    if (amount <= 0) return;
    a.crop[s] = cs - amount;
    a.crop[p] = cp + amount;
  }

  /** Grant a FEED request: the nurse gives the hungriest larva in reach of voxel `cell` food from its crop, above colony.feedFill (ASM-COL-012). */
  feed(world: World, s: number, cell: number): void {
    const a = world.agents.a, cc = world.config.colony, soil = world.soil!, density = world.density!, b = this.brood;
    const spare = a.crop[s]! - cc.feedFill * cc.crop;
    if (cell < 0 || spare <= 0) return;
    soil.unindex(cell, v);
    const c = density.cell;
    const cx = Math.floor(v[0]! / c), cd = Math.floor(v[1]! / c), cz = Math.floor(v[2]! / c);
    let best = -1, bestNeed = 0;
    for (let z = Math.max(0, cz - 1); z <= Math.min(density.cz - 1, cz + 1); z++) {
      for (let y = Math.max(0, cd - 1); y <= Math.min(density.cd - 1, cd + 1); y++) {
        for (let x = Math.max(0, cx - 1); x <= Math.min(density.cx - 1, cx + 1); x++) {
          for (let i = this.broodHead[(z * density.cd + y) * density.cx + x]!; i >= 0; i = this.broodNext[i]!) {
            if (b.stage[i] !== BroodStage.LARVA || b.eaten[i]! >= cc.larvalFood || b.carrier[i]! >= 0) continue;
            const need = cc.larvalGut - b.gut[i]!;
            if (need > bestNeed || (need === bestNeed && need > 0 && i < best)) { best = i; bestNeed = need; }
          }
        }
      }
    }
    if (best < 0) return;
    const amount = Math.min(cc.feedRate * world.config.sim.dt, bestNeed, spare);
    a.crop[s] = a.crop[s]! - amount;
    b.gut[best] = b.gut[best]! + amount;
    this.fed += amount;
  }

  /** Grant a FILL request: a forager that reached a feeder this tick fills its crop (food is unlimited there). */
  fill(world: World, s: number, feeder: number): void {
    const a = world.agents.a, cc = world.config.colony;
    if (feeder >= 0 && feeder < this.fills.length) {
      this.fills[feeder]!++;
      if (this.firstFill[feeder]! < 0) this.firstFill[feeder] = world.simTime();
    }
    const amount = cc.crop - a.crop[s]!;
    if (amount <= 0) return;
    a.crop[s] = cc.crop;
    this.intake += amount;
  }

  /** Index of the feeder (already there at time t) covering (x, z), or −1. */
  feederAt(x: number, z: number, t: number): number {
    for (let i = 0; i < this.feeders.length; i++) {
      const f = this.feeders[i]!;
      if (t >= this.feederFrom[i]! && (x - f.x) * (x - f.x) + (z - f.z) * (z - f.z) <= f.r * f.r) return i;
    }
    return -1;
  }

  /** Physiology, laying and brood development for one tick (after the requests). */
  live(world: World): void {
    const ag = world.agents, a = ag.a, cc = world.config.colony, dt = world.config.sim.dt;
    const now = world.simTime();
    for (let s = 0; s < ag.highWater; s++) {
      if ((a.flags[s]! & AgentFlag.ALIVE) === 0) continue;
      const queen = a.caste[s] === Caste.QUEEN;
      const cap = queen ? cc.queenReserve : cc.reserve;
      // Energy use: more while walking, and by Q10 with the temperature where the ant is (Phase 7).
      const active = (a.lastStep[s]! > 0 ? cc.activeFactor : 1) * world.climate.rateAt(a.posY[s]!);
      let reserve = a.reserve[s]! - ((queen ? cc.queenMetabolism : cc.metabolism) / S_PER_DAY) * active * dt;
      // The crop passes food on to the worker's own gut, slowly (faster in the queen, scaled to her reserve).
      const take = Math.min(a.crop[s]!, (cc.absorb / S_PER_DAY) * (cap / cc.reserve) * dt, cap - reserve);
      if (take > 0) { a.crop[s] = a.crop[s]! - take; reserve += take; }
      a.reserve[s] = reserve;
      if (reserve <= 0 || (!queen && now - a.born[s]! >= a.lifespan[s]!)) {
        if (a.load[s]! >= 0) this.put(world, s); // what it carried stays where it fell
        ag.kill(s);
        if (queen) this.queen = -1; else this.died++;
      }
    }
    this.lay(world);
    this.develop(world);
    // Carried brood moves with its carrier.
    const b = this.brood;
    for (let i = 0; i < b.highWater; i++) if (b.stage[i] !== BroodStage.NONE && b.carrier[i]! >= 0) b.cell[i] = a.cell[b.carrier[i]!]!;
    this.indexBrood(world);
  }

  /**
   * Grant a PICK request (Phase 7): the nurse takes up a brood item lying near voxel `cell` — the
   * one whose temperature is furthest from colony.broodTemp, if that is more than broodTolerance off.
   */
  pick(world: World, s: number, cell: number): void {
    const a = world.agents.a, cc = world.config.colony, soil = world.soil!, density = world.density!, b = this.brood;
    if (a.load[s]! >= 0 || cell < 0 || (a.flags[s]! & AgentFlag.UNDERGROUND) === 0) return;
    soil.unindex(cell, v);
    const c = density.cell;
    const cx = Math.floor(v[0]! / c), cd = Math.floor(v[1]! / c), cz = Math.floor(v[2]! / c);
    let best = -1, worst = cc.broodTolerance;
    for (let z = Math.max(0, cz - 1); z <= Math.min(density.cz - 1, cz + 1); z++) {
      for (let y = Math.max(0, cd - 1); y <= Math.min(density.cd - 1, cd + 1); y++) {
        for (let x = Math.max(0, cx - 1); x <= Math.min(density.cx - 1, cx + 1); x++) {
          for (let i = this.broodHead[(z * density.cd + y) * density.cx + x]!; i >= 0; i = this.broodNext[i]!) {
            if (b.stage[i] === BroodStage.NONE || b.carrier[i]! >= 0) continue;
            soil.unindex(b.cell[i]!, v);
            const off = Math.abs(world.climate.tempAt(soil.centreY(v[1]!)) - cc.broodTemp);
            if (off > worst || (off === worst && best >= 0 && i < best)) { best = i; worst = off; }
          }
        }
      }
    }
    if (best < 0) return;
    b.carrier[best] = s;
    b.cell[best] = a.cell[s]!;
    a.load[s] = best;
    a.carryKind[s] = CarryKind.BROOD;
    a.searchTime[s] = 0; // times the carrying
  }

  /** Grant a PUT request: the carried item is laid down where the carrier stands. */
  put(world: World, s: number): void {
    const a = world.agents.a, i = a.load[s]!;
    if (i < 0) return;
    if (this.brood.stage[i] !== BroodStage.NONE && this.brood.carrier[i] === s) {
      this.brood.carrier[i] = -1;
      if (a.cell[s]! >= 0) this.brood.cell[i] = a.cell[s]!;
    }
    a.load[s] = -1;
    if (a.carryKind[s] === CarryKind.BROOD) a.carryKind[s] = CarryKind.NONE;
  }

  /** Remove a brood item (hatched into a worker, or dead), freeing its carrier's mandibles. */
  private removeBrood(world: World, i: number): void {
    const c = this.brood.carrier[i]!;
    if (c >= 0) {
      const a = world.agents.a;
      a.load[c] = -1;
      if (a.carryKind[c] === CarryKind.BROOD) a.carryKind[c] = CarryKind.NONE;
    }
    this.brood.remove(i);
  }

  hashInto(h: StateHasher): void {
    h.word(this.queen).f64(this.intake).f64(this.fed).word(this.eclosed).word(this.died);
    for (const n of this.fills) h.word(n);
    for (const view of this.brood.views()) h.view(view);
  }

  // ---------------------------------------------------------------------------

  private lay(world: World): void {
    const q = this.queen;
    if (q < 0) return;
    const a = world.agents.a, cc = world.config.colony;
    const p = (cc.layRate / S_PER_DAY) * world.config.sim.dt * Math.min(1, a.reserve[q]! / cc.queenReserve);
    if (a.reserve[q]! <= cc.eggCost || rand(world.seed, Stream.COLONY, q, world.tick, Key.LAY) >= p) return;
    a.reserve[q] = a.reserve[q]! - cc.eggCost;
    const i = this.brood.add(BroodStage.EGG, this.cellNearQueen(world, q, world.tick), 0);
    this.brood.timer[i] = this.draw(world, cc.eggDays as readonly number[], i, world.tick);
  }

  private develop(world: World): void {
    const b = this.brood, cc = world.config.colony, dt = world.config.sim.dt;
    const intake = (cc.larvalFood / (cc.larvaDays as readonly number[])[0]! / S_PER_DAY) * dt;
    const starve = cc.larvalStarve * S_PER_DAY;
    const soil = world.soil!;
    for (let i = 0; i < b.highWater; i++) {
      const stage = b.stage[i]!;
      if (stage === BroodStage.NONE) continue;
      // Development runs faster where it is warmer (Q10 of the soil temperature at the item, Phase 7).
      soil.unindex(b.cell[i]!, v);
      const rate = world.climate.rateAt(soil.centreY(v[1]!));
      b.timer[i] = b.timer[i]! - dt * rate;
      if (stage === BroodStage.EGG) {
        if (b.timer[i]! <= 0) {
          b.stage[i] = BroodStage.LARVA;
          b.timer[i] = this.draw(world, cc.larvaDays as readonly number[], i, world.tick);
        }
      } else if (stage === BroodStage.LARVA) {
        const take = Math.min(b.gut[i]!, intake * rate, cc.larvalFood - b.eaten[i]!);
        b.gut[i] = b.gut[i]! - take;
        b.eaten[i] = b.eaten[i]! + take;
        b.hungry[i] = b.gut[i]! > 0 || b.eaten[i]! >= cc.larvalFood ? 0 : b.hungry[i]! + dt;
        if (b.hungry[i]! > starve) this.removeBrood(world, i);
        else if (b.eaten[i]! >= cc.larvalFood && b.timer[i]! <= 0) {
          b.stage[i] = BroodStage.PUPA;
          b.timer[i] = this.draw(world, cc.pupaDays as readonly number[], i, world.tick);
        }
      } else if (b.timer[i]! <= 0) {
        // Eclosion: a new (callow) worker where the pupa lay.
        const cell = b.cell[i]!;
        this.removeBrood(world, i);
        if (world.agents.highWater < world.agents.capacity || world.agents.freeSlots().length > 0) {
          const s = world.agents.spawn(Caste.WORKER);
          this.initWorker(world, s, cell, false);
          this.eclosed++;
        }
      }
    }
  }

  /** Per-cell brood lists (FEED takes larvae from them, PICK any item) and the brood-demand grid (for nurses). */
  private indexBrood(world: World): void {
    const b = this.brood, cc = world.config.colony, soil = world.soil!, density = world.density!;
    for (const k of this.headTouched) this.broodHead[k] = -1;
    this.headTouched = [];
    if (this.broodNext.length < b.stage.length) this.broodNext = new Int32Array(b.stage.length);
    density.clearDemand();
    for (let i = 0; i < b.highWater; i++) {
      const stage = b.stage[i]!;
      if (stage === BroodStage.NONE) continue;
      soil.unindex(b.cell[i]!, v);
      let units = 1;
      const k = density.key(v[0]!, v[1]!, v[2]!);
      if (this.broodHead[k] === -1) this.headTouched.push(k);
      this.broodNext[i] = this.broodHead[k]!;
      this.broodHead[k] = i;
      if (stage === BroodStage.LARVA && b.eaten[i]! < cc.larvalFood) units += 1 - b.gut[i]! / cc.larvalGut;
      density.addDemand(v[0]!, v[1]!, v[2]!, units);
    }
  }

  /** A worker standing in voxel `cell`: physiology, thresholds, walking traits. */
  private initWorker(world: World, s: number, cell: number, founding: boolean): void {
    const a = world.agents.a, cc = world.config.colony, lc = world.config.locomotion;
    const tick = founding ? 0 : world.tick;
    const [mean, sd] = cc.lifespan as readonly number[];
    const lifespan = Math.max(0, mean! + sd! * randNormal(world.seed, Stream.COLONY, s, tick, Key.LIFESPAN_N)) * S_PER_DAY;
    const age = founding ? rand(world.seed, Stream.COLONY, s, tick, Key.AGE) * Math.min(cc.initialAge * S_PER_DAY, lifespan) : 0;
    this.place(world, s, cell);
    const fill = cc.initialFill as readonly number[];
    a.state[s] = AgentState.DIG;
    a.task[s] = Task.IDLE;
    a.born[s] = world.simTime() - age;
    a.lifespan[s] = lifespan;
    a.reserve[s] = cc.reserve * fill[0]!;
    a.crop[s] = founding ? cc.crop * fill[1]! : 0;
    a.hunger[s] = 1 - a.crop[s]! / cc.crop;
    const [tf, tn] = cc.thetaInit as readonly number[];
    a.thetaF[s] = tf!;
    a.thetaN[s] = tn!;
    a.heading[s] = (rand(world.seed, Stream.COLONY, s, tick, Key.HEADING) * 2 - 1) * PI;
    a.gaitPhase[s] = rand(world.seed, Stream.COLONY, s, tick, Key.PHASE);
    a.speed[s] = lc.speed * (1 + lc.speedSpread * (rand(world.seed, Stream.COLONY, s, tick, Key.SPEED) * 2 - 1));
    a.compassError[s] = 0;
  }

  /** Put agent s underground in voxel `cell`, standing on its wall. */
  private place(world: World, s: number, cell: number): void {
    const a = world.agents.a, soil = world.soil!;
    soil.unindex(cell, v);
    a.flags[s] = a.flags[s]! | AgentFlag.UNDERGROUND;
    a.cell[s] = cell;
    a.posX[s] = soil.centreX(v[0]!); a.posY[s] = soil.centreY(v[1]!); a.posZ[s] = soil.centreZ(v[2]!);
    const h = a.heading[s]!;
    a.dirX[s] = dcos(h); a.dirY[s] = 0; a.dirZ[s] = -dsin(h);
    if (wallNormal(soil, v[0]!, v[1]!, v[2]!, n3)) { a.upX[s] = n3[0]!; a.upY[s] = n3[1]!; a.upZ[s] = n3[2]!; }
  }

  /** Standing places in the starting pit (dug voxels next to a wall), in index order. */
  private pitSpots(world: World): number[] {
    const soil = world.soil!;
    const [radius, depth] = world.config.soil.pit as readonly number[];
    const ix0 = soil.voxelX(0), iz0 = soil.voxelZ(0), r = Math.ceil(radius!);
    const out: number[] = [];
    for (let iz = iz0 - r; iz <= iz0 + r; iz++) for (let ix = ix0 - r; ix <= ix0 + r; ix++) {
      const top = soil.airTop[ix + iz * soil.nx]!;
      for (let d = top; d < top + depth!; d++) if (soil.isDug(ix, d, iz) && nearWall(soil, ix, d, iz)) out.push(soil.index(ix, d, iz));
    }
    if (out.length === 0) throw new Error('Colony: the starting pit has no room (soil.pit)');
    return out;
  }

  private axisDistance(world: World, cell: Int32Array): number {
    const soil = world.soil!;
    const dx = soil.centreX(cell[0]!), dz = soil.centreZ(cell[2]!);
    return dx * dx + dz * dz;
  }

  /** A dug voxel within broodRadius of the queen (the queen's own voxel if none is found). */
  private cellNearQueen(world: World, entity: number, tick: number): number {
    const a = world.agents.a, soil = world.soil!, rr = world.config.colony.broodRadius;
    const qc = a.cell[this.queen]!;
    soil.unindex(qc, v);
    const qx = v[0]!, qd = v[1]!, qz = v[2]!;
    for (let t = 0; t < PLACE_TRIES; t++) {
      const k = Key.BROOD_PLACE + PLACE_STRIDE * t;
      const ox = Math.round((rand(world.seed, Stream.COLONY, entity, tick, k) * 2 - 1) * rr);
      const od = Math.round((rand(world.seed, Stream.COLONY, entity, tick, k + 1) * 2 - 1) * rr);
      const oz = Math.round((rand(world.seed, Stream.COLONY, entity, tick, k + 2) * 2 - 1) * rr);
      if (ox * ox + od * od + oz * oz > rr * rr) continue;
      if (soil.isDug(qx + ox, qd + od, qz + oz) && soil.inBounds(qx + ox, qd + od, qz + oz)) return soil.index(qx + ox, qd + od, qz + oz);
    }
    return qc;
  }

  /** A duration (s) drawn uniformly from a [lo, hi] range in days. */
  private draw(world: World, range: readonly number[], entity: number, tick: number): number {
    const u = rand(world.seed, Stream.COLONY, BROOD + entity, tick, Key.DURATION);
    return (range[0]! + (range[1]! - range[0]!) * u) * S_PER_DAY;
  }
}
