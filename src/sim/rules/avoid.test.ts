/**
 * Reproduction tests for collision avoidance on the surface (ASM-SOC-001).
 */

import { describe, expect, it } from 'vitest';
import { buildConfig, type Overlay } from '../../config/load.ts';
import { AgentStore } from '../agents/store.ts';
import { World } from '../world.ts';
import { avoid } from './avoid.ts';

const flat: Overlay = { terrain: { pebbleDensity: 0, leafDensity: 0, grainDensity: 0 } };
const make = (collide: boolean, count: number, extra: Overlay = {}): World =>
  new World(buildConfig([flat, { population: { count }, explore: { collide } }, extra]).config);

describe('collision avoidance', () => {
  it('a nestmate ahead on the right makes an ant turn left; one behind or out of reach does nothing', () => {
    const w = make(true, 2), a = w.agents.a, L = w.config.ant.workerBodyLength;
    a.posX[0] = 0; a.posZ[0] = 0; a.heading[0] = 0; // facing +X; its right is +Z
    a.posX[1] = 0.5 * L; a.posZ[1] = 0.2 * L;
    a.posX[1] = 0.5 * L;
    w.completeStep(); // index the positions
    a.steer[0] = 0;
    avoid(w, 0, 1);
    expect(a.steer[0]).toBeGreaterThan(0);
    a.posX[1] = -0.5 * L; w.completeStep(); a.steer[0] = 0; avoid(w, 0, 1);
    expect(a.steer[0]).toBe(0);
    a.posX[1] = 3 * L; w.completeStep(); a.steer[0] = 0; avoid(w, 0, 1);
    expect(a.steer[0]).toBe(0);
  });

  it('crowded ants overlap far less with avoidance than without', () => {
    const overlap = (collide: boolean): number => {
      const w = make(collide, 400, { world: { arenaSize: 120 } }), a = w.agents.a, L = w.config.ant.workerBodyLength;
      let close = 0, pairs = 0;
      for (let t = 0; t < 1200; t++) {
        w.step();
        if (t % 60 !== 59) continue;
        for (let i = 0; i < 400; i++) for (let j = i + 1; j < 400; j++) {
          pairs++;
          if (Math.hypot(a.posX[i]! - a.posX[j]!, a.posZ[i]! - a.posZ[j]!) < 0.4 * L) close++;
        }
      }
      return close / pairs;
    };
    const off = overlap(false), on = overlap(true);
    expect(on).toBeLessThan(off * 0.5);
  });

  it('the same with a helper thread stepping a slice (it reads the shared surface grid)', () => {
    const cfg = buildConfig([flat, { population: { count: 300 }, explore: { collide: true }, world: { arenaSize: 150 } }]).config;
    const ref = new World(cfg);
    const main = new World(cfg, { sharedAgents: true });
    const helper = new World(cfg, { agents: new AgentStore(cfg.sim.capacity, { buffers: main.agents.sharedBuffers() }), surfaceBuffers: main.sharedSurface()! });
    for (let t = 0; t < 900; t++) {
      ref.step();
      const n = main.agents.highWater;
      helper.tick = main.tick; helper.stepRange(113, n);
      main.stepRange(0, 113);
      main.completeStep();
    }
    expect(main.stateHash()).toBe(ref.stateHash());
  });
});
