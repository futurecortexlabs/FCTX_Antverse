import { describe, expect, it } from 'vitest';
import { buildConfig } from '../../config/load.ts';
import { World } from '../world.ts';

const { config } = buildConfig([{ debugWalk: { count: 200 } }]);

describe('debug random walk fixture (ENG-DBG-001)', () => {
  it('moves each agent exactly speed*dt per step and keeps it inside the arena', () => {
    const w = new World(config);
    const a = w.agents.a;
    const half = config.world.arenaSize / 2;
    const step = config.debugWalk.speed * config.sim.dt;
    for (let t = 0; t < 600; t++) {
      const px = Float64Array.from(a.posX.subarray(0, w.agents.highWater));
      const pz = Float64Array.from(a.posZ.subarray(0, w.agents.highWater));
      w.step();
      for (let s = 0; s < w.agents.highWater; s++) {
        expect(Math.abs(a.posX[s]!)).toBeLessThanOrEqual(half);
        expect(Math.abs(a.posZ[s]!)).toBeLessThanOrEqual(half);
        const d = Math.hypot(a.posX[s]! - px[s]!, a.posZ[s]! - pz[s]!);
        expect(d).toBeLessThanOrEqual(step * (1 + 1e-4)); // ≤: wall reflections shorten the chord
      }
    }
  });

  it('advances gait phase by distance / stride length', () => {
    const w = new World(config);
    const before = w.agents.a.gaitPhase[0]!;
    w.step();
    const advance = (w.agents.a.gaitPhase[0]! - before + 1) % 1;
    expect(advance).toBeCloseTo((config.debugWalk.speed * config.sim.dt) / config.debugWalk.strideLength, 5);
  });

  it('rests on the terrain support surface with unit quaternions', () => {
    const w = new World(config);
    for (let t = 0; t < 60; t++) w.step();
    for (let s = 0; s < w.agents.highWater; s++) {
      const a = w.agents.a;
      expect(a.posY[s]).toBeCloseTo(w.terrain.supportHeight(a.posX[s]!, a.posZ[s]!), 3);
      const r = w.agents.a.rot;
      expect(Math.hypot(r[s * 4]!, r[s * 4 + 1]!, r[s * 4 + 2]!, r[s * 4 + 3]!)).toBeCloseTo(1, 5);
    }
  });
});
