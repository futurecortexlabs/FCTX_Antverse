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
  /** Ground surface and surface objects (Phase 1). Origin = nest entrance. */
  terrain: {
    /** Side of the simulated square of ground. */
    size: p(2000, 'mm', 'ENG-TER-001', { min: 10 }),
    lacunarity: p(2, 'x', 'ENG-TER-002', { min: 1.1 }),
    macroWavelength: p(2000, 'mm', 'ASM-TER-001', { min: 1 }),
    macroOctaves: p(6, 'count', 'ASM-TER-001', { min: 0, integer: true }),
    macroSlope: p(0.015, 'x', 'ASM-TER-001', { min: 0 }),
    microWavelength: p(16, 'mm', 'ASM-TER-002', { min: 0.01 }),
    microOctaves: p(7, 'count', 'ASM-TER-002', { min: 0, integer: true }),
    /** Amplitude / wavelength of the longest micro octave. */
    microSlope: p(0.05, 'x', 'ASM-TER-002', { min: 0 }),
    /** Amplitude ∝ wavelength^hurst: < 1 means rougher at small scales. */
    microHurst: p(0.6, 'x', 'ASM-TER-002', { min: 0, max: 1 }),
    patchWavelength: p(700, 'mm', 'ASM-TER-003', { min: 1 }),
    /** Target fraction of the ground in each kind of patch. */
    litterCover: p(0.3, 'x', 'ASM-TER-003', { min: 0, max: 1 }),
    grassCover: p(0.3, 'x', 'ASM-TER-003', { min: 0, max: 1 }),
    gravelCover: p(0.5, 'x', 'ASM-TER-003', { min: 0, max: 1 }),
    /** Width of patch edges, in units of the patch noise value. */
    patchSoftness: p(0.06, 'x', 'ASM-TER-003', { min: 0.001 }),
    nestClearRadius: p(120, 'mm', 'ASM-TER-004', { min: 0 }),
    grainCell: p(2, 'mm', 'ENG-TER-003', { min: 0.1 }),
    grainDensity: p(0.06, '1/mm2', 'ASM-TER-005', { min: 0 }),
    /** Grain density outside gravel patches, as a fraction of grainDensity. */
    grainBareFraction: p(0.25, 'x', 'ASM-TER-005', { min: 0, max: 1 }),
    grainCacheCells: p(65536, 'count', 'ENG-TER-003', { min: 64, integer: true }),
    grainSize: p([0.63, 2], 'mm', 'PHY-SOIL-001'),
    pebbleCell: p(20, 'mm', 'ENG-TER-003', { min: 1 }),
    pebbleDensity: p(0.0006, '1/mm2', 'ASM-TER-005', { min: 0 }),
    pebbleSize: p([2, 30], 'mm', 'PHY-SOIL-001'),
    /** Cumulative size distribution N(>d) ∝ d^-k. */
    sizeExponent: p(2.5, 'x', 'ASM-TER-006', { min: 0.1 }),
    /** Short axis / long axis (vertical flattening) range. */
    particleFlatness: p([0.45, 0.85], 'x', 'ASM-TER-006'),
    /** Middle axis / long axis range. */
    particleElongation: p([0.6, 1], 'x', 'ASM-TER-006'),
    /** Fraction of the vertical extent buried in the soil. */
    embedFraction: p([0.15, 0.45], 'x', 'ASM-TER-006'),
    pebbleMaxTilt: p(0.25, 'rad', 'ASM-TER-006', { min: 0 }),
    grainMaxTilt: p(0.6, 'rad', 'ASM-TER-006', { min: 0 }),
    leafCell: p(150, 'mm', 'ENG-TER-003', { min: 1 }),
    leafDensity: p(0.0004, '1/mm2', 'ASM-LIT-001', { min: 0 }),
    /** Outline asymmetry: 0 = ellipse, > 0 = widest towards the base (ovate). */
    leafTaper: p(0.3, 'x', 'ASM-LIT-001', { min: 0, max: 1 }),
    leafLength: p([40, 110], 'mm', 'ASM-LIT-001'),
    leafWidthRatio: p([0.35, 0.6], 'x', 'ASM-LIT-001'),
    /** Edge lift relative to leaf width. */
    leafCurl: p([0.02, 0.12], 'x', 'ASM-LIT-002'),
    leafThickness: p(0.2, 'mm', 'ASM-LIT-002', { min: 0.01 }),
    /** Leaf clearance over the soil relief it does not follow, in standard deviations. */
    leafClearanceSigma: p(3, 'x', 'ASM-LIT-002', { min: 0 }),
    /** Shortest ground-relief wavelength a lying leaf follows. */
    leafStiffness: p(6, 'mm', 'ASM-LIT-002', { min: 0.1 }),
    /** Drape grid: [along midrib, across]. */
    leafGrid: p([16, 8], 'count', 'ENG-TER-004'),
    grassCell: p(100, 'mm', 'ENG-TER-003', { min: 1 }),
    tuftDensity: p(0.00025, '1/mm2', 'ASM-GRS-001', { min: 0 }),
    bladesPerTuft: p([6, 20], 'count', 'ASM-GRS-001'),
    tuftRadius: p(12, 'mm', 'ASM-GRS-001', { min: 0 }),
    bladeLength: p([40, 160], 'mm', 'ASM-GRS-001'),
    bladeWidth: p([2, 5], 'mm', 'ASM-GRS-001'),
    bladeLean: p([0.05, 0.7], 'rad', 'ASM-GRS-001'),
    /** Random deviation of a blade's lean direction from radially outward. */
    bladeYawScatter: p(0.8, 'rad', 'ASM-GRS-001', { min: 0 }),
    /** Extra droop of the blade tip relative to its base lean. */
    bladeDroop: p([0.1, 0.9], 'rad', 'ASM-GRS-001'),
    bladeSegments: p(8, 'count', 'ENG-TER-004', { min: 1, integer: true }),
    /** Samples per side used to calibrate patch thresholds to the cover fractions. */
    calibrationSamples: p(96, 'count', 'ENG-TER-005', { min: 8, integer: true }),
  },
  terrainRender: {
    /** Half side of the rendered ground (quadtree root). */
    viewHalfExtent: p(16384, 'mm', 'ENG-TRN-001', { min: 10 }),
    chunkQuads: p(64, 'count', 'ENG-TRN-002', { min: 2, integer: true }),
    /** A node is split while its geometric error projects to more than this. */
    maxScreenError: p(2, 'px', 'ENG-TRN-002', { min: 0.1 }),
    /** Geometric error used for LOD, in standard deviations of the dropped relief (Infinity = worst case). */
    errorSigmas: p(3, 'x', 'ENG-TRN-002', { min: 0.1 }),
    minSpacing: p(0.0078125, 'mm', 'ENG-TRN-002', { min: 0.0001 }),
    /** Skirt depth = skirtFactor × worst-case deviation of a mesh 2^skirtLevels times coarser. */
    skirtFactor: p(2, 'x', 'ENG-TRN-003', { min: 0 }),
    skirtLevels: p(3, 'count', 'ENG-TRN-003', { min: 0, integer: true }),
    genBudget: p(4, 'ms', 'ENG-TRN-004', { min: 0.5 }),
    cacheChunks: p(2500, 'count', 'ENG-TRN-004', { min: 16, integer: true }),
    grainMinPixels: p(1.5, 'px', 'ENG-TRN-005', { min: 0.1 }),
    grainMaxInstances: p(80000, 'count', 'ENG-TRN-005', { min: 0, integer: true }),
    /** Rebuild near-camera grains after the camera moves this fraction of the grain radius. */
    grainRebuildFraction: p(0.15, 'x', 'ENG-TRN-005', { min: 0.01, max: 1 }),
    /** Soil colours: dark (crevices / damp), base, light (dry crests). */
    soilColors: p([0.23, 0.18, 0.13, 0.43, 0.35, 0.26, 0.6, 0.52, 0.41], 'rgb', 'ENG-REN-010'),
    /** Relief (mm) mapped onto the full dark→light soil range. */
    soilShadeRange: p(0.8, 'mm', 'ENG-REN-010', { min: 0.001 }),
    /** Brightness change per soilShadeRange of per-pixel (sub-mesh) relief. */
    soilDetailContrast: p(0.6, 'x', 'ENG-REN-010', { min: 0 }),
    /** Per-pixel relief is faded out below this many pixels per wavelength (anti-aliasing). */
    detailMinPixels: p([2, 4], 'px', 'ENG-TRN-002'),
    /** Fine mineral speckle of the soil (silt / fine sand below the modelled grains): cell size and contrast. */
    soilSpeckleSize: p(0.12, 'mm', 'ENG-REN-010', { min: 0.001 }),
    soilSpeckleContrast: p(0.35, 'x', 'ENG-REN-010', { min: 0, max: 1 }),
    /** Radius range of the speckle grain, in speckle cells. */
    soilSpeckleRadius: p([0.2, 0.45], 'x', 'ENG-REN-010'),
    /** Dome height of a speckle grain relative to its radius (visual shading only). */
    soilSpeckleRelief: p(0.25, 'x', 'ENG-REN-010', { min: 0 }),
    /** Leaf venation (visual): midrib half-width (in t), lateral vein count / slant / half-width (in s), darkening. */
    leafMidribDarken: p(0.3, 'x', 'ENG-REN-010', { min: 0, max: 1 }),
    leafMidribWidth: p(0.025, 'x', 'ENG-REN-010', { min: 0 }),
    leafVeinCount: p(9, 'count', 'ENG-REN-010', { min: 1 }),
    leafVeinSlant: p(0.35, 'x', 'ENG-REN-010', { min: 0 }),
    leafVeinWidth: p(0.002, 'x', 'ENG-REN-010', { min: 0 }),
    leafVeinDarken: p(0.18, 'x', 'ENG-REN-010', { min: 0, max: 1 }),
    /** Leaf mottling: noise wavelength and brightness contrast. */
    leafMottleScale: p(6, 'mm', 'ENG-REN-010', { min: 0.01 }),
    leafMottleContrast: p(0.12, 'x', 'ENG-REN-010', { min: 0, max: 1 }),
    pebbleColors: p([0.52, 0.5, 0.46, 0.62, 0.57, 0.5, 0.4, 0.37, 0.34, 0.7, 0.64, 0.55], 'rgb', 'ENG-REN-010'),
    leafColors: p([0.55, 0.38, 0.18, 0.66, 0.5, 0.22, 0.42, 0.28, 0.15, 0.6, 0.45, 0.28], 'rgb', 'ENG-REN-010'),
    grassColors: p([0.2, 0.36, 0.12, 0.42, 0.56, 0.22], 'rgb', 'ENG-REN-010'),
    /** Fractional darkening of a leaf at its margin relative to the midrib. */
    leafEdgeDarken: p(0.18, 'x', 'ENG-REN-010', { min: 0, max: 1 }),
    /** Per-blade brightness variation of grass. */
    grassToneSpread: p(0.3, 'x', 'ENG-REN-010', { min: 0, max: 1 }),
    /** Roughness: pebbles, leaves, grass, grains. */
    objectRoughness: p([0.9, 0.8, 0.7, 0.85], 'x', 'ENG-REN-010'),
    pebbleDetail: p(3, 'count', 'ENG-TRN-009', { min: 0, integer: true }),
    grainDetail: p(1, 'count', 'ENG-TRN-009', { min: 0, integer: true }),
    cameraClearance: p(0.1, 'mm', 'ENG-TRN-006', { min: 0 }),
    guardRadius: p(0.4, 'mm', 'ENG-TRN-006', { min: 0 }),
    fogNearFraction: p(0.3, 'x', 'ENG-TRN-007', { min: 0, max: 1 }),
    shadows: p(true, 'bool', 'ENG-TRN-008'),
    shadowMapSize: p(2048, 'px', 'ENG-TRN-008', { min: 256, integer: true }),
    /** Shadow frustum half-size = factor × camera distance to its target. */
    shadowExtentFactor: p(1.5, 'x', 'ENG-TRN-008', { min: 0.1 }),
    shadowExtentRange: p([2, 3000], 'mm', 'ENG-TRN-008'),
    /** Shadow camera depth as a multiple of its half-size. */
    shadowDepthFactor: p(8, 'x', 'ENG-TRN-008', { min: 1 }),
    showScaleBar: p(true, 'bool', 'ENG-REN-006'),
  },
  render: {
    fov: p(50, 'deg', 'ENG-REN-001', { min: 5, max: 120 }),
    near: p(0.05, 'mm', 'ENG-REN-002', { min: 0.001 }),
    far: p(20000, 'mm', 'ENG-REN-002', { min: 1 }),
    reversedDepth: p(true, 'bool', 'ENG-REN-003'),
    antialias: p(true, 'bool', 'ENG-REN-004'),
    maxPixelRatio: p(2, 'x', 'ENG-REN-004', { min: 0.5, max: 4 }),
    scaleBarTick: p(1, 'mm', 'ENG-REN-006', { min: 0.1 }),
    scaleBarLength: p(10, 'mm', 'ENG-REN-006', { min: 1 }),
    scaleBarThickness: p(0.1, 'mm', 'ENG-REN-006', { min: 0.01 }),
    scaleBarMajorEvery: p(5, 'count', 'ENG-REN-006', { min: 1, integer: true }),
    scaleBarColor: p([0.95, 0.95, 0.95], 'rgb', 'ENG-REN-006'),
    cameraStart: p([45, 30, 45], 'mm', 'ENG-REN-007'),
    /** Placeholder body: triples (centerX, halfLength, radius) relative to body length, rear to front. */
    placeholderSegments: p([-0.27, 0.21, 0.11, 0.03, 0.15, 0.065, 0.32, 0.1, 0.085], 'x', 'ENG-REN-008'),
    antColor: p([0.07, 0.055, 0.05], 'rgb', 'ENG-REN-010'),
    antRoughness: p(0.45, 'x', 'ENG-REN-010', { min: 0, max: 1 }),
    skyColor: p([0.62, 0.74, 0.86], 'rgb', 'ENG-REN-010'),
    hemiIntensity: p(1.2, 'x', 'ENG-REN-012', { min: 0 }),
    sunIntensity: p(2.2, 'x', 'ENG-REN-012', { min: 0 }),
    sunDirection: p([1, 2, 1.5], 'x', 'ENG-REN-012'),
    interpolationLagTicks: p(1, 'tick', 'ENG-REN-009', { min: 0 }),
    interpolationSmoothing: p(0.2, 'x', 'ENG-REN-009', { min: 0.01, max: 1 }),
    minCameraDistance: p(0.3, 'mm', 'ENG-REN-007', { min: 0.01 }),
    maxCameraDistance: p(10000, 'mm', 'ENG-REN-007', { min: 1 }),
    maxPolarAngle: p(179, 'deg', 'ENG-REN-007', { min: 1, max: 180 }),
    gpuTiming: p(true, 'bool', 'ENG-PRF-002'),
  },
  ui: {
    hudCollapsed: p(false, 'bool', 'ENG-UI-001'),
  },
  device: {
    /** A coarse-pointer device whose shorter screen side is below this is treated as a phone. */
    mobileMaxShortSide: p(820, 'px', 'ENG-DEV-001', { min: 0 }),
  },
  /** Automatic quality reduction (enabled by the web and mobile tiers). */
  quality: {
    auto: p(false, 'bool', 'ENG-QLT-001'),
    /** Frame interval above which quality is reduced (30 fps). */
    targetFrameMs: p(33.3, 'ms', 'ENG-QLT-001', { min: 1 }),
    window: p(2, 's', 'ENG-QLT-001', { min: 0.1 }),
    minPixelRatio: p(0.5, 'x', 'ENG-QLT-001', { min: 0.1 }),
    maxScreenErrorCeil: p(8, 'px', 'ENG-QLT-001', { min: 0.1 }),
    step: p(0.8, 'x', 'ENG-QLT-001', { min: 0.1, max: 0.99 }),
    upgradeHeadroom: p(0.4, 'x', 'ENG-QLT-001', { min: 0, max: 1 }),
    upgradeWindows: p(2, 'count', 'ENG-QLT-001', { min: 1, integer: true }),
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
