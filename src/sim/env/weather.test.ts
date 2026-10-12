/**
 * Reproduction tests for rain and water drops (Phase 7): PHY-ENV-003/004,
 * BIO-ENV-003/004, ASM-ENV-003…006.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildConfig, type Overlay } from '../../config/load.ts';
import { AgentFlag, AgentState } from '../agents/store.ts';
import { World } from '../world.ts';

const field = JSON.parse(readFileSync('config/presets/field.json', 'utf8')) as Overlay;
/** Open ground, environment on, a constant temperature (startHour 10). */
const ground = (extra: Overlay = {}, count = 50): World =>
  new World(buildConfig([{ population: { count }, env: { enabled: true, startHour: 10, surfaceAmplitude: 0, meanTemp: 25 } }, extra]).config);

describe('drops', () => {
  it('evaporate with d(r²)/dt constant: a 1 mm drop lasts dropLifetime at the reference temperature and dry humidity', () => {
    const w = ground({}, 1), d = w.drops!;
    d.add(50, 50, 1, 0); d.reindex();
    const life = w.config.env.dropLifetime, dt = w.config.sim.dt;
    let t = 0;
    while (d.count > 0 && t < 2 * life) { w.step(); t += dt; }
    expect(t / life).toBeCloseTo(1, 1);
  });

  it('evaporate twice as fast 11 °C warmer, and not at all in saturated air (rain)', () => {
    const shrink = (extra: Overlay): number => {
      const w = ground(extra, 1), d = w.drops!;
      d.add(50, 50, 1, 0); d.reindex();
      for (let t = 0; t < 600 * 60; t++) w.step();
      return d.count ? 1 - d.r[0]! * d.r[0]! : 1;
    };
    expect(shrink({ env: { meanTemp: 36 } }) / shrink({})).toBeCloseTo(2, 1);
    expect(shrink({ env: { rain: [0, 1, 0.001], dropForm: 0 } })).toBe(0);
  });

  it('form in rain on leaves and stones only, never on bare soil, and merge up to dropMaxRadius', () => {
    const w = ground({ env: { rain: [0, 1, 60], dropForm: 0.05 } }, 1), d = w.drops!;
    for (let t = 0; t < 60 * 60; t++) w.step();
    expect(d.count).toBeGreaterThan(20);
    for (let k = 0; k < d.count; k++) {
      expect(w.terrain.supportHeight(d.x[k]!, d.z[k]!) - w.terrain.groundHeight(d.x[k]!, d.z[k]!)).toBeGreaterThanOrEqual(w.config.env.dropSurface);
      expect(d.r[k]).toBeLessThanOrEqual(w.config.env.dropMaxRadius + 1e-6);
    }
  });

  it('ants walk round drops: none steps from dry ground into one', () => {
    const w = ground({}, 200), d = w.drops!, a = w.agents.a;
    // A ring of drops round the middle of the arena.
    for (let k = 0; k < 40; k++) d.add(40 * Math.cos(k * 0.157), 40 * Math.sin(k * 0.157), 2.5, 0);
    d.reindex();
    // Count steps from dry ground into water (ants placed under a drop by the set-up do not count).
    let entered = 0, near = 0;
    const wet = (s: number): boolean => d.at(a.posX[s]!, a.posZ[s]!) >= 0;
    let was = Array.from({ length: 200 }, (_, s) => wet(s));
    for (let t = 0; t < 60 * 60; t++) {
      w.step();
      const now = Array.from({ length: 200 }, (_, s) => wet(s));
      for (let s = 0; s < 200; s++) {
        if (now[s] && !was[s]) entered++;
        if (!now[s] && Math.abs(Math.hypot(a.posX[s]!, a.posZ[s]!) - 40) < 5) near++;
      }
      was = now;
    }
    expect(near).toBeGreaterThan(1000); // they do come up to the ring
    expect(entered).toBe(0);
  });
});

describe('rain on ants', () => {
  it('raindrops hit ants on the surface at the rate of drops falling on their footprint, pushing and dazing them', () => {
    const mmh = 50;
    const w = ground({ env: { rain: [0, 1, mmh], dropForm: 0 } }, 400), a = w.agents.a, e = w.config.env;
    const dt = w.config.sim.dt, L = w.config.ant.workerBodyLength;
    let hits = 0;
    const T = 60 * 120;
    for (let t = 0; t < T; t++) {
      const before = Array.from(a.stun.subarray(0, 400));
      w.step();
      for (let s = 0; s < 400; s++) if (a.stun[s]! > before[s]! + dt) hits++;
    }
    const expected = (mmh / 3600 / ((Math.PI / 6) * e.rainDrop ** 3)) * L * L * e.antWidth * 400 * T * dt;
    expect(hits / expected).toBeGreaterThan(0.7);
    expect(hits / expected).toBeLessThan(1.3);
  });

  it('a colony stops foraging in rain: searchers turn home and nobody sets out', { timeout: 600000 }, () => {
    const w = new World(buildConfig([field, { population: { count: 80 }, soil: { size: [128, 256, 128] }, colony: { engageRate: 0.05 }, env: { startHour: 10, rain: [0.25, 1, 10] } }]).config);
    const a = w.agents.a;
    const searching = (): number => {
      let n = 0;
      for (let s = 0; s < w.agents.highWater; s++) if ((a.flags[s]! & (AgentFlag.ALIVE | AgentFlag.UNDERGROUND)) === AgentFlag.ALIVE && a.state[s] === AgentState.SEARCH) n++;
      return n;
    };
    let before = 0;
    for (let t = 0; t < 60 * 900; t++) { w.step(); before = Math.max(before, searching()); }
    expect(before).toBeGreaterThan(0);
    for (let t = 0; t < 60 * 60; t++) w.step(); // a minute into the rain
    let exits = 0;
    for (let t = 0; t < 60 * 120; t++) {
      w.step();
      expect(searching()).toBe(0);
      for (let s = 0; s < w.agents.highWater; s++) if (a.state[s] === AgentState.EXIT) exits++;
    }
    expect(exits).toBe(0);
  });

  it('rain washes trail pheromone away faster', () => {
    const left = (rain: boolean): number => {
      const w = new World(buildConfig([field, { population: { count: 10 }, soil: { size: [128, 256, 128] } }, { env: { startHour: 2, rain: rain ? [0, 1, 5] : [] } }]).config);
      const f = w.pheromone!;
      for (let x = 10; x < 100; x++) f.deposit(x, 30, 10);
      const t0 = f.total();
      for (let t = 0; t < 60 * 300; t++) w.step();
      return f.total() / t0;
    };
    expect(left(true)).toBeLessThan(left(false) * 0.6);
  });
});
