/**
 * Reproduction tests for colony life (Phase 6): founding (ENG-SCN-005,
 * ASM-COL-003/006), physiology (ASM-COL-001/002), trophallaxis and feeding
 * (ASM-COL-007), brood development (ASM-COL-005/011), laying (ASM-COL-004),
 * response thresholds (BIO-COL-002/003, ASM-COL-008/009), contacts and
 * stimuli (ASM-COL-010), and the forager's trip through the nest.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildConfig, type Overlay } from '../../config/load.ts';
import { S_PER_DAY, S_PER_H } from '../../core/units.ts';
import { AgentFlag, AgentState, Caste, CarryKind, Request, Task } from '../agents/store.ts';
import { nearWall, surface } from '../rules/burrow.ts';
import { ageFactors, response, tend } from '../rules/tend.ts';
import { layTrail, trail } from '../rules/trail.ts';
import { World } from '../world.ts';
import { BroodStage } from './brood.ts';

const preset = JSON.parse(readFileSync('config/presets/colony.json', 'utf8')) as Overlay;
const small: Overlay = { soil: { size: [128, 256, 128] } };
const make = (extra: Overlay = {}, count = 20): World => new World(buildConfig([preset, small, { population: { count } }, extra]).config);
const v = new Int32Array(3);
const workers = (w: World): number[] => {
  const out: number[] = [];
  for (let s = 0; s < w.agents.highWater; s++) if (w.agents.isAlive(s) && w.agents.a.caste[s] === Caste.WORKER) out.push(s);
  return out;
};
/** All food in the colony: crops, reserves, larval guts and what the brood has eaten (mg). */
function food(w: World): number {
  const a = w.agents.a, b = w.colony!.brood;
  let f = 0;
  for (let s = 0; s < w.agents.highWater; s++) if (w.agents.isAlive(s)) f += a.crop[s]! + a.reserve[s]!;
  for (let i = 0; i < b.highWater; i++) if (b.stage[i] !== BroodStage.NONE) f += b.gut[i]! + b.eaten[i]!;
  return f;
}

describe('founding', () => {
  it('the queen at the bottom of the pit, workers on its walls, brood around the queen', () => {
    const w = make({}, 50), a = w.agents.a, soil = w.soil!, c = w.colony!, cc = w.config.colony;
    expect(a.caste[c.queen]).toBe(Caste.QUEEN);
    soil.unindex(a.cell[c.queen]!, v);
    const qd = v[1]!;
    for (const s of workers(w)) {
      expect(a.flags[s]! & AgentFlag.UNDERGROUND).not.toBe(0);
      soil.unindex(a.cell[s]!, v);
      expect(nearWall(soil, v[0]!, v[1]!, v[2]!)).toBe(true);
      expect(v[1]!).toBeLessThanOrEqual(qd);
      const age = -a.born[s]!;
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThanOrEqual(Math.min(cc.initialAge * S_PER_DAY, a.lifespan[s]!));
    }
    const [fe, fl, fp] = cc.initialBrood as readonly number[];
    expect(c.brood.countStage(BroodStage.EGG)).toBe(Math.round(fe! * 50));
    expect(c.brood.countStage(BroodStage.LARVA)).toBe(Math.round(fl! * 50));
    expect(c.brood.countStage(BroodStage.PUPA)).toBe(Math.round(fp! * 50));
    soil.unindex(a.cell[c.queen]!, v);
    const [qx, , qz] = [v[0]!, v[1]!, v[2]!];
    for (let i = 0; i < c.brood.highWater; i++) {
      soil.unindex(c.brood.cell[i]!, v);
      expect(soil.isDug(v[0]!, v[1]!, v[2]!)).toBe(true);
      expect(Math.hypot(v[0]! - qx, v[1]! - qd, v[2]! - qz)).toBeLessThanOrEqual(cc.broodRadius + 1e-9);
    }
  });
});

describe('physiology', () => {
  it('a resting worker uses its reserve at the metabolic rate; walking costs activeFactor times more', () => {
    const w = make({ colony: { absorb: 0 } }, 2), a = w.agents.a, cc = w.config.colony, [s0, s1] = workers(w);
    a.reserve[s0!] = 0.4; a.reserve[s1!] = 0.4;
    a.lastStep[s0!] = 0; a.lastStep[s1!] = 1;
    w.colony!.live(w);
    const rest = cc.metabolism / S_PER_DAY * w.config.sim.dt;
    expect(0.4 - a.reserve[s0!]!).toBeCloseTo(rest, 15);
    expect(0.4 - a.reserve[s1!]!).toBeCloseTo(rest * cc.activeFactor, 15);
  });

  it('the crop tops up the reserve at the absorb rate, never above capacity; food is conserved', () => {
    const w = make({ colony: { metabolism: 0 } }, 1), a = w.agents.a, cc = w.config.colony, [s] = workers(w);
    a.reserve[s!] = 0.1; a.crop[s!] = 0.3;
    w.colony!.live(w);
    expect(a.reserve[s!]! - 0.1).toBeCloseTo(cc.absorb / S_PER_DAY * w.config.sim.dt, 15);
    expect(a.reserve[s!]! + a.crop[s!]!).toBeCloseTo(0.4, 15);
    a.reserve[s!] = cc.reserve;
    w.colony!.live(w);
    expect(a.reserve[s!]).toBe(cc.reserve);
  });

  it('a worker whose reserve runs out dies; so does one at the end of its lifespan', () => {
    const w = make({}, 2), a = w.agents.a, [s0, s1] = workers(w);
    a.reserve[s0!] = 1e-12; a.crop[s0!] = 0;
    a.born[s1!] = w.simTime() - a.lifespan[s1!]!;
    w.colony!.live(w);
    expect(w.agents.isAlive(s0!)).toBe(false);
    expect(w.agents.isAlive(s1!)).toBe(false);
    expect(w.colony!.died).toBe(2);
  });
});

describe('trophallaxis and feeding', () => {
  it('food flows from the fuller crop to the emptier at flowRate, down to the margin; total conserved', () => {
    const w = make({}, 2), a = w.agents.a, cc = w.config.colony, [s0, s1] = workers(w);
    a.crop[s0!] = 0.3; a.crop[s1!] = 0;
    w.colony!.give(w, s0!, s1!);
    expect(a.crop[s1!]).toBeCloseTo(cc.flowRate * w.config.sim.dt, 15);
    expect(a.crop[s0!]! + a.crop[s1!]!).toBeCloseTo(0.3, 15);
    for (let t = 0; t < 10000; t++) w.colony!.give(w, s0!, s1!);
    expect((a.crop[s0!]! - a.crop[s1!]!) / cc.crop).toBeLessThanOrEqual(cc.flowMargin + 1e-9);
    expect(a.crop[s0!]! + a.crop[s1!]!).toBeCloseTo(0.3, 12);
    // Not to an ant on the surface.
    a.flags[s1!] = a.flags[s1!]! & ~AgentFlag.UNDERGROUND;
    const before = a.crop[s0!];
    a.crop[s1!] = 0;
    w.colony!.give(w, s0!, s1!);
    expect(a.crop[s0!]).toBe(before);
  });

  it('a nurse feeds the hungriest larva within reach, from its crop', () => {
    const w = make({}, 20), a = w.agents.a, b = w.colony!.brood, cc = w.config.colony;
    const [s] = workers(w);
    // Stand the nurse on the queen's voxel, next to the brood.
    a.cell[s!] = a.cell[w.colony!.queen]!;
    a.crop[s!] = 0.2;
    let hungriest = -1;
    for (let i = 0; i < b.highWater; i++) {
      if (b.stage[i] !== BroodStage.LARVA) continue;
      b.gut[i] = cc.larvalGut; b.eaten[i] = 0;
      if (hungriest < 0) { hungriest = i; b.gut[i] = 0; }
    }
    const f0 = food(w);
    w.colony!.feed(w, s!, a.cell[s!]!);
    expect(b.gut[hungriest]).toBeCloseTo(cc.feedRate * w.config.sim.dt, 15);
    expect(food(w)).toBeCloseTo(f0, 12);
  });
});

describe('rationing', () => {
  it('a nurse feeds larvae only from what its crop holds above feedFill', () => {
    const w = make({}, 20), a = w.agents.a, b = w.colony!.brood, cc = w.config.colony;
    const [s] = workers(w);
    a.cell[s!] = a.cell[w.colony!.queen]!;
    for (let i = 0; i < b.highWater; i++) if (b.stage[i] === BroodStage.LARVA) { b.gut[i] = 0; b.eaten[i] = 0; }
    a.crop[s!] = cc.feedFill * cc.crop; // nothing to spare
    w.colony!.feed(w, s!, a.cell[s!]!);
    expect(a.crop[s!]).toBe(cc.feedFill * cc.crop);
    a.crop[s!] = cc.feedFill * cc.crop + 1e-6; // a little to spare: never below the line
    for (let t = 0; t < 10; t++) w.colony!.feed(w, s!, a.cell[s!]!);
    expect(a.crop[s!]).toBeCloseTo(cc.feedFill * cc.crop, 12);
  });
});

describe('brood', () => {
  it('egg → larva → (fed) pupa → worker; an unfed larva dies', () => {
    const w = make({ colony: { eggDays: [1, 1], larvaDays: [1, 1], pupaDays: [1, 1], larvalStarve: 0.5, layRate: 0, metabolism: 0 } }, 2);
    const c = w.colony!, b = c.brood, cc = w.config.colony;
    // Keep only one egg and one larva that will be left unfed.
    for (let i = 0; i < b.highWater; i++) b.remove(i);
    const cell = w.agents.a.cell[c.queen]!;
    const egg = b.add(BroodStage.EGG, cell, S_PER_DAY);
    const starving = b.add(BroodStage.LARVA, cell, S_PER_DAY);
    const before = w.agents.alive;
    const dt = w.config.sim.dt;
    let pupated = false, starved = false;
    for (let t = 0; t * dt < 4 * S_PER_DAY; t += 60) {
      for (let k = 0; k < 60; k++) {
        // Feed only the first larva: keep its gut full.
        if (b.stage[egg] === BroodStage.LARVA) b.gut[egg] = cc.larvalGut;
        c.live(w);
        w.tick++;
      }
      if (b.stage[egg] === BroodStage.PUPA) pupated = true;
      if (b.stage[starving] === BroodStage.NONE) starved = true;
    }
    expect(pupated).toBe(true);
    expect(starved).toBe(true);
    expect(c.eclosed).toBe(1);
    expect(w.agents.alive).toBe(before + 1);
    const s = w.agents.highWater - 1;
    expect(w.agents.a.cell[s]).toBe(cell);
    expect(w.simTime() - w.agents.a.born[s]!).toBeLessThan(1.5 * S_PER_DAY);
  });

  it('the queen lays at layRate × her reserve fill', () => {
    const w = make({ colony: { layRate: 2000, queenMetabolism: 0, absorb: 0, eggCost: 0 } }, 2), c = w.colony!, a = w.agents.a, cc = w.config.colony;
    a.reserve[c.queen] = cc.queenReserve / 2;
    const e0 = c.brood.countStage(BroodStage.EGG);
    const ticks = 60 * 3600;
    for (let t = 0; t < ticks; t++) { c.live(w); w.tick++; }
    const laid = c.brood.countStage(BroodStage.EGG) - e0;
    const expected = 2000 / 24 * 0.5; // per hour at half fill
    expect(laid).toBeGreaterThan(expected * 0.7);
    expect(laid).toBeLessThan(expected * 1.3);
  });
});

describe('response thresholds', () => {
  it('s² / (s² + θ²): half at s = θ, rising steeply', () => {
    expect(response(0, 0.5)).toBe(0);
    expect(response(0.5, 0.5)).toBeCloseTo(0.5, 12);
    expect(response(1, 0.5)).toBeCloseTo(0.8, 12);
  });

  it('young workers have a higher foraging threshold, old ones a higher nursing threshold', () => {
    const [fy, ny] = ageFactors(0, 3, 60), [fo, no] = ageFactors(300, 3, 60);
    expect(fy).toBeCloseTo(4, 12); expect(ny).toBeCloseTo(1, 12);
    expect(fo).toBeLessThan(1.03); expect(no).toBeGreaterThan(3.97);
  });

  it('thresholds fall while doing the task and rise otherwise, within thetaRange', () => {
    const w = make({ colony: { learn: 360, forget: 360, engageRate: 0 } }, 2), a = w.agents.a, [s0, s1] = workers(w);
    a.task[s0!] = Task.FORAGE;
    const f0 = a.thetaF[s0!]!, n0 = a.thetaN[s0!]!;
    tend(w, 0, w.agents.highWater);
    expect(a.thetaF[s0!]!).toBeCloseTo(f0 - 360 / S_PER_H * w.config.sim.dt, 12);
    expect(a.thetaN[s0!]!).toBeCloseTo(n0 + 360 / S_PER_H * w.config.sim.dt, 12);
    for (let t = 0; t < 600; t++) tend(w, 0, w.agents.highWater);
    const [lo, hi] = w.config.colony.thetaRange as readonly number[];
    expect(a.thetaF[s0!]).toBe(lo); expect(a.thetaN[s0!]).toBe(hi);
    expect(a.thetaF[s1!]).toBe(hi);
  });

  it('idle workers with no stimulus never take up a task; with a strong one and a low threshold they do', () => {
    const w = make({ colony: { crop: 1 } }, 40), a = w.agents.a;
    for (const s of workers(w)) { a.crop[s] = 1; a.hunger[s] = 0; }
    const run = (ticks: number): number => {
      let n = 0;
      for (let t = 0; t < ticks; t++) {
        a.request.fill(Request.NONE);
        tend(w, 0, w.agents.highWater); w.tick++;
      }
      for (const s of workers(w)) if (a.task[s] === Task.FORAGE) n++;
      return n;
    };
    expect(run(600)).toBe(0);
    for (const s of workers(w)) { a.crop[s] = 0; a.hunger[s] = 1; a.thetaF[s] = 0.05; a.born[s] = -300 * S_PER_DAY; a.state[s] = AgentState.DIG; }
    expect(run(60 * 1200)).toBeGreaterThan(20);
  });
});

describe('contacts', () => {
  it('a partner is a nestmate within contactRadius (from the last tick), or none', () => {
    const w = make({ colony: { contactInterval: 1 / 60 } }, 60), a = w.agents.a, idx = w.density!.contacts!;
    const r = w.config.colony.contactRadius;
    tend(w, 0, w.agents.highWater);
    let paired = 0;
    for (const s of workers(w)) {
      const p = a.partner[s]!;
      if (p < 0) continue;
      paired++;
      expect(p).not.toBe(s);
      let found = false;
      for (let e = 0; e < w.agents.highWater; e++) if (idx.slots[e] === p) {
        found = true;
        expect(Math.hypot(idx.x[e]! - a.posX[s]!, idx.y[e]! - a.posY[s]!, idx.z[e]! - a.posZ[s]!)).toBeLessThanOrEqual(r + 1e-4);
      }
      expect(found).toBe(true);
    }
    expect(paired).toBeGreaterThan(30); // crowded in the pit
  });
});

describe('the forager', () => {
  it('climbs out, finds the feeder, fills its crop, comes home and unloads to nestmates', () => {
    const w = make({ scenario: { feeders: [30, 0] }, colony: { engageRate: 0, unloadTime: 1e6 } }, 30), a = w.agents.a, cc = w.config.colony;
    const [s] = workers(w);
    a.task[s!] = Task.FORAGE; a.state[s!] = AgentState.EXIT; a.crop[s!] = 0;
    let out = -1, filled = -1, home = -1;
    for (let t = 0; t < 60 * 600 && home < 0; t++) {
      w.step();
      if (out < 0 && (a.flags[s!]! & AgentFlag.UNDERGROUND) === 0) out = t;
      // Full (less the little the crop passed on to its own gut in the same tick).
      if (filled < 0 && a.crop[s!]! > cc.crop * 0.999) { filled = t; expect(a.carryKind[s!]).toBe(CarryKind.FOOD); }
      if (filled >= 0 && a.state[s!] === AgentState.UNLOAD) home = t;
    }
    expect(out).toBeGreaterThan(0);
    expect(filled).toBeGreaterThan(out);
    expect(home).toBeGreaterThan(filled);
    expect(w.colony!.intake).toBeGreaterThan(cc.crop / 2); // it set out with a little food from nestmates
    const others = (): number => workers(w).filter((o) => o !== s).reduce((sum, o) => sum + a.crop[o]!, 0);
    const before = others();
    for (let t = 0; t < 60 * 120; t++) w.step();
    expect(others()).toBeGreaterThan(before); // nestmates got some of the load
  });
});

describe('nurses', () => {
  it('walk up the brood-demand gradient: they end up nearer the brood than idle workers', () => {
    // Without age zoning, which also draws young idle workers to the brood (ASM-NST-008).
    const w = make({ colony: { engageRate: 0, nurseQuit: 0 }, dig: { rate: 0, ageZonePull: 0 } }, 60), a = w.agents.a, soil = w.soil!;
    const ws = workers(w);
    for (const s of ws.slice(0, 30)) { a.task[s] = Task.NURSE; a.state[s] = AgentState.NURSE; }
    for (let t = 0; t < 60 * 300; t++) w.step();
    soil.unindex(a.cell[w.colony!.queen]!, v);
    const q = [soil.centreX(v[0]!), soil.centreY(v[1]!), soil.centreZ(v[2]!)];
    const dist = (s: number): number => Math.hypot(a.posX[s]! - q[0]!, a.posY[s]! - q[1]!, a.posZ[s]! - q[2]!);
    const mean = (xs: number[]): number => xs.reduce((p, x) => p + x, 0) / xs.length;
    const nurses = ws.slice(0, 30).filter((s) => a.state[s] === AgentState.NURSE).map(dist);
    const idle = ws.slice(30).filter((s) => a.state[s] === AgentState.DIG || a.state[s] === AgentState.NEST_REST).map(dist);
    expect(mean(nurses)).toBeLessThan(mean(idle) * 0.7);
  });
});

describe('conservation', () => {
  it('without metabolism, laying, feeders or deaths, the colony\'s food is constant (trophallaxis, feeding, absorption only move it)', () => {
    const w = make({ colony: { metabolism: 0, queenMetabolism: 0, layRate: 0, larvalStarve: 1e6 }, scenario: { feeders: [] } }, 60);
    const f0 = food(w);
    for (let t = 0; t < 60 * 600; t++) w.step();
    expect(w.colony!.fed).toBeGreaterThan(0);
    expect(food(w)).toBeCloseTo(f0, 9);
  });
});

describe('brood thermoregulation', () => {
  /** A colony whose soil gets warmer with depth: broodTemp is reached 20 mm down. */
  const graded = (env: boolean): World => {
    const w = make({ env: { enabled: env, updateInterval: 1e9 }, colony: { engageRate: 0, nurseQuit: 0 }, dig: { rate: 0, ageZonePull: 0 } }, 60);
    w.climate.update(w);
    const cc = w.config.colony;
    if (env) for (let z = 0; z < w.climate.temps.length; z++) w.climate.temps[z] = cc.broodTemp + 0.2 * (z - 20);
    const a = w.agents.a;
    for (const s of workers(w).slice(0, 40)) { a.task[s] = Task.NURSE; a.state[s] = AgentState.NURSE; }
    return w;
  };
  const stats = (w: World): { depth: number; off: number } => {
    const b = w.colony!.brood, soil = w.soil!;
    let depth = 0, off = 0, n = 0;
    for (let i = 0; i < b.highWater; i++) {
      if (b.stage[i] === BroodStage.NONE) continue;
      soil.unindex(b.cell[i]!, v);
      const y = soil.centreY(v[1]!);
      depth += -y; off += Math.abs(w.climate.tempAt(y) - w.config.colony.broodTemp); n++;
    }
    return { depth: depth / n, off: off / n };
  };

  it('nurses carry brood up the gradient towards broodTemp; none is lost', { timeout: 300000 }, () => {
    const w = graded(true), b = w.colony!.brood;
    const before = stats(w), count = b.count;
    for (let t = 0; t < 60 * 900; t++) w.step();
    const after = stats(w);
    expect(b.count).toBe(count);
    expect(after.depth).toBeLessThan(before.depth - 10);
    expect(after.off).toBeLessThan(before.off * 0.6);
    // Every carried item is held by a living nurse that knows it carries it.
    for (let i = 0; i < b.highWater; i++) {
      const c = b.carrier[i]!;
      if (c >= 0) { expect(w.agents.isAlive(c)).toBe(true); expect(w.agents.a.load[c]).toBe(i); }
    }
  });

  it('with the same temperature everywhere nothing is carried', () => {
    const w = graded(false);
    const before = stats(w);
    for (let t = 0; t < 60 * 120; t++) w.step();
    expect(stats(w).depth).toBe(before.depth);
  });

  it('a carrier that dies leaves its load where it fell', () => {
    const w = graded(true), a = w.agents.a, b = w.colony!.brood;
    const [s] = workers(w);
    a.cell[s!] = a.cell[w.colony!.queen]!;
    w.colony!.pick(w, s!, a.cell[s!]!);
    const i = a.load[s!]!;
    expect(i).toBeGreaterThanOrEqual(0);
    expect(b.carrier[i]).toBe(s);
    a.reserve[s!] = 1e-12; a.crop[s!] = 0;
    w.colony!.live(w);
    expect(w.agents.isAlive(s!)).toBe(false);
    expect(b.carrier[i]).toBe(-1);
    expect(b.cell[i]).toBe(a.cell[s!]);
  });
});

describe('timers', () => {
  it('coming out of the nest starts afresh: no search left over from unloading or carrying', () => {
    const w = make({}, 5), a = w.agents.a, [s] = workers(w);
    a.searchTime[s!] = 180; // e.g. the unloading timer of a forager back without food
    a.flags[s!] = a.flags[s!]! | AgentFlag.LOOP_BACK;
    surface(w, s!, 2, 1);
    expect(a.searchTime[s!]).toBe(0);
    expect(a.flags[s!]! & AgentFlag.LOOP_BACK).toBe(0);
    expect(a.piX[s!]).toBeCloseTo(2 - w.nest!.x, 9);
  });
});

describe('recruitment (BIO-COL-006, ASM-COL-014)', () => {
  it('a forager back from food that offers it to an idle nestmate recruits it', () => {
    const w = make({ colony: { recruitChance: 1 } }, 4), a = w.agents.a;
    const [f, n] = workers(w);
    a.state[f!] = AgentState.UNLOAD; a.task[f!] = Task.FORAGE; a.crop[f!] = 0.3;
    a.flags[f!] = a.flags[f!]! | AgentFlag.SUCCESS;
    a.state[n!] = AgentState.DIG; a.task[n!] = Task.IDLE; a.crop[n!] = 0;
    w.colony!.give(w, f!, n!);
    expect(a.task[n!]).toBe(Task.FORAGE);
    expect(a.state[n!]).toBe(AgentState.EXIT);
    expect(a.flags[n!]! & AgentFlag.RECRUIT).not.toBe(0);
    expect(w.colony!.recruited).toBe(1);
  });

  it('no recruitment without food from a successful trip, or to a nestmate busy with a task', () => {
    const w = make({ colony: { recruitChance: 1 } }, 4), a = w.agents.a;
    const [f, n, m] = workers(w);
    a.state[f!] = AgentState.UNLOAD; a.crop[f!] = 0.3; // back empty-handed: no SUCCESS
    a.crop[n!] = 0; a.state[n!] = AgentState.DIG;
    w.colony!.give(w, f!, n!);
    expect(a.flags[n!]! & AgentFlag.RECRUIT).toBe(0);
    a.flags[f!] = a.flags[f!]! | AgentFlag.SUCCESS;
    a.crop[m!] = 0; a.task[m!] = Task.NURSE; a.state[m!] = AgentState.NURSE;
    w.colony!.give(w, f!, m!);
    expect(a.task[m!]).toBe(Task.NURSE);
  });

  it('in a colony only foragers carrying food lay trail, and only recruits follow it', () => {
    const w = make({ scenario: { feeders: [] } }, 6), a = w.agents.a, f = w.pheromone!;
    const [s0, s1, s2] = workers(w);
    for (const s of [s0!, s1!, s2!]) {
      a.flags[s] = a.flags[s]! & ~AgentFlag.UNDERGROUND; a.cell[s] = -1;
      a.posX[s] = 50; a.posZ[s] = 0; a.heading[s] = 0; a.state[s] = AgentState.SEARCH;
    }
    a.carryKind[s0!] = CarryKind.FOOD; a.state[s0!] = AgentState.RETURN;
    a.lastStep[s0!] = 1; a.lastStep[s1!] = 1;
    layTrail(w, 0, w.agents.highWater);
    expect(a.deposit[s0!]).toBeGreaterThan(0);
    expect(a.deposit[s1!]).toBe(0); // searching: no trail
    // A trail off to the left of the ants' heading.
    for (let x = 40; x < 70; x += 0.5) f.deposit(x, -1.5, 50);
    a.flags[s2!] = a.flags[s2!]! | AgentFlag.RECRUIT;
    trail(w, 0, w.agents.highWater);
    expect(a.steer[s1!]).toBe(0);
    expect(a.steer[s2!]).not.toBe(0);
  });
});
