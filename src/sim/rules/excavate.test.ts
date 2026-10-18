/**
 * Reproduction tests for nest excavation (Phase 5): walking in the soil
 * (ASM-NST-003), digging regulated by crowding and body clearance
 * (ASM-NST-001/002/006), the haul–dump–reenter cycle (ASM-NST-004) and the
 * conservation of soil.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildConfig, type Overlay } from '../../config/load.ts';
import { AgentFlag, AgentState, CarryKind, Request } from '../agents/store.ts';
import { World } from '../world.ts';
import { burrow, enterSoil, isExcavator, nearWall, standable } from './burrow.ts';
import { digResponse, excavate } from './excavate.ts';

const preset = JSON.parse(readFileSync('config/presets/digging.json', 'utf8')) as Overlay;
const small: Overlay = { soil: { size: [96, 160, 96] } };
const make = (extra: Overlay = {}, count = 1): World => new World(buildConfig([preset, small, { population: { count } }, extra]).config);
const v = new Int32Array(3);

/** Put ant 0 into the soil at the entrance. */
function enter(w: World): void {
  const a = w.agents.a, nest = w.nest!;
  a.state[0] = AgentState.REENTER;
  a.posX[0] = nest.x; a.posZ[0] = nest.z;
  excavate(w, 0, 1);
}

describe('walking in the soil', () => {
  it('a worker reaching the entrance goes down into the nest', () => {
    const w = make(), a = w.agents.a;
    enter(w);
    expect(a.flags[0]! & AgentFlag.UNDERGROUND).not.toBe(0);
    expect(a.state[0]).toBe(AgentState.DIG);
    w.soil!.unindex(a.cell[0]!, v);
    expect(w.soil!.isDug(v[0]!, v[1]!, v[2]!)).toBe(true);
  });

  it('underground, a worker only ever stands in dug space near a wall, and never leaves through the top without a load', () => {
    const w = make({ dig: { rate: 0 } }, 30), a = w.agents.a, soil = w.soil!;
    // A tunnel network to walk in: dig a 3 × 3 shaft and a side gallery.
    const cx = soil.voxelX(0), cz = soil.voxelZ(0), top = soil.airTop[cx + cz * soil.nx]!;
    for (let d = top; d < top + 30; d++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) soil.dig(cx + dx, d, cz + dz);
    for (let x = cx; x < cx + 20; x++) for (let d = top + 27; d < top + 30; d++) soil.dig(x, d, cz);
    for (let s = 0; s < 30; s++) { a.state[s] = AgentState.REENTER; a.posX[s] = 0; a.posZ[s] = 0; }
    excavate(w, 0, 30);
    let bad = 0, deepest = 0;
    for (let t = 0; t < 1800; t++) {
      w.step();
      for (let s = 0; s < 30; s++) {
        expect(a.flags[s]! & AgentFlag.UNDERGROUND).not.toBe(0);
        soil.unindex(a.cell[s]!, v);
        if (!nearWall(soil, v[0]!, v[1]!, v[2]!) && !standable(soil, v[0]!, v[1]!, v[2]!)) bad++;
        deepest = Math.max(deepest, v[1]! - top);
      }
    }
    expect(bad).toBe(0);
    expect(deepest).toBeGreaterThan(20); // they explore the whole shaft
  });

  it('the memoised wall tests (Soil.memoGet) always equal a fresh evaluation, however the soil was dug since', () => {
    const w = make({ dig: { rate: 0 } }), soil = w.soil!;
    const fresh = make({ dig: { rate: 0 } }).soil!;
    const cx = soil.voxelX(0), cz = soil.voxelZ(0), top = soil.airTop[cx + cz * soil.nx]!;
    const probe = (): void => {
      for (let d = top; d < top + 12; d++) for (let z = cz - 4; z <= cz + 4; z++) for (let x = cx - 4; x <= cx + 4; x++) {
        expect(nearWall(soil, x, d, z)).toBe(nearWall(fresh, x, d, z));
        expect(standable(soil, x, d, z)).toBe(standable(fresh, x, d, z));
      }
    };
    probe(); // fill the memo
    // Dig into `soil` (whose memo must be invalidated) and the same voxels into a soil without a memo.
    const dug: [number, number, number][] = [];
    for (let k = 0; k < 24; k++) {
      const x = cx + ((k * 5) % 7) - 3, d = top + 2 + ((k * 3) % 8), z = cz + ((k * 2) % 7) - 3;
      soil.dig(x, d, z);
      dug.push([x, d, z]);
      const f = make({ dig: { rate: 0 } }).soil!;
      for (const [px, pd, pz] of dug) f.dig(px, pd, pz);
      for (let dd = top; dd < top + 12; dd++) for (let zz = cz - 4; zz <= cz + 4; zz++) for (let xx = cx - 4; xx <= cx + 4; xx++) {
        expect(nearWall(soil, xx, dd, zz)).toBe(nearWall(f, xx, dd, zz));
      }
    }
  });

  it('a worker carrying soil climbs out of the nest', () => {
    const w = make({ dig: { rate: 0 } }), a = w.agents.a, soil = w.soil!;
    const cx = soil.voxelX(0), cz = soil.voxelZ(0), top = soil.airTop[cx + cz * soil.nx]!;
    for (let d = top; d < top + 25; d++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) soil.dig(cx + dx, d, cz + dz);
    enter(w);
    a.cell[0] = soil.index(cx + 1, top + 24, cz);
    a.posY[0] = soil.centreY(top + 24);
    a.state[0] = AgentState.HAUL;
    a.carryKind[0] = CarryKind.SOIL;
    let out = -1;
    for (let t = 0; t < 600 && out < 0; t++) { w.step(); if ((a.flags[0]! & AgentFlag.UNDERGROUND) === 0) out = t; }
    expect(out).toBeGreaterThan(0);
    expect(out * w.config.sim.dt).toBeLessThan(5); // 25 mm up at walking speed, with detours
    // On the ground (the surface body pose then smooths the height within a hundredth of a mm).
    expect(a.posY[0]).toBeCloseTo(w.terrain.supportHeight(a.posX[0]!, a.posZ[0]!) + w.config.locomotion.rideHeight, 2);
  });
});

describe('digging', () => {
  it('digs only with nestmates around: the response rises steeply with crowding', () => {
    expect(digResponse(0, 1, 4)).toBe(0);
    expect(digResponse(1, 1, 4)).toBeCloseTo(0.5, 9);
    expect(digResponse(0.5, 1, 4)).toBeCloseTo(1 / 17, 9);
    expect(digResponse(2, 1, 4)).toBeCloseTo(16 / 17, 9);
  });

  it('a lone worker at a soil face never digs; one among crowded nestmates does', () => {
    const lone = make({ dig: { rate: 10 } }), la = lone.agents.a;
    enter(lone);
    let dug = 0;
    for (let t = 0; t < 600; t++) { lone.step(); if (la.carryKind[0] === CarryKind.SOIL) dug++; }
    expect(dug).toBe(0);
    const crowd = make({ dig: { rate: 10 } }, 40), ca = crowd.agents.a;
    for (let s = 0; s < 40; s++) { ca.state[s] = AgentState.REENTER; ca.posX[s] = 0; ca.posZ[s] = 0; }
    excavate(crowd, 0, 40);
    crowd.completeStep(); // count them in the density grid
    let carriers = 0;
    for (let t = 0; t < 120; t++) { crowd.step(); for (let s = 0; s < 40; s++) if (ca.carryKind[s] === CarryKind.SOIL) carriers++; }
    expect(carriers).toBeGreaterThan(0);
  });

  it('two requests for the same voxel in one tick: the first slot gets it, the second gets nothing', () => {
    const w = make({}, 2), a = w.agents.a, soil = w.soil!;
    for (const s of [0, 1]) { a.state[s] = AgentState.REENTER; a.posX[s] = 0; a.posZ[s] = 0; }
    excavate(w, 0, 2);
    const cx = soil.voxelX(0), cz = soil.voxelZ(0), d = soil.airTop[cx + cz * soil.nx]! + 4;
    for (const s of [0, 1]) { a.request[s] = Request.DIG; a.requestCell[s] = soil.index(cx, d, cz); }
    const before = soil.dug;
    w.completeStep();
    expect(soil.dug).toBe(before + 1);
    expect(a.carryKind[0]).toBe(CarryKind.SOIL);
    expect(a.state[0]).toBe(AgentState.HAUL);
    expect(a.carryKind[1]).toBe(CarryKind.NONE);
    expect(a.state[1]).toBe(AgentState.DIG);
  });

  it('every pellet dug is either carried or on the mound (exact), and the dug space stays connected to the entrance', () => {
    const w = make({}, 60), a = w.agents.a, soil = w.soil!;
    for (let t = 0; t < 60 * 120; t++) w.step();
    let carried = 0;
    for (let s = 0; s < 60; s++) if (a.carryKind[s] === CarryKind.SOIL) carried++;
    expect(soil.dug - w.pitVoxels).toBeGreaterThan(30);
    expect(soil.dug - w.pitVoxels).toBe(w.mound!.pellets + carried);
    expect(w.mound!.volume()).toBeCloseTo(w.mound!.pellets * w.config.soil.pellet, 0);
    // Flood fill the dug voxels from the entrance (26-connected, as the workers move).
    const cx = soil.voxelX(0), cz = soil.voxelZ(0);
    const start = soil.index(cx, soil.airTop[cx + cz * soil.nx]!, cz);
    const seen = new Set<number>([start]);
    const stack = [start];
    while (stack.length) {
      soil.unindex(stack.pop()!, v);
      const [x, d, z] = [v[0]!, v[1]!, v[2]!];
      for (let dz = -1; dz <= 1; dz++) for (let dd = -1; dd <= 1; dd++) for (let dx = -1; dx <= 1; dx++) {
        if (soil.isDug(x + dx, d + dd, z + dz)) {
          const k = soil.index(x + dx, d + dd, z + dz);
          if (!seen.has(k)) { seen.add(k); stack.push(k); }
        }
      }
    }
    expect(seen.size).toBe(soil.dug);
  });

  it('a hauler drops its pellet once dumpAt from the entrance and heads back', () => {
    const w = make(), a = w.agents.a;
    a.state[0] = AgentState.HAUL; a.carryKind[0] = CarryKind.SOIL; a.flags[0] = a.flags[0]! & ~AgentFlag.UNDERGROUND; a.cell[0] = -1;
    a.dumpAt[0] = 20;
    a.posX[0] = 10; a.posZ[0] = 0; a.piX[0] = 10; a.piZ[0] = 0;
    excavate(w, 0, 1);
    expect(a.request[0]).toBe(Request.NONE); // not far enough yet
    a.posX[0] = 21; a.piX[0] = 21;
    excavate(w, 0, 1);
    expect(a.request[0]).toBe(Request.DROP);
    w.completeStep();
    expect(w.mound!.pellets).toBe(1);
    expect(a.state[0]).toBe(AgentState.REENTER);
    expect(a.carryKind[0]).toBe(CarryKind.NONE);
    burrow(w, 0, 1); // not underground: burrow leaves it alone
    expect(a.flags[0]! & AgentFlag.UNDERGROUND).toBe(0);
  });
});

describe('two kinds of digging: tunnels and chambers (ASM-NST-009/010)', () => {
  /** Dig a box of voxels [x0, x1) × [d0, d1) × [z0, z1) around the entrance column (offsets from it, depth from the surface). */
  const box = (w: World, x0: number, x1: number, d0: number, d1: number, z0: number, z1: number): void => {
    const soil = w.soil!, cx = soil.voxelX(0), cz = soil.voxelZ(0), top = soil.airTop[cx + cz * soil.nx]!;
    for (let d = top + d0; d < top + d1; d++) for (let z = cz + z0; z < cz + z1; z++) for (let x = cx + x0; x < cx + x1; x++) soil.dig(x, d, z);
  };
  /** Put workers 0..n-1 into the soil at (dx, depth, dz) from the entrance column. */
  const place = (w: World, n: number, dx: number, depth: number, dz: number): void => {
    const soil = w.soil!, cx = soil.voxelX(0), cz = soil.voxelZ(0), top = soil.airTop[cx + cz * soil.nx]!;
    for (let s = 0; s < n; s++) enterSoil(w, s, cx + dx, top + depth, cz + dz);
  };
  /** Dug voxels outside the boxes dug by hand, by depth below the surface at the entrance (as the boxes). */
  const newlyDug = (w: World, before: Set<number>): number[] => {
    const soil = w.soil!, out: number[] = [];
    const top = soil.airTop[soil.voxelX(0) + soil.voxelZ(0) * soil.nx]!;
    for (let d = 0; d < soil.nd; d++) for (let z = 0; z < soil.nz; z++) for (let x = 0; x < soil.nx; x++) {
      if (soil.isDug(x, d, z) && !before.has(soil.index(x, d, z))) out.push(d - top);
    }
    return out;
  };
  const dugSet = (w: World): Set<number> => {
    const soil = w.soil!, s = new Set<number>();
    for (let d = 0; d < soil.nd; d++) for (let z = 0; z < soil.nz; z++) for (let x = 0; x < soil.nx; x++) if (soil.isDug(x, d, z)) s.add(soil.index(x, d, z));
    return s;
  };

  it('about excavatorShare of the workers are excavators, fixed per slot', () => {
    const w = make({}, 1);
    let n = 0;
    for (let s = 0; s < 2000; s++) if (isExcavator(w, s)) n++;
    expect(n / 2000).toBeCloseTo(w.config.dig.excavatorShare, 1);
    expect(isExcavator(w, 7)).toBe(isExcavator(w, 7));
  });

  it('at the quiet tip of a shaft an excavator with a drive digs, mostly downwards; any other worker there never digs', () => {
    const w = make({ dig: { rate: 10 } }, 64), a = w.agents.a, soil = w.soil!;
    box(w, -1, 2, 0, 20, -1, 2); // a 3 × 3 shaft, 20 mm deep
    const exc = Array.from({ length: 64 }, (_, s) => s).find((s) => isExcavator(w, s))!;
    const other = Array.from({ length: 64 }, (_, s) => s).find((s) => !isExcavator(w, s))!;
    const cx = soil.voxelX(0), cz = soil.voxelZ(0), top = soil.airTop[cx + cz * soil.nx]!;
    let down = 0, side = 0, otherDigs = 0;
    for (let t = 0; t < 2000; t++) {
      for (const s of [exc, other]) {
        enterSoil(w, s, cx + 1, top + 19, cz + 1); // in a corner of the tip: cramped
        a.digDrive[s] = 1; a.request[s] = Request.NONE;
      }
      excavate(w, Math.min(exc, other), Math.max(exc, other) + 1);
      if (a.request[other] === Request.DIG) otherDigs++;
      if (a.request[exc] === Request.DIG) {
        soil.unindex(a.requestCell[exc]!, v);
        if (v[1]! > top + 19) down++; else side++;
      }
    }
    expect(otherDigs).toBe(0);
    expect(down + side).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(side);
  });

  it('a crowd in a low chamber widens it sideways: never its floor, never its ceiling once chamberHeight tall', () => {
    const h = 5;
    const w = make({ dig: { rate: 2, excavatorShare: 0, chamberHeight: h } }, 40);
    box(w, -1, 2, 0, 10, -1, 2); // shaft
    box(w, -5, 6, 10, 10 + h, -5, 6); // an 11 × 11 chamber, h tall
    const before = dugSet(w);
    place(w, 40, 0, 10 + h - 1, 0);
    w.completeStep();
    for (let t = 0; t < 60 * 120; t++) w.step();
    const depths = newlyDug(w, before);
    expect(depths.length).toBeGreaterThan(0);
    for (const d of depths) { expect(d).toBeGreaterThanOrEqual(10); expect(d).toBeLessThan(10 + h); }
  });

  it('a crowd in a tall shaft does not widen it (no excavators, no brood)', () => {
    const w = make({ dig: { rate: 2, excavatorShare: 0 } }, 30);
    box(w, -1, 2, 0, 40, -1, 2);
    const before = dugSet(w);
    place(w, 30, 0, 30, 0);
    w.completeStep();
    for (let t = 0; t < 60 * 120; t++) w.step();
    expect(newlyDug(w, before).length).toBe(0);
  });
});

describe('soil moisture and digging (BIO-NST-003)', () => {
  const dug = (moisture: number): number => {
    const w = make({ env: { enabled: true, deepMoisture: moisture }, dig: { rate: 2 } }, 40), a = w.agents.a;
    for (let s = 0; s < 40; s++) { a.state[s] = AgentState.REENTER; a.posX[s] = 0; a.posZ[s] = 0; }
    excavate(w, 0, 40);
    w.completeStep();
    for (let t = 0; t < 60 * 60; t++) w.step();
    return w.soil!.dug - w.pitVoxels;
  };

  it('nothing is dug in air-dry soil; the most at the optimum moisture; less in very wet soil', () => {
    const [dry, opt] = make().config.dig.moistureDig as readonly [number, number];
    const sat = (make().config.env.moistureRange as readonly number[])[1]!;
    expect(dug(dry - 0.01)).toBe(0);
    const best = dug(opt), wet = dug(sat - 0.02);
    expect(best).toBeGreaterThan(0);
    expect(wet).toBeLessThan(best);
  });
});

