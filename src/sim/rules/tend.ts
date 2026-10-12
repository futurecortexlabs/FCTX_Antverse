/**
 * Division of labour and contacts in the nest (Phase 6).
 *
 * Contacts: every colony.contactInterval each worker in the nest picks one
 * nestmate within colony.contactRadius at random — from the contact index
 * of the last tick, so no thread reads positions another is writing — and
 * keeps it as its partner (ASM-COL-007). Food flows crop to crop between
 * partners down the difference in fill (trophallaxis; requested here,
 * granted in World.completeStep). Touching a partner also tells a worker how
 * empty the colony's crops are: its perceived hunger is the crop emptiness of
 * itself and its partners, averaged over colony.hungerMemory (ASM-COL-010).
 *
 * Tasks (response thresholds; Bonabeau et al. 1996, BIO-COL-002): an idle
 * worker in the nest takes up foraging at engageRate × s² / (s² + θ²) per
 * second with s its perceived hunger, and nursing likewise with s the unfed
 * larval food around it (brood demand). Thresholds fall while a worker does
 * the task and rise while it does not (Theraulaz et al. 1998, BIO-COL-003),
 * and shift with age: young workers respond less to hunger, old ones less to
 * brood (age polyethism, ASM-COL-009). A forager back in the nest unloads its
 * crop to nestmates and then goes out again with the same response
 * probability to its current hunger, or returns to idling; a nurse gives up
 * at a constant rate (ASM-COL-008).
 */

import { dexp } from '../../core/dmath.ts';
import { rand, Stream } from '../../core/rng.ts';
import { S_PER_DAY, S_PER_H } from '../../core/units.ts';
import { AgentFlag, AgentState, Caste, Request, Task } from '../agents/store.ts';
import type { World } from '../world.ts';

/** Sub-keys of Stream.TASK. */
export const TaskKey = { ENGAGE: 0, QUIT: 1, CONTINUE: 2 } as const;

const v = new Int32Array(3);

/** Response probability to stimulus s with threshold θ: s² / (s² + θ²). */
export function response(s: number, theta: number): number {
  const s2 = s * s;
  return s2 + theta * theta > 0 ? s2 / (s2 + theta * theta) : 0;
}

/** Age factors of the foraging and nursing thresholds (ASM-COL-009). */
export function ageFactors(ageDays: number, gain: number, scale: number): [number, number] {
  const young = dexp(-ageDays / scale);
  return [1 + gain * young, 1 + gain * (1 - young)];
}

export function tend(world: World, from: number, to: number): void {
  const colony = world.colony;
  if (!colony) return;
  const { config } = world;
  const cc = config.colony, dt = config.sim.dt;
  const a = world.agents.a, soil = world.soil!, density = world.density!, idx = density.contacts!;
  const every = Math.max(1, Math.round(cc.contactInterval / dt));
  const blend = Math.min(1, (every * dt) / cc.hungerMemory);
  const r2 = cc.contactRadius * cc.contactRadius;
  const learn = (cc.learn / S_PER_H) * dt, forget = (cc.forget / S_PER_H) * dt;
  const [tmin, tmax] = cc.thetaRange as readonly [number, number];
  const now = world.simTime();
  const c = density.cell;

  for (let s = from; s < to; s++) {
    if ((a.flags[s]! & AgentFlag.ALIVE) === 0 || a.caste[s] !== Caste.WORKER) continue;
    // Reinforcement of the thresholds, wherever the worker is.
    const task = a.task[s]!;
    a.thetaF[s] = Math.min(tmax, Math.max(tmin, a.thetaF[s]! + (task === Task.FORAGE ? -learn : forget)));
    a.thetaN[s] = Math.min(tmax, Math.max(tmin, a.thetaN[s]! + (task === Task.NURSE ? -learn : forget)));
    if ((a.flags[s]! & AgentFlag.UNDERGROUND) === 0) continue;
    soil.unindex(a.cell[s]!, v);
    const ix = v[0]!, d = v[1]!, iz = v[2]!;

    if ((world.tick + s) % every === 0) {
      // Pick a nestmate in contact: count them, then take the k-th.
      const x = a.posX[s]!, y = a.posY[s]!, z = a.posZ[s]!;
      const cx = Math.floor(ix / c), cd = Math.floor(d / c), cz = Math.floor(iz / c);
      let n = 0, pick = -1;
      for (let pass = 0; pass < 2; pass++) {
        let k = pass === 0 ? -1 : Math.floor(rand(world.seed, Stream.CONTACT, s, world.tick) * n);
        for (let gz = Math.max(0, cz - 1); gz <= Math.min(density.cz - 1, cz + 1) && pick < 0; gz++) {
          for (let gy = Math.max(0, cd - 1); gy <= Math.min(density.cd - 1, cd + 1) && pick < 0; gy++) {
            for (let gx = Math.max(0, cx - 1); gx <= Math.min(density.cx - 1, cx + 1) && pick < 0; gx++) {
              const key = (gz * density.cd + gy) * density.cx + gx;
              const e0 = idx.start[key]!;
              if (e0 < 0) continue;
              const e1 = e0 + density.counts[key]!;
              for (let e = e0; e < e1; e++) {
                const o = idx.slots[e]!;
                if (o === s) continue;
                const ex = idx.x[e]! - x, ey = idx.y[e]! - y, ez = idx.z[e]! - z;
                if (ex * ex + ey * ey + ez * ez > r2) continue;
                if (pass === 0) n++;
                else if (k-- === 0) { pick = o; break; }
              }
            }
          }
        }
        if (n === 0) break;
      }
      a.partner[s] = pick;
      const own = 1 - a.crop[s]! / cc.crop;
      const seen = pick >= 0 ? (own + 1 - a.crop[pick]! / cc.crop) / 2 : own;
      a.hunger[s] = a.hunger[s]! + (seen - a.hunger[s]!) * blend;
    }

    const state = a.state[s]!;
    // Requests (digging, granted first, takes precedence).
    if (a.request[s] === Request.NONE) {
      const p = a.partner[s]!;
      if (state === AgentState.NURSE && a.crop[s]! > cc.feedFill * cc.crop && density.demandAround(ix, d, iz) > 0) {
        a.request[s] = Request.FEED;
        a.requestCell[s] = a.cell[s]!;
      } else if (p >= 0 && (a.crop[s]! - a.crop[p]!) / cc.crop > cc.flowMargin) {
        a.request[s] = Request.GIVE;
        a.requestCell[s] = p;
      }
    }

    // Tasks.
    const age = (now - a.born[s]!) / S_PER_DAY;
    const [fF, fN] = ageFactors(age, cc.ageGain, cc.ageScale);
    if (task === Task.IDLE && (state === AgentState.DIG || state === AgentState.NEST_REST)) {
      const dem = density.demandAround(ix, d, iz);
      // Foraging only by day and in tolerable surface temperatures (env, BIO-ENV-002).
      const pF = world.climate.foraging ? cc.engageRate * dt * response(a.hunger[s]!, a.thetaF[s]! * fF) : 0;
      const pN = cc.engageRate * dt * response(dem / (dem + cc.broodHalf), a.thetaN[s]! * fN);
      const u = rand(world.seed, Stream.TASK, s, world.tick, TaskKey.ENGAGE);
      if (u < pF) { a.task[s] = Task.FORAGE; a.state[s] = AgentState.EXIT; }
      else if (u < pF + pN) { a.task[s] = Task.NURSE; a.state[s] = AgentState.NURSE; }
    } else if (state === AgentState.EXIT && !world.climate.foraging) {
      // On the way out when it gets dark (or too hot / cold): stay in.
      a.task[s] = Task.IDLE; a.state[s] = AgentState.DIG;
    } else if (state === AgentState.NURSE) {
      if (rand(world.seed, Stream.TASK, s, world.tick, TaskKey.QUIT) < cc.nurseQuit * dt) { a.task[s] = Task.IDLE; a.state[s] = AgentState.DIG; }
    } else if (state === AgentState.UNLOAD && (a.crop[s]! <= cc.unloadedFill * cc.crop || (a.searchTime[s] = a.searchTime[s]! + dt) >= cc.unloadTime)) {
      if (world.climate.foraging && rand(world.seed, Stream.TASK, s, world.tick, TaskKey.CONTINUE) < response(a.hunger[s]!, a.thetaF[s]! * fF)) a.state[s] = AgentState.EXIT;
      else { a.task[s] = Task.IDLE; a.state[s] = AgentState.DIG; }
    }
  }
}
