/**
 * Default values of every tunable parameter.
 *
 * Rules (enforced by tests/architecture/params.test.ts):
 *  - every value is a Param with a unit and an evidence id;
 *  - every evidence id is defined in docs/BIOLOGY.md or docs/ENGINEERING.md;
 *  - simulation and render code read values from here, never literals.
 *
 * Experiment presets (config/presets/*.json) and URL `?set=path=value`
 * override `value` only; unit and evidence stay attached to the default.
 */

import { p, type Values } from './schema.ts';

export const DEFAULT_PARAMS = {
  sim: {
    dt: p(1 / 60, 's', 'ENG-SIM-001', { min: 1 / 1000, max: 1 / 10 }),
    loopBudget: p(12, 'ms', 'ENG-SIM-002', { min: 1, max: 100 }),
    maxCatchUp: p(250, 'ms', 'ENG-SIM-002', { min: 0 }),
    idleDelay: p(2, 'ms', 'ENG-SIM-003', { min: 0, max: 50 }),
    seed: p(20261011, 'count', 'ENG-SIM-004', { min: 0, max: 0xffffffff, integer: true }),
    capacity: p(131072, 'count', 'ENG-SIM-005', { min: 1, max: 1 << 20, integer: true }),
    statsInterval: p(250, 'ms', 'ENG-SIM-006', { min: 50 }),
    determinismCheckTicks: p(10000, 'tick', 'ENG-SIM-007', { min: 1, integer: true }),
  },
  time: {
    speeds: p([0.25, 1, 2, 4, 8, 16, 32, 64, 128], 'x', 'ENG-TIME-001'),
    initialSpeed: p(1, 'x', 'ENG-TIME-001', { min: 0 }),
    maxSpeed: p(100000, 'x', 'ENG-TIME-002', { min: 1 }),
  },
  world: {
    arenaSize: p(400, 'mm', 'ENG-WLD-001', { min: 10 }),
  },
  ant: {
    workerBodyLength: p(5, 'mm', 'BIO-MOR-001', { min: 1, max: 20 }),
  },
  debugWalk: {
    count: p(2000, 'count', 'ENG-DBG-001', { min: 0, integer: true }),
    speed: p(20, 'mm/s', 'ENG-DBG-002', { min: 0 }),
    turnNoise: p(2, 'rad/sqrt(s)', 'ENG-DBG-003', { min: 0 }),
    strideLength: p(2.5, 'mm', 'ENG-DBG-004', { min: 0.1 }),
  },
  render: {
    fov: p(50, 'deg', 'ENG-REN-001', { min: 5, max: 120 }),
    near: p(0.05, 'mm', 'ENG-REN-002', { min: 0.001 }),
    far: p(20000, 'mm', 'ENG-REN-002', { min: 1 }),
    reversedDepth: p(true, 'bool', 'ENG-REN-003'),
    antialias: p(true, 'bool', 'ENG-REN-004'),
    maxPixelRatio: p(2, 'x', 'ENG-REN-004', { min: 0.5, max: 4 }),
    gridMinorStep: p(1, 'mm', 'ENG-REN-005', { min: 0.1 }),
    gridMajorStep: p(10, 'mm', 'ENG-REN-005', { min: 1 }),
    gridMinorExtent: p(50, 'mm', 'ENG-REN-005', { min: 1 }),
    gridMinorColor: p([0.35, 0.29, 0.23], 'rgb', 'ENG-REN-005'),
    gridMajorColor: p([0.18, 0.14, 0.09], 'rgb', 'ENG-REN-005'),
    scaleBarLength: p(10, 'mm', 'ENG-REN-006', { min: 1 }),
    scaleBarThickness: p(0.1, 'mm', 'ENG-REN-006', { min: 0.01 }),
    scaleBarMajorEvery: p(5, 'count', 'ENG-REN-006', { min: 1, integer: true }),
    scaleBarColor: p([0.95, 0.95, 0.95], 'rgb', 'ENG-REN-006'),
    cameraStart: p([45, 30, 45], 'mm', 'ENG-REN-007'),
    /** Placeholder body: triples (centerX, halfLength, radius) relative to body length, rear to front. */
    placeholderSegments: p([-0.27, 0.21, 0.11, 0.03, 0.15, 0.065, 0.32, 0.1, 0.085], 'x', 'ENG-REN-008'),
    antColor: p([0.07, 0.055, 0.05], 'rgb', 'ENG-REN-010'),
    antRoughness: p(0.45, 'x', 'ENG-REN-010', { min: 0, max: 1 }),
    groundColor: p([0.42, 0.34, 0.25], 'rgb', 'ENG-REN-010'),
    skyColor: p([0.62, 0.74, 0.86], 'rgb', 'ENG-REN-010'),
    groundExtent: p(8000, 'mm', 'ENG-REN-011', { min: 10 }),
    hemiIntensity: p(1.2, 'x', 'ENG-REN-012', { min: 0 }),
    sunIntensity: p(2.2, 'x', 'ENG-REN-012', { min: 0 }),
    sunDirection: p([1, 2, 1.5], 'x', 'ENG-REN-012'),
    interpolationLagTicks: p(1, 'tick', 'ENG-REN-009', { min: 0 }),
    interpolationSmoothing: p(0.2, 'x', 'ENG-REN-009', { min: 0.01, max: 1 }),
    minCameraDistance: p(0.3, 'mm', 'ENG-REN-007', { min: 0.01 }),
    maxCameraDistance: p(10000, 'mm', 'ENG-REN-007', { min: 1 }),
    maxPolarAngle: p(88, 'deg', 'ENG-REN-007', { min: 1, max: 180 }),
    gpuTiming: p(true, 'bool', 'ENG-PRF-002'),
  },
  perf: {
    windowFrames: p(240, 'frames', 'ENG-PRF-001', { min: 10, integer: true }),
    hudInterval: p(250, 'ms', 'ENG-PRF-001', { min: 50 }),
  },
  bench: {
    counts: p([1000, 2000, 5000, 10000, 20000, 50000, 100000], 'count', 'ENG-BEN-001'),
    warmup: p(2, 's', 'ENG-BEN-001', { min: 0 }),
    sample: p(5, 's', 'ENG-BEN-001', { min: 0.5 }),
    simTicks: p(600, 'tick', 'ENG-BEN-002', { min: 1, integer: true }),
  },
};

export type Params = typeof DEFAULT_PARAMS;
export type Config = Values<Params>;
