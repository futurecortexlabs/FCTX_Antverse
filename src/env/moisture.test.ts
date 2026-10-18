/**
 * Reproduction tests for soil moisture (PHY-ENV-005, ASM-ENV-007,
 * ENG-ENV-003): the water budget closes, rain soaks in from the top, dry
 * weather dries the soil from the top, the top layer never holds more than
 * saturation, and a model stepped late catches up to the same numbers.
 */

import { describe, expect, it } from 'vitest';
import { buildConfig } from '../config/load.ts';
import { SoilMoisture } from './moisture.ts';

const cfg = buildConfig([{ env: { enabled: true } }]).config;
const [dry, sat] = cfg.env.moistureRange as readonly [number, number];
const deep = cfg.env.deepMoisture;
const DT = cfg.env.updateInterval;
const H = 3600 / DT;

describe('soil moisture', () => {
  it('the water budget closes: change in storage = rain in − run off − evaporated − lost below', () => {
    const m = new SoilMoisture(cfg, 400);
    const s0 = m.storage();
    for (let k = 0; k < 24 * H; k++) m.step(DT, k < 2 * H ? 20 : 0, k < 4 * H ? 1 : 0.5, 20 + (k % (24 * H)) / H);
    expect(m.infiltrated).toBeGreaterThan(0);
    expect(m.evaporated).toBeGreaterThan(0);
    expect(m.storage() - s0).toBeCloseTo(m.infiltrated - m.runoff - m.evaporated - m.drained, 7);
  });

  it('rain soaks in from the top: after an hour of 10 mm/h the top is wetter than the deep soil, and the front is tens of mm down', () => {
    const m = new SoilMoisture(cfg, 400);
    for (let k = 0; k < H; k++) m.step(DT, 10, 1, cfg.env.referenceTemp);
    expect(m.theta[0]!).toBeGreaterThan(deep + 0.05);
    expect(m.theta[20]!).toBeGreaterThan(deep);
    expect(m.theta[300]!).toBeCloseTo(deep, 3);
    for (let i = 1; i < 300; i++) expect(m.theta[i]!).toBeLessThanOrEqual(m.theta[i - 1]! + 1e-12);
  });

  it('dry, warm weather dries the soil from the top: the top nears air-dry, the deep soil stays moist', () => {
    const m = new SoilMoisture(cfg, 400);
    for (let k = 0; k < 3 * 24 * H; k++) m.step(DT, 0, cfg.env.humidity, cfg.env.referenceTemp + 5);
    expect(m.theta[0]!).toBeLessThan(dry + 0.05);
    expect(m.theta[0]!).toBeGreaterThanOrEqual(dry);
    expect(m.theta[300]!).toBeGreaterThan(deep - 0.05);
    for (let i = 1; i < 300; i++) expect(m.theta[i]!).toBeGreaterThanOrEqual(m.theta[i - 1]! - 1e-12);
  });

  it('a cloudburst saturates the top: no layer above saturation, the rest runs off', () => {
    const m = new SoilMoisture(cfg, 200);
    for (let k = 0; k < H; k++) m.step(DT, 200, 1, cfg.env.referenceTemp);
    for (const th of m.theta) expect(th).toBeLessThanOrEqual(sat);
    expect(m.theta[0]!).toBeCloseTo(sat, 9);
    expect(m.runoff).toBeGreaterThan(0);
  });

  it('stepping the same intervals gives the same numbers (threads that start late catch up)', () => {
    const a = new SoilMoisture(cfg, 100), b = new SoilMoisture(cfg, 100);
    const weather = (k: number): [number, number, number] => [k % 50 < 5 ? 8 : 0, k % 50 < 5 ? 1 : 0.6, 25 + (k % 7)];
    for (let k = 0; k < 300; k++) a.step(DT, ...weather(k));
    for (let k = 0; k < 300; k++) b.step(DT, ...weather(k));
    expect(Array.from(b.theta)).toEqual(Array.from(a.theta));
  });
});
