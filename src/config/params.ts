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
    /** Simulation threads (1 = single-threaded, 0 = auto: hardware threads − 2, at most maxThreads). */
    threads: p(0, 'count', 'ENG-SIM-008', { min: 0, integer: true }),
    maxThreads: p(8, 'count', 'ENG-SIM-008', { min: 1, integer: true }),
    /** Below this many agents per thread, stepping stays single-threaded. */
    minAgentsPerThread: p(500, 'count', 'ENG-SIM-008', { min: 1, integer: true }),
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
  /** Workers placed at start (until colony dynamics arrive in Phase 6). */
  population: {
    count: p(2000, 'count', 'ENG-POP-001', { min: 0, integer: true }),
  },
  /** Undirected exploratory walking (until pheromones and navigation drive it). */
  explore: {
    /**
     * Turning: the angular velocity is an Ornstein–Uhlenbeck process (standard
     * deviation turnRateSd, correlation time turnTau), so headings change smoothly
     * and the path is a correlated random walk with heading diffusion ≈ turnRateSd²·turnTau.
     */
    turnRateSd: p(2, 'rad/s', 'ASM-BEH-001', { min: 0 }),
    turnTau: p(0.3, 's', 'ASM-BEH-001', { min: 0.001 }),
    /** How far ahead of the mesosoma the antennae probe the ground (fraction of body length). */
    probeDistance: p(0.9, 'x', 'ASM-SEN-002', { min: 0 }),
    /** Side probes for choosing the way around an obstacle. */
    probeAngle: p(0.7, 'rad', 'ASM-SEN-002', { min: 0 }),
    /** Highest rise of the support ahead that the ant walks onto (taller: turn away). */
    maxClimb: p(1.4, 'mm', 'ASM-LOC-008', { min: 0 }),
    /** A rise is still walkable if the slope up to the probe point is no steeper than this (tan): sand slopes, the spoil mound. */
    maxSlope: p(0.8, 'x', 'ASM-LOC-008', { min: 0 }),
    /** Deepest drop of the support ahead that the ant walks down (deeper: turn away). Ants climb down more easily than up. */
    maxDrop: p(10, 'mm', 'ASM-LOC-008', { min: 0 }),
    /** Turning rate while facing an obstacle. */
    avoidTurnRate: p(6, 'rad/s', 'ASM-LOC-008', { min: 0 }),
    /**
     * Collision avoidance between ants on the surface (Phase 7): off by default (the Phase 2–5
     * scenarios were judged without it). A nestmate ahead within collideRadius body lengths
     * (centre to centre) makes the ant turn away at up to collideTurn.
     */
    collide: p(false, 'bool', 'ASM-SOC-001'),
    collideRadius: p(0.9, 'x', 'ASM-SOC-001', { min: 0 }),
    collideTurn: p(6, 'rad/s', 'ASM-SOC-001', { min: 0 }),
    /** A nestmate closer than collideStop body lengths within collideCone (rad) of straight ahead: stop and turn instead of stepping. */
    collideStop: p(0.6, 'x', 'ASM-SOC-001', { min: 0 }),
    collideCone: p(0.785, 'rad', 'ASM-SOC-001', { min: 0, max: 3.15 }),
    /** Side of the cells of the surface grid the neighbours are looked up in. */
    collideCell: p(5, 'mm', 'ENG-SIM-009', { min: 0.5 }),
  },
  /**
   * Experimental set-ups replacing the open ground (Phase 3): the double bridge
   * of Goss et al. (1989) / Beckers et al. (1992). Ground is flat inside it.
   */
  scenario: {
    doubleBridge: p(false, 'bool', 'ENG-SCN-001'),
    /** Distance between the two forks. */
    bridgeSpan: p(120, 'mm', 'ENG-SCN-002', { min: 1 }),
    /** Long / short branch length. */
    bridgeRatio: p(2, 'x', 'BIO-PHE-001', { min: 1 }),
    /** Angle of both branches either side of the axis at each fork. */
    bridgeAngle: p(0.5236, 'rad', 'BIO-PHE-001', { min: 0.05, max: 1.5 }),
    bridgeWidth: p(10, 'mm', 'ENG-SCN-002', { min: 1 }),
    /** Length of the long branch's first and last legs (at ±bridgeAngle, mirroring the short branch), as a fraction of a short-branch leg. */
    forkLeg: p(0.5, 'x', 'ENG-SCN-002', { min: 0.05, max: 0.95 }),
    /** Corridors nest → fork A and fork B → feeder. */
    stemLength: p(40, 'mm', 'ENG-SCN-002', { min: 0 }),
    /** Radius of the nest and feeding arenas. */
    arenaRadius: p(15, 'mm', 'ENG-SCN-002', { min: 1 }),
    /**
     * Homing on open ground (Phase 4): the nest entrance at the origin, one
     * feeder feederDistance away in a direction drawn from the seed. No pheromone.
     */
    homing: p(false, 'bool', 'ENG-SCN-003'),
    feederDistance: p(300, 'mm', 'ENG-SCN-003', { min: 0 }),
    feederRadius: p(10, 'mm', 'ENG-SCN-003', { min: 1 }),
    /** Distance from the nest entrance at which an ant recognises it and goes in. */
    nestRadius: p(4, 'mm', 'ASM-NAV-005', { min: 0.5 }),
    /** Nest excavation (Phase 5): workers dig a nest below the entrance at the origin. */
    digging: p(false, 'bool', 'ENG-SCN-004'),
    /**
     * A colony (Phase 6): queen, brood and workers in a nest below the entrance at the
     * origin (dug as in `digging`), foraging on open ground at the feeders below.
     */
    colony: p(false, 'bool', 'ENG-SCN-005'),
    /** Food sources of the colony scenario as [x0, z0, x1, z1, …] (radius feederRadius); empty = no food. */
    feeders: p([150, 0, -90, 120], 'mm', 'ENG-SCN-005'),
    /** Food sources that appear during the run: [x, z, hours after the start] triples (Phase 7 recruitment test). */
    lateFeeders: p([], 'x', 'ENG-SCN-005'),
    /** Side of the square around the entrance over which the colony's trail pheromone is kept. */
    fieldSize: p(400, 'mm', 'ENG-SCN-005', { min: 1 }),
  },
  /** Soil below the nest as voxels (Phase 5). */
  soil: {
    /** Region [x, depth, z] centred on the entrance; 1 mm voxels. */
    size: p([512, 1024, 512], 'mm', 'ENG-SOL-001'),
    /** The starting pit under the entrance: [radius, depth]. */
    pit: p([1.5, 3], 'mm', 'ENG-SCN-004'),
    /** Workers leave this much soil under the surface intact, except within the entrance radius (scenario.nestRadius). */
    crust: p(3, 'mm', 'ASM-NST-005', { min: 0 }),
    /** Soil volume of one pellet (= one voxel). */
    pellet: p(1, 'mm3', 'ASM-NST-001', { min: 0.01 }),
    /** Side of the cells in which nestmates are counted for the density cue. */
    densityCell: p(8, 'mm', 'ENG-SOL-002', { min: 1, integer: true }),
    /** Voxels the dig log holds for helper threads (Phase 6; 4 Mi voxels = 16 MB). */
    digLog: p(4194304, 'count', 'ENG-SOL-004', { min: 1, integer: true }),
  },
  /** Excavation behaviour (Phase 5). */
  dig: {
    /** Pellets per second a worker at a soil face would dig at high nestmate density. */
    rate: p(0.05, '1/s', 'ASM-NST-001', { min: 0 }),
    /**
     * Crowding: x = (other workers in the density cell) × spacePerWorker / (open volume of the cell);
     * digging rises as x^n / (x^n + 1), i.e. it is half the full rate when each worker has
     * spacePerWorker of space, and dies away as the nest gets roomier.
     */
    spacePerWorker: p(40, 'mm3', 'ASM-NST-002', { min: 0 }),
    densityHill: p(4, 'x', 'ASM-NST-002', { min: 0 }),
    /** Choice of the next voxel underground: persistence of direction and pull towards the goal (log-weights per unit cosine). */
    persistence: p(2, 'x', 'ASM-NST-003', { min: 0 }),
    goalPull: p(2, 'x', 'ASM-NST-003', { min: 0 }),
    /** Preference for digging the face below rather than beside or above (geotaxis in digging). */
    downPull: p(2, 'x', 'ASM-NST-003', { min: 0 }),
    /** Pull downwards while walking in the nest without a load (geotaxis in walking). */
    walkDown: p(0.1, 'x', 'ASM-NST-003', { min: 0 }),
    /** Blend of the new step into the direction of travel. */
    turnBlend: p(0.5, 'x', 'ENG-SOL-002', { min: 0, max: 1 }),
    /**
     * Body clearance: a worker whose voxel has fewer open neighbours (of 26) than this is
     * cramped and digs at the full rate; elsewhere (in space wider than its body) at
     * looseFactor of it. 17 = standing on the wall of a 3-voxel-wide (≈ 3 mm) tunnel.
     */
    clearance: p(17, 'count', 'ASM-NST-006', { min: 0, max: 26, integer: true }),
    looseFactor: p(0.2, 'x', 'ASM-NST-006', { min: 0, max: 1 }),
    /**
     * Resting in clusters: a worker walking in the nest stops at (stopBase + stopPerWorker × c)
     * per second and a resting one moves on at leaveBase / (1 + leaveDamp × c), with c the
     * other workers in its density cell — so rests gather into clusters.
     */
    stopBase: p(0.01, '1/s', 'ASM-NST-007', { min: 0 }),
    stopPerWorker: p(0.01, '1/s', 'ASM-NST-007', { min: 0 }),
    leaveBase: p(0.05, '1/s', 'ASM-NST-007', { min: 0 }),
    leaveDamp: p(0.5, 'x', 'ASM-NST-007', { min: 0 }),
    /** Pellets are dropped at a distance from the entrance drawn uniformly from this range. */
    dumpDistance: p([10, 40], 'mm', 'ASM-NST-004'),
  },
  /** The mound of excavated soil around the entrance. */
  mound: {
    radius: p(150, 'mm', 'ENG-SOL-003', { min: 1 }),
    cell: p(1, 'mm', 'ENG-SOL-003', { min: 0.1 }),
    /** Steepest stable slope of the loose pile (tan of the angle of repose). */
    repose: p(0.7, 'x', 'PHY-SOIL-002', { min: 0.01 }),
  },
  /**
   * Life in the colony (Phase 6). Food is counted in mg of sugar (dry), the
   * currency of the crop, the body reserve and brood growth.
   */
  colony: {
    /** Worker energy use: ≈ 7 µW for a ~6 mg worker = 0.6 J/d ÷ 16.7 J/mg sugar. */
    metabolism: p(0.036, 'mg/d', 'ASM-COL-001', { min: 0 }),
    /** Body reserve (fat body) of a worker: lasts reserve / metabolism ≈ 2 weeks without food. */
    reserve: p(0.5, 'mg', 'ASM-COL-001', { min: 0.001 }),
    /** Energy use while walking, as a multiple of metabolism (the resting rate). */
    activeFactor: p(3, 'x', 'ASM-COL-001', { min: 1 }),
    /** Crop (social stomach) capacity: ≈ 2 µL of honeydew-like solution at 15 % sugar. */
    crop: p(0.3, 'mg', 'ASM-COL-002', { min: 0.001 }),
    /** Flow from the crop into the worker's own gut and reserve (the proventriculus passes food slowly). */
    absorb: p(0.2, 'mg/d', 'ASM-COL-002', { min: 0 }),
    /** Starting fill of reserve and crop (fractions of capacity). */
    initialFill: p([0.8, 0.8], 'x', 'ASM-COL-002'),
    /** Worker lifespan: normal [mean, sd]; workers of the starting colony are uniformly up to initialAge old. */
    lifespan: p([300, 60], 'd', 'ASM-COL-003'),
    initialAge: p(200, 'd', 'ASM-COL-003', { min: 0 }),
    /** Queen: reserve, energy use, eggs per day when her reserve is full, and the reserve one egg costs. */
    queenReserve: p(5, 'mg', 'ASM-COL-004', { min: 0.001 }),
    queenMetabolism: p(0.1, 'mg/d', 'ASM-COL-004', { min: 0 }),
    layRate: p(20, '1/d', 'ASM-COL-004', { min: 0 }),
    eggCost: p(0.02, 'mg', 'ASM-COL-004', { min: 0 }),
    /** Development at 25 °C (Lasius niger keepers' records; no Formica data found): egg, minimum larval period, pupa — uniform ranges. */
    eggDays: p([9, 16], 'd', 'ASM-COL-011'),
    larvaDays: p([9, 13], 'd', 'ASM-COL-011'),
    pupaDays: p([9, 12], 'd', 'ASM-COL-011'),
    /** Food a larva needs in all to pupate; it takes it from its gut at most food / larvaDays[0] per day. */
    larvalFood: p(0.6, 'mg', 'ASM-COL-005', { min: 0.001 }),
    /** Food a larva's gut holds (what a nurse can give it at once). */
    larvalGut: p(0.03, 'mg', 'ASM-COL-005', { min: 0.0001 }),
    /** A larva left with an empty gut this long dies (eaten by the workers). */
    larvalStarve: p(5, 'd', 'ASM-COL-005', { min: 0 }),
    /** Starting brood per worker: eggs, larvae, pupae (each at a uniformly drawn point of its stage). */
    initialBrood: p([0.2, 0.3, 0.2], 'x', 'ASM-COL-006'),
    /** Brood lies within this distance of the queen. */
    broodRadius: p(6, 'mm', 'ASM-COL-006', { min: 0 }),
    /** Antennal contact: two nestmates closer than this (centre to centre) touch. */
    contactRadius: p(6, 'mm', 'ASM-COL-007', { min: 0 }),
    /** Each worker looks for a contact this often (s); between looks it keeps its partner. */
    contactInterval: p(0.5, 's', 'ENG-COL-001', { min: 0.01 }),
    /** Trophallaxis: crop-to-crop flow, and the difference in crop fill (fraction of capacity) above which food flows. */
    flowRate: p(0.02, 'mg/s', 'ASM-COL-007', { min: 0 }),
    flowMargin: p(0.1, 'x', 'ASM-COL-007', { min: 0, max: 1 }),
    /** A nurse feeds a larva at this rate (mg/s), from its crop. */
    feedRate: p(0.002, 'mg/s', 'ASM-COL-007', { min: 0 }),
    /** ...but only from what its crop holds above this fill: when food runs short, workers keep it (ASM-COL-012). */
    feedFill: p(0.5, 'x', 'ASM-COL-012', { min: 0, max: 1 }),
    /**
     * Response thresholds (Bonabeau et al. 1996; reinforcement: Theraulaz et al. 1998):
     * an idle worker takes up task j at engageRate × s² / (s² + θ²) per second. θ falls by
     * learn per hour while doing j and rises by forget per hour otherwise, within thetaRange.
     */
    engageRate: p(0.002, '1/s', 'ASM-COL-008', { min: 0 }),
    thetaInit: p([0.5, 0.5], 'x', 'ASM-COL-008'),
    thetaRange: p([0.05, 1], 'x', 'ASM-COL-008'),
    learn: p(0.05, '1/h', 'ASM-COL-008', { min: 0 }),
    forget: p(0.005, '1/h', 'ASM-COL-008', { min: 0 }),
    /** Age polyethism: θ_forage × (1 + ageGain e^(−age/ageScale)), θ_nurse × (1 + ageGain (1 − e^(−age/ageScale))). */
    ageGain: p(3, 'x', 'ASM-COL-009', { min: 0 }),
    ageScale: p(60, 'd', 'ASM-COL-009', { min: 0.001 }),
    /** Hunger a worker perceives: own and its contacts' crop emptiness, averaged over this time. */
    hungerMemory: p(300, 's', 'ASM-COL-010', { min: 0.01 }),
    /**
     * Brood stimulus: brood around a worker counted as 1 per item plus, for a larva, its gut
     * emptiness (0–1) — b brood units give s = b / (b + broodHalf).
     */
    broodHalf: p(10, 'count', 'ASM-COL-010', { min: 0.0001 }),
    /** A nurse gives up nursing at this rate; nurses are drawn up the brood-demand gradient with this log-weight. */
    nurseQuit: p(0.0003, '1/s', 'ASM-COL-008', { min: 0 }),
    nursePull: p(2, 'x', 'ASM-COL-010', { min: 0 }),
    /**
     * Recruitment (Phase 8, BIO-COL-006): a forager back with food that offers it to an idle
     * nestmate recruits it with chance recruitChance per tick of food flowing; recruits go out
     * and follow the trail. In a colony the trail is laid only on the way back from food, and
     * only recruits follow it (trailForRecruits).
     */
    recruitChance: p(0.02, 'x', 'ASM-COL-014', { min: 0, max: 1 }),
    trailForRecruits: p(true, 'bool', 'BIO-COL-006'),
    /**
     * Brood thermoregulation (Phase 7): nurses carry brood towards broodTemp. A nurse where the
     * soil is more than broodTolerance from it, with a better temperature thermoProbe above or
     * below, picks an item up (at pickRate per second), carries it up or down the gradient
     * (log-weight thermoPull) and puts it down where the temperature is within broodTolerance,
     * or after maxCarry.
     */
    broodTemp: p(28, 'degC', 'BIO-COL-005'),
    broodTolerance: p(2, 'degC', 'ASM-COL-013', { min: 0 }),
    thermoProbe: p(5, 'mm', 'ASM-COL-013', { min: 1 }),
    pickRate: p(0.05, '1/s', 'ASM-COL-013', { min: 0 }),
    thermoPull: p(3, 'x', 'ASM-COL-013', { min: 0 }),
    maxCarry: p(300, 's', 'ASM-COL-013', { min: 1 }),
    /**
     * A forager back with food unloads in the nest until its crop is below unloadedFill (or
     * unloadTime has passed), then decides whether to go out again; one back empty decides at once.
     */
    unloadedFill: p(0.1, 'x', 'ASM-COL-007', { min: 0, max: 1 }),
    unloadTime: p(180, 's', 'ASM-COL-007', { min: 0 }),
  },
  /**
   * The physical environment (Phase 7): sun, light and temperature over the day.
   * Off: constant noon at referenceTemp (the Phase 2–6 scenarios).
   */
  env: {
    enabled: p(false, 'bool', 'ENG-ENV-001'),
    /** Where and when: latitude (Tokyo), day of the year (mid-July), local solar time at the start. */
    latitude: p(35.7, 'deg', 'ENG-ENV-001', { min: -90, max: 90 }),
    dayOfYear: p(200, 'count', 'ENG-ENV-001', { min: 1, max: 365, integer: true }),
    startHour: p(6, 'count', 'ENG-ENV-001', { min: 0, max: 24 }),
    /** Civil twilight: light fades from twilightLight to 0 between the horizon and twilight degrees below it. */
    twilight: p(6, 'deg', 'PHY-ENV-001', { min: 0.1 }),
    twilightLight: p(0.01, 'x', 'PHY-ENV-001', { min: 0, max: 1 }),
    /** Soil surface temperature: daily mean and amplitude, and the hour of the maximum (open ground in summer). */
    meanTemp: p(26, 'degC', 'ASM-ENV-001'),
    surfaceAmplitude: p(10, 'degC', 'ASM-ENV-001', { min: 0 }),
    peakHour: p(14, 'count', 'ASM-ENV-001', { min: 0, max: 24 }),
    /** Depth at which the daily temperature wave in the soil is damped to 1/e (and delayed by a radian). */
    dampingDepth: p(100, 'mm', 'PHY-ENV-002', { min: 1 }),
    /** Rates of the ants (walking speed, metabolism) relative to referenceTemp: Q10 up to the optimum. */
    referenceTemp: p(25, 'degC', 'ASM-ENV-002'),
    q10: p(2, 'x', 'BIO-ENV-001', { min: 1 }),
    /** [critical minimum, optimum, critical maximum]: torpid outside, falling linearly above the optimum. */
    thermalLimits: p([5, 35, 45], 'degC', 'ASM-ENV-002'),
    torpidRate: p(0.02, 'x', 'ASM-ENV-002', { min: 0, max: 1 }),
    /** Surface conditions in which foragers go out: light at least foragingLight, temperature within foragingTemp. */
    foragingLight: p(0.05, 'x', 'BIO-ENV-002', { min: 0, max: 1 }),
    foragingTemp: p([12, 38], 'degC', 'BIO-ENV-002'),
    /** The temperatures are refreshed this often (they change by minutes). */
    updateInterval: p(60, 's', 'ENG-ENV-001', { min: 0.01 }),
    /** Rain showers as [start (h after the start of the run), duration (h), intensity (mm/h)] triples. */
    rain: p([], 'x', 'ENG-ENV-002'),
    /** Raindrops: diameter (the volume a drop brings), and what one does to an ant it hits: dazed for [min, max] s, pushed up to rainPush. */
    rainDrop: p(2, 'mm', 'PHY-ENV-003', { min: 0.1 }),
    rainStun: p([2, 10], 's', 'ASM-ENV-003'),
    rainPush: p(3, 'mm', 'ASM-ENV-003', { min: 0 }),
    /** Body width as a fraction of body length: raindrops falling on length × width hit the ant. */
    antWidth: p(0.3, 'x', 'ASM-ENV-003', { min: 0 }),
    /** Sessile drops formed on leaves and stones per mm² of such surface per mm of rain; footprint radius drawn in dropRadius, never more than dropMaxRadius (more runs off). */
    dropForm: p(0.002, '1/mm2', 'ASM-ENV-004', { min: 0 }),
    dropRadius: p([0.5, 2], 'mm', 'ASM-ENV-004'),
    dropMaxRadius: p(3, 'mm', 'ASM-ENV-004', { min: 0.1 }),
    /** Height above the bare soil from which a surface sheds water instead of soaking it up (a leaf, a stone). */
    dropSurface: p(0.3, 'mm', 'ASM-ENV-004', { min: 0 }),
    /** A drop of 1 mm radius lasts this long at referenceTemp and the base humidity; d(r²)/dt is constant, ×2 per evaporationDoubling °C, ∝ (1 − humidity). */
    dropLifetime: p(1800, 's', 'PHY-ENV-004', { min: 1 }),
    evaporationDoubling: p(11, 'degC', 'PHY-ENV-004', { min: 1 }),
    /** Relative humidity: dry-weather value, saturated in rain, back to the dry value over humidityRelax after it. */
    humidity: p(0.6, 'x', 'ASM-ENV-005', { min: 0, max: 0.99 }),
    humidityRelax: p(7200, 's', 'ASM-ENV-005', { min: 1 }),
    /** An ant a drop forms on is stuck for [min, max] s. */
    trapTime: p([20, 120], 's', 'ASM-ENV-004'),
    /** Rain washes trail pheromone away: its lifetime is divided by this while it rains. */
    washout: p(10, 'x', 'ASM-ENV-006', { min: 1 }),
    /** Drop store size and the side of its lookup grid. */
    dropCapacity: p(4096, 'count', 'ENG-ENV-002', { min: 1, integer: true }),
    dropCell: p(8, 'mm', 'ENG-ENV-002', { min: 1 }),
  },
  /** Trail pheromone field (Phase 3). Amounts are in arbitrary units u (per mm² cell). */
  pheromone: {
    cell: p(1, 'mm', 'ASM-PHE-001', { min: 0.1 }),
    /** Mean lifetime of the trail (1/evaporation rate). */
    lifetime: p(2820, 's', 'BIO-PHE-002', { min: 1 }),
    diffusion: p(0.02, 'mm2/s', 'ASM-PHE-001', { min: 0 }),
    /** Field update interval. */
    period: p(6, 'tick', 'ENG-PHE-001', { min: 1, integer: true }),
    /** Laid per mm walked: returning with food, and searching (outbound). */
    depositReturn: p(1, 'u/mm', 'ASM-PHE-002', { min: 0 }),
    depositSearch: p(0.25, 'u/mm', 'ASM-PHE-002', { min: 0 }),
    /** Tiles whose pheromone falls below this go idle (numerical). */
    epsilon: p(1e-4, 'u', 'ENG-PHE-001', { min: 0 }),
  },
  /** Trail following by the antennae (osmotropotaxis, Weber's law; Perna et al. 2012). */
  trail: {
    /** Antenna tips, as fractions of body length ahead of the mesosoma centre and to each side. */
    sensorAhead: p(0.7, 'x', 'ASM-SEN-003', { min: 0 }),
    sensorSide: p(0.27, 'x', 'ASM-SEN-003', { min: 0 }),
    /** Turning rate at full left–right contrast ((L−R)/(L+R) = ±1). */
    gain: p(16, 'rad/s', 'ASM-SEN-004', { min: 0 }),
    /**
     * Weber contrast with a sensory floor: the turn is gain·(L − R)/(L + R + floor),
     * so faint trails are followed weakly and strong ones by their ratio alone.
     */
    floor: p(10, 'u', 'ASM-SEN-004', { min: 0 }),
  },
  /** Foraging trips (Phase 3) and navigation by path integration (Phase 4). */
  forage: {
    /** Rate at which each resting ant leaves the nest to forage. */
    exitRate: p(1 / 60, '1/s', 'ASM-FOR-001', { min: 0 }),
    /** A searching trip that has not found food is given up after a time drawn uniformly from this range. */
    giveUp: p([60, 180], 's', 'ASM-FOR-002'),
    /**
     * Turning rate towards the current goal per radian of heading error. The
     * goal is where the path-integration estimate says it is: the nest while
     * returning, the remembered food while going out again.
     */
    vectorGain: p(4, 'rad/s', 'ASM-NAV-001', { min: 0 }),
    /** U-turn rate when walking directly away from the goal; scales with (1 − cos error)/2. */
    uturnRate: p(0.5, '1/s', 'ASM-NAV-002', { min: 0 }),
    /** Celestial-compass error: a wandering process with this spread and correlation time. */
    compassSd: p(0.05, 'rad', 'ASM-NAV-003', { min: 0 }),
    compassTau: p(20, 's', 'ASM-NAV-003', { min: 0.01 }),
    /** Odometer: each trip's distance gain is 1 ± this spread (normal). */
    odometerSd: p(0.05, 'x', 'ASM-NAV-003', { min: 0 }),
    /** The home vector counts as run off when shorter than this. */
    vectorEnd: p(3, 'mm', 'ASM-NAV-004', { min: 0 }),
    /** Systematic search: loops around the vector's end point, kept within a radius that grows with search time. */
    searchRadius: p(10, 'mm', 'ASM-NAV-004', { min: 0 }),
    searchGrowth: p(1, 'mm/s', 'ASM-NAV-004', { min: 0 }),
  },
  /** Body and gait kinematics of a walking worker. */
  locomotion: {
    speed: p(25, 'mm/s', 'ASM-LOC-001', { min: 0 }),
    /** Individual speeds are spread uniformly by ± this fraction. */
    speedSpread: p(0.2, 'x', 'ASM-LOC-001', { min: 0, max: 1 }),
    /** Stride length = strideBase + strideSlope × speed. */
    strideBase: p(1.5, 'mm', 'ASM-LOC-002', { min: 0.1 }),
    strideSlope: p(0.05, 's', 'ASM-LOC-002', { min: 0 }),
    /** Fraction of a step cycle a leg spends on the ground (tripod: > 0.5 keeps ≥ 3 legs down). */
    dutyFactor: p(0.55, 'x', 'ASM-LOC-003', { min: 0.5, max: 0.95 }),
    swingHeight: p(0.25, 'mm', 'ASM-LOC-004', { min: 0 }),
    /** Minimum height of a swinging foot / ankle above the support (keeps them out of the ground). */
    swingClearance: p(0.02, 'mm', 'ENG-LOC-001', { min: 0 }),
    /** Height of the mesosoma centre above the support surface. */
    rideHeight: p(0.85, 'mm', 'ASM-LOC-005', { min: 0 }),
    /** Lowest allowed mesosoma-centre height above the support under the body. */
    minRideHeight: p(0.55, 'mm', 'ASM-LOC-005', { min: 0 }),
    /** Time constant of the body height / pitch / roll following the terrain. */
    poseSmoothing: p(0.05, 's', 'ASM-LOC-006', { min: 0.001 }),
    /** Neutral foot positions [forward, lateral] relative to body length, per leg pair (fore, mid, hind). */
    neutralFoot: p([0.3, 0.52, 0.02, 0.66, -0.48, 0.6], 'x', 'ASM-LOC-007'),
    /** Smoothing of the observed body motion used to predict footholds (per update). */
    motionSmoothing: p(0.3, 'x', 'ENG-LOC-001', { min: 0.01, max: 1 }),
    /** Footholds must lie within this fraction of femur + tibia reach. */
    reachMargin: p(0.95, 'x', 'ASM-LOC-007', { min: 0.1, max: 1 }),
    /** Furthest a foothold is pulled in towards the coxa to make it reachable (fraction of its offset). */
    footholdPullMax: p(0.6, 'x', 'ASM-LOC-007', { min: 0, max: 0.95 }),
    /** Outward lean of the knee's bending plane (0 = knee straight up). */
    kneeOutward: p(0.3, 'x', 'ASM-LOC-007', { min: 0 }),
    /** Angle of the tarsus to the ground. */
    tarsusAngle: p(0.45, 'rad', 'ASM-LOC-007', { min: 0, max: 1.5 }),
  },
  /** Worker morphology, as fractions of body length (ant.workerBodyLength). */
  morphology: {
    head: p([0.21, 0.2, 0.15], 'x', 'ASM-MOR-002'),
    mesosoma: p([0.36, 0.14, 0.15], 'x', 'ASM-MOR-002'),
    petiole: p([0.05, 0.08, 0.12], 'x', 'ASM-MOR-002'),
    gaster: p([0.33, 0.24, 0.2], 'x', 'ASM-MOR-002'),
    /** Compound eye diameter. */
    eye: p(0.06, 'x', 'ASM-MOR-002', { min: 0 }),
    mandible: p(0.07, 'x', 'ASM-MOR-002', { min: 0 }),
    scape: p(0.24, 'x', 'ASM-MOR-003', { min: 0 }),
    funiculus: p(0.32, 'x', 'ASM-MOR-003', { min: 0 }),
    /** Bend between scape and funiculus (0 = straight; geniculate antennae ~ 1.2–1.6 rad). */
    antennaElbow: p(1.35, 'rad', 'ASM-MOR-003', { min: 0, max: 3 }),
    /** Leg segment lengths per pair [fore, mid, hind]. */
    coxa: p([0.09, 0.08, 0.1], 'x', 'ASM-MOR-004'),
    femur: p([0.21, 0.23, 0.27], 'x', 'ASM-MOR-004'),
    tibia: p([0.2, 0.22, 0.28], 'x', 'ASM-MOR-004'),
    tarsus: p([0.22, 0.24, 0.3], 'x', 'ASM-MOR-004'),
    /** Coxa attachment along the mesosoma (forward offset from its centre) per pair. */
    coxaAttach: p([0.12, 0.0, -0.1], 'x', 'ASM-MOR-004'),
    /** Vertical offset of head and gaster centres, as fractions of mesosoma height. */
    segmentRaise: p([0.15, 0.1], 'x', 'ASM-MOR-002'),
    /** Coxa base below / beside the mesosoma axis, as fractions of mesosoma height / width. */
    coxaBase: p([0.3, 0.35], 'x', 'ASM-MOR-004'),
    /** Coxa direction from straight down towards the side. */
    coxaAngle: p(0.785, 'rad', 'ASM-MOR-004', { min: 0, max: 1.6 }),
    /** Antennal socket on the head [forward, up, lateral] as fractions of head length / height / width. */
    antennaSocket: p([0.35, 0.15, 0.25], 'x', 'ASM-MOR-003'),
    /** Leg segment radii [femur, tibia, tarsus] and antenna radius. */
    legRadius: p([0.016, 0.012, 0.008], 'x', 'ASM-MOR-004'),
    antennaRadius: p(0.008, 'x', 'ASM-MOR-003', { min: 0 }),
    /** Scape posture while walking: elevation above the body axis and outward spread. */
    antennaPose: p([0.5, 0.55], 'rad', 'ASM-MOR-003'),
  },
  antennae: {
    sweepAmplitude: p(0.25, 'rad', 'ASM-SEN-001', { min: 0 }),
    sweepFrequency: p(2, '1/s', 'ASM-SEN-001', { min: 0 }),
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
    antColor: p([0.05, 0.045, 0.045], 'rgb', 'ENG-REN-010'),
    antLegColor: p([0.11, 0.085, 0.07], 'rgb', 'ENG-REN-010'),
    antEyeColor: p([0.015, 0.015, 0.02], 'rgb', 'ENG-REN-010'),
    antMandibleColor: p([0.22, 0.11, 0.05], 'rgb', 'ENG-REN-010'),
    /** Eye centre on the head [forward, up, lateral] as fractions of head length / height / width; eye depth / diameter. */
    eyePlacement: p([0.12, 0.2, 0.44], 'x', 'ENG-REN-008'),
    eyeFlatness: p(0.33, 'x', 'ENG-REN-008', { min: 0.05 }),
    /** Mandible centre [forward (× mandible length), up, lateral (× head)] and its height / width (× mandible length). */
    mandiblePlacement: p([0.3, -0.25, 0.18], 'x', 'ENG-REN-008'),
    mandibleShape: p([0.2, 0.25], 'x', 'ENG-REN-008'),
    /** Petiole scale raised above the body axis (× its height). */
    petioleRaise: p(0.1, 'x', 'ENG-REN-008'),
    /** Limb radius factors: coxa base, tarsus tip, antennal club. */
    limbTaper: p([1.2, 0.6, 1.3], 'x', 'ENG-REN-008'),
    antRoughness: p(0.45, 'x', 'ENG-REN-010', { min: 0, max: 1 }),
    /** Ants with legs solved on the terrain: at most this many, and only if at least this long on screen. */
    rigMaxAnts: p(64, 'count', 'ENG-REN-013', { min: 0, integer: true }),
    rigMinPixels: p(60, 'px', 'ENG-REN-013', { min: 1 }),
    /** Below this on-screen length an ant is drawn as a low-poly body without legs. */
    lod2Pixels: p(12, 'px', 'ENG-REN-013', { min: 0 }),
    /** Tessellation [sphere width, sphere height, limb radial] for near and far ants. */
    antDetail: p([14, 10, 6], 'count', 'ENG-REN-013'),
    antDetailFar: p([6, 4, 3], 'count', 'ENG-REN-013'),
    skyColor: p([0.62, 0.74, 0.86], 'rgb', 'ENG-REN-010'),
    hemiIntensity: p(1.2, 'x', 'ENG-REN-012', { min: 0 }),
    sunIntensity: p(2.2, 'x', 'ENG-REN-012', { min: 0 }),
    sunDirection: p([1, 2, 1.5], 'x', 'ENG-REN-012'),
    /** With the environment on: night sky colour, the fill light kept at night (moon, sky glow), the light level at which the sky is fully day-coloured. */
    nightSkyColor: p([0.03, 0.04, 0.08], 'rgb', 'ENG-REN-018'),
    /**
     * Observation (Phase 8): the ant's-eye camera (field of view; eye position as fractions of body
     * length ahead of and above the mesosoma centre; the point looked at, body lengths ahead),
     * picking an ant on screen, the marks for the observed ant, and state colours (one rgb triple
     * per AgentState: search, return, rest, nest search, dig, haul, re-enter, nest rest, nurse,
     * unload, exit). In the soil the ant view follows from behind instead (nestmates and brood
     * right in front fill a head camera): body lengths behind and above, looking antViewBehindLook
     * body lengths ahead of the ant, with the orbit camera's field of view.
     */
    antViewFov: p(100, 'deg', 'ENG-UI-002', { min: 10, max: 150 }),
    antViewEye: p([0.45, 0.18], 'x', 'ENG-UI-002'),
    antViewLook: p(4, 'x', 'ENG-UI-002', { min: 0.1 }),
    antViewBehind: p([3, 2], 'x', 'ENG-UI-002'),
    antViewBehindLook: p(1, 'x', 'ENG-UI-002', { min: 0 }),
    pickRadius: p(24, 'px', 'ENG-UI-002', { min: 1 }),
    inspectInterval: p(250, 'ms', 'ENG-UI-002', { min: 16 }),
    selectRing: p(1.2, 'x', 'ENG-UI-002', { min: 0.1 }),
    arrowHead: p(4, 'mm', 'ENG-UI-002', { min: 0 }),
    selectColor: p([1, 0.85, 0.2], 'rgb', 'ENG-UI-002'),
    homeVectorColor: p([0.2, 0.9, 1], 'rgb', 'ENG-UI-002'),
    trueNestColor: p([0.6, 0.6, 0.6], 'rgb', 'ENG-UI-002'),
    foodMemoryColor: p([1, 0.5, 0.15], 'rgb', 'ENG-UI-002'),
    stateColors: p([0.3, 0.55, 1, 1, 0.55, 0.1, 0.6, 0.6, 0.6, 0.75, 0.3, 1, 0.55, 0.38, 0.22, 0.85, 0.75, 0.35, 0.4, 0.8, 0.4, 0.45, 0.45, 0.5, 1, 0.45, 0.7, 1, 0.9, 0.2, 0.2, 0.9, 0.9], 'rgb', 'ENG-UI-002'),
    /** Water (Phase 7): colour, drop dome height / radius, falling raindrops (speed, streak opacity, most per frame, splash time). */
    waterColor: p([0.85, 0.92, 1], 'rgb', 'ENG-REN-019'),
    dropHeight: p(0.8, 'x', 'ENG-REN-019', { min: 0.01 }),
    rainSpeed: p(6500, 'mm/s', 'PHY-ENV-003', { min: 0 }),
    rainOpacity: p(0.3, 'x', 'ENG-REN-019', { min: 0, max: 1 }),
    dropOpacity: p(0.45, 'x', 'ENG-REN-019', { min: 0, max: 1 }),
    rainMaxStreaks: p(400, 'count', 'ENG-REN-019', { min: 1, integer: true }),
    rainSplash: p(0.3, 's', 'ENG-REN-019', { min: 0.01 }),
    /** Rain is drawn over a square this many camera distances wide round the point of interest. */
    rainExtentFactor: p(2, 'x', 'ENG-REN-019', { min: 0.1 }),
    nightLight: p(0.12, 'x', 'ENG-REN-018', { min: 0, max: 1 }),
    dayLight: p(0.3, 'x', 'ENG-REN-018', { min: 0.001, max: 1 }),
    interpolationLagTicks: p(1, 'tick', 'ENG-REN-009', { min: 0 }),
    interpolationSmoothing: p(0.2, 'x', 'ENG-REN-009', { min: 0.01, max: 1 }),
    minCameraDistance: p(0.3, 'mm', 'ENG-REN-007', { min: 0.01 }),
    maxCameraDistance: p(10000, 'mm', 'ENG-REN-007', { min: 1 }),
    maxPolarAngle: p(179, 'deg', 'ENG-REN-007', { min: 1, max: 180 }),
    gpuTiming: p(true, 'bool', 'ENG-PRF-002'),
    /** Experimental apparatus (Phase 3): walkway, nest and feeder surfaces, raised this far above the ground. */
    walkwayColor: p([0.82, 0.8, 0.74], 'rgb', 'ENG-REN-014'),
    nestColor: p([0.14, 0.1, 0.08], 'rgb', 'ENG-REN-014'),
    feederColor: p([0.93, 0.72, 0.3], 'rgb', 'ENG-REN-014'),
    apparatusLift: p(0.02, 'mm', 'ENG-REN-014', { min: 0 }),
    /** Nest and feeder discs of the homing scenario float this far above the natural ground. */
    siteLift: p(0.15, 'mm', 'ENG-REN-014', { min: 0 }),
    /** Initial camera distance from the apparatus centre, × its longest side. */
    apparatusView: p(0.9, 'x', 'ENG-REN-014', { min: 0.1 }),
    /** Pheromone heatmap: colour, opacity at saturation, the concentrations shown as faintest / saturated (log scale), refresh interval. */
    pheromoneColor: p([0.75, 0.15, 0.85], 'rgb', 'ENG-REN-015'),
    pheromoneOpacity: p(0.75, 'x', 'ENG-REN-015', { min: 0, max: 1 }),
    pheromoneRange: p([5, 1500], 'u', 'ENG-REN-015'),
    pheromoneInterval: p(200, 'ms', 'ENG-REN-015', { min: 16 }),
    showPheromone: p(true, 'bool', 'ENG-REN-015'),
    /** On open ground (colony) the heatmap is draped over the ground with vertices this far apart. */
    pheromoneDrape: p(4, 'mm', 'ENG-REN-015', { min: 0.5 }),
    /** Nest (Phase 5): colour of the cast of the dug space and of the spoil mound; soil chunks remeshed per refresh. */
    castColor: p([0.86, 0.82, 0.74], 'rgb', 'ENG-REN-016'),
    moundColor: p([0.48, 0.38, 0.28], 'rgb', 'ENG-REN-016'),
    castBudget: p(8, 'count', 'ENG-REN-016', { min: 1, integer: true }),
    /** Colony (Phase 6): the queen drawn this much larger than a worker; brood as ellipsoids [length, width] per stage (egg, fully grown larva, cocoon). */
    queenScale: p(1.7, 'x', 'ENG-REN-017', { min: 0.1 }),
    /** Opacity of the nest cast in a colony, so the queen, brood and workers inside show through. */
    castOpacity: p(0.35, 'x', 'ENG-REN-017', { min: 0, max: 1 }),
    broodSize: p([0.5, 0.35, 3.5, 1.6, 4.5, 2], 'mm', 'ENG-REN-017'),
    broodColor: p([0.95, 0.93, 0.86], 'rgb', 'ENG-REN-017'),
    cocoonColor: p([0.78, 0.66, 0.48], 'rgb', 'ENG-REN-017'),
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
  /** Double-bridge acceptance protocol (Phase 3; scripts/experiment-double-bridge.ts). */
  experiment: {
    trials: p(50, 'count', 'ENG-EXP-001', { min: 1, integer: true }),
    /**
     * Seed of the first trial (the others follow). The acceptance run uses
     * seeds not used while developing the model (those were sim.seed + k).
     */
    firstSeed: p(1, 'count', 'ENG-EXP-001', { min: 0, max: 0xffffffff, integer: true }),
    /**
     * Seed of the first homing trial (Phase 4). Development used seeds 1–50;
     * 2001– and 3001– were judged by earlier versions of the model.
     */
    homingFirstSeed: p(4001, 'count', 'ENG-EXP-002', { min: 0, max: 0xffffffff, integer: true }),
    /** Simulated time per trial. */
    duration: p(1800, 's', 'ENG-EXP-001', { min: 1 }),
    /** Traffic is counted in bins of this length. */
    bin: p(60, 's', 'ENG-EXP-001', { min: 1 }),
    /** Final window over which the short-branch share is measured. */
    window: p(300, 's', 'ENG-EXP-001', { min: 1 }),
    /** A trial has converged when the short branch carries more than this share of the crossings. */
    convergedShare: p(0.8, 'x', 'ENG-EXP-001', { min: 0, max: 1 }),
    /** The phase passes when at least this fraction of trials converge. */
    passFraction: p(0.8, 'x', 'ENG-EXP-001', { min: 0, max: 1 }),
    /** Phase 4 homing protocol: time allowed from the start of the return, the displacement, the search window and tolerance. */
    homingLimit: p(600, 's', 'ENG-EXP-002', { min: 1 }),
    displacement: p(200, 'mm', 'ENG-EXP-002', { min: 0 }),
    searchWindow: p(60, 's', 'ENG-EXP-002', { min: 1 }),
    searchTolerance: p(50, 'mm', 'ENG-EXP-002', { min: 0 }),
    /** Double bridge: wipe all pheromone at this time (0 = never). */
    wipeAt: p(0, 's', 'ENG-EXP-002', { min: 0 }),
    /** Phase 5 excavation protocol: group sizes, seeds per size, simulated time, bin for the rate. */
    digCounts: p([50, 100, 200, 400], 'count', 'ENG-EXP-003'),
    digSeeds: p(5, 'count', 'ENG-EXP-003', { min: 1, integer: true }),
    digFirstSeed: p(5001, 'count', 'ENG-EXP-003', { min: 0, max: 0xffffffff, integer: true }),
    digDuration: p(43200, 's', 'ENG-EXP-003', { min: 1 }),
    digBin: p(1800, 's', 'ENG-EXP-003', { min: 1 }),
    /** Saturation: the rate over the last lateFraction of the run below slowFraction of the peak bin rate. */
    lateFraction: p(0.2, 'x', 'ENG-EXP-003', { min: 0, max: 1 }),
    slowFraction: p(0.2, 'x', 'ENG-EXP-003', { min: 0, max: 1 }),
    /** Proportionality: R² of final volume on group size at least this. */
    minR2: p(0.9, 'x', 'ENG-EXP-003', { min: 0, max: 1 }),
    /** Phase 6 colony protocol (scripts/experiment-colony.ts): seeds (held out from development), from colonyFirstSeed. */
    colonySeeds: p(10, 'count', 'ENG-EXP-004', { min: 1, integer: true }),
    colonyFirstSeed: p(6001, 'count', 'ENG-EXP-004', { min: 0, max: 0xffffffff, integer: true }),
    /** Removal: warm-up, the window the forager count is averaged over, the time allowed to recover; recovered at this share of the count before. */
    removalWarmup: p(21600, 's', 'ENG-EXP-004', { min: 1 }),
    removalWindow: p(7200, 's', 'ENG-EXP-004', { min: 60 }),
    removalRecovery: p(21600, 's', 'ENG-EXP-004', { min: 60 }),
    recoveredShare: p(0.8, 'x', 'ENG-EXP-004', { min: 0, max: 1 }),
    /** Food economy: length of the run with and without food at the feeders. */
    economyDuration: p(172800, 's', 'ENG-EXP-004', { min: 3600 }),
    /** Recruitment: a hungry colony (crops this full at the start), the time its intake is counted, the ratio trails must reach. */
    recruitFill: p(0.1, 'x', 'ENG-EXP-004', { min: 0, max: 1 }),
    recruitDuration: p(10800, 's', 'ENG-EXP-004', { min: 600 }),
    recruitRatio: p(1.5, 'x', 'ENG-EXP-004', { min: 0 }),
    /** Recruits: naive workers sent out at the end of the recruitment run, and the time they are given to reach food. */
    recruits: p(50, 'count', 'ENG-EXP-004', { min: 1, integer: true }),
    recruitTime: p(180, 's', 'ENG-EXP-004', { min: 1 }),
    /** Phase 7 environment protocol (scripts/experiment-environment.ts): seeds held out from development. */
    envSeeds: p(10, 'count', 'ENG-EXP-005', { min: 1, integer: true }),
    envFirstSeed: p(7001, 'count', 'ENG-EXP-005', { min: 0, max: 0xffffffff, integer: true }),
    /** Day/night: run length, light counted as day, day/night forager ratio to reach; brood: hours compared and the reduction of its distance from broodTemp to reach. */
    dayDuration: p(172800, 's', 'ENG-EXP-005', { min: 3600 }),
    dayLight: p(0.2, 'x', 'ENG-EXP-005', { min: 0, max: 1 }),
    dayNightRatio: p(5, 'x', 'ENG-EXP-005', { min: 1 }),
    morningHours: p([9, 11], 'count', 'ENG-EXP-005'),
    afternoonHours: p([15, 17], 'count', 'ENG-EXP-005'),
    thermoReduction: p(0.3, 'x', 'ENG-EXP-005', { min: 0, max: 1 }),
    /** Temperature: a cool and a hot day's mean surface temperature against the default, run length, midday hours, the hot day's midday share of the default's to stay under, the cool day's delay of the start of foraging to reach (h). */
    coolTemp: p(16, 'degC', 'ENG-EXP-005'),
    hotTemp: p(32, 'degC', 'ENG-EXP-005'),
    middayHours: p([12, 16], 'count', 'ENG-EXP-005'),
    hotMiddayShare: p(0.3, 'x', 'ENG-EXP-005', { min: 0, max: 1 }),
    coolDelay: p(0.5, 'count', 'ENG-EXP-005', { min: 0 }),
    /** The temperature runs start before dawn (solar time). */
    tempStartHour: p(4, 'count', 'ENG-EXP-005', { min: 0, max: 24 }),
    tempDuration: p(43200, 's', 'ENG-EXP-005', { min: 600 }),
    /** Rain: the shower [start h after 06:00, duration h, mm/h]; foragers out counted from rainResponse after it starts; recovery time after it; shares to reach. */
    rainShower: p([6, 1, 10], 'x', 'ENG-EXP-005'),
    rainResponse: p(600, 's', 'ENG-EXP-005', { min: 0 }),
    rainRecovery: p(7200, 's', 'ENG-EXP-005', { min: 600 }),
    rainDuringShare: p(0.2, 'x', 'ENG-EXP-005', { min: 0, max: 1 }),
    rainAfterShare: p(0.5, 'x', 'ENG-EXP-005', { min: 0, max: 1 }),
    /** Recruitment to new food: the feeder [x, z, h after the start], the window after its discovery, the longest run. */
    newFood: p([-170, -90, 2], 'x', 'ENG-EXP-005'),
    newFoodWindow: p(7200, 's', 'ENG-EXP-005', { min: 60 }),
    newFoodLimit: p(36000, 's', 'ENG-EXP-005', { min: 600 }),
    /** The new feeder is the only food (no feeders from the start): recruitment to a first discovery. */
    newFoodAlone: p(true, 'bool', 'ENG-EXP-005'),
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
