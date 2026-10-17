/**
 * Agent pool (Structure of Arrays). docs/ARCHITECTURE.md §4.1
 *
 * Slots are reused after death; a per-slot generation counter makes stale
 * references detectable: ref = (gen << SLOT_BITS) | slot.
 *
 * Only fields needed by the current phase are allocated. Later phases append
 * fields to AGENT_SCHEMA (appending keeps earlier state hashes meaningful).
 */

import { allocSoA, attachSoA, field, soaBuffers, soaViews, type SoA } from '../../core/soa.ts';

export const SLOT_BITS = 20;
export const MAX_CAPACITY = 1 << SLOT_BITS;
const GEN_MASK = (1 << (32 - SLOT_BITS)) - 1;

export const AgentFlag = {
  ALIVE: 1 << 0,
  /** Has found food before and remembers where (the food vector foodX/foodZ). */
  KNOWS_FOOD: 1 << 1,
  /** Searching (for the nest or the food): on the way back through the search centre. */
  LOOP_BACK: 1 << 2,
  /** In the soil (walking the voxel lattice of the nest), not on the surface. */
  UNDERGROUND: 1 << 3,
  /** A nestmate right in front (avoid.ts): turn on the spot this tick instead of stepping (cleared by explore). */
  BLOCKED: 1 << 4,
  /** Back from a feeder with food this trip (colony; set when the crop is filled, cleared after unloading). */
  SUCCESS: 1 << 5,
  /** Recruited by a nestmate's display: out to forage, following the trail to food (colony). */
  RECRUIT: 1 << 6,
} as const;

export const Caste = {
  WORKER: 0,
  QUEEN: 1,
  MALE: 2,
  GYNE: 3,
} as const;

export const AGENT_SCHEMA = {
  // --- shared with the renderer (copied into snapshots) ---
  posX: field('f32'),
  posY: field('f32'),
  posZ: field('f32'),
  /** Orientation quaternion (x, y, z, w). */
  rot: field('f32', 4),
  /** Tripod-gait phase in [0, 1); advanced by distance / stride length. */
  gaitPhase: field('f32'),
  caste: field('u8'),
  flags: field('u8'),
  carryKind: field('u8'),
  // --- simulation only ---
  gen: field('u16'),
  speed: field('f32'),
  /** Yaw on the ground plane (rad). */
  heading: field('f32'),
  /** Body pitch (nose up +) and roll (right side down +), following the terrain (rad). */
  pitch: field('f32'),
  roll: field('f32'),
  /** Angular velocity of the heading (rad/s). */
  turnRate: field('f32'),
  /** Foraging state (AgentState). */
  state: field('u8'),
  /** Distance walked this tick (mm). */
  lastStep: field('f32'),
  /** Pheromone to lay at the current position at the end of this tick (u). */
  deposit: field('f32'),
  /** Turning rate requested by guidance rules (trail, homing) this tick (rad/s); explore applies it unless blocked. */
  steer: field('f32'),
  // --- Phase 4: path integration ---
  /** Displacement walked this tick (mm), as the body moved. */
  stepX: field('f32'),
  stepZ: field('f32'),
  /** Path-integration estimate of the ant's position relative to the nest (mm); the home vector is its negative. */
  piX: field('f32'),
  piZ: field('f32'),
  /** Remembered food site, in the same nest-centred estimate (valid with AgentFlag.KNOWS_FOOD). */
  foodX: field('f32'),
  foodZ: field('f32'),
  /** Current error of the celestial compass (rad), a slowly wandering process. */
  compassError: field('f32'),
  /** Odometer gain for the current trip (1 = exact). */
  odometer: field('f32'),
  /** Time since leaving the nest (s), and the search time after which this trip is given up. */
  tripTime: field('f32'),
  giveUp: field('f32'),
  /** Time since the home vector ran out without reaching the nest (s). */
  searchTime: field('f32'),
  /** While blocked by an obstacle or edge: the way the ant is turning (+1 left, −1 right); 0 when free. */
  avoidTurn: field('f32'),
  // --- Phase 5: digging ---
  /** Underground: the soil voxel the ant is walking to (Soil.index), −1 on the surface. */
  cell: field('i32'),
  /** Underground: direction of travel and body up (the wall's normal), unit vectors. */
  dirX: field('f32'),
  dirY: field('f32'),
  dirZ: field('f32'),
  upX: field('f32'),
  upY: field('f32'),
  upZ: field('f32'),
  /** Request for the end of the tick (Request) and its voxel (dig target). */
  request: field('u8'),
  requestCell: field('i32'),
  /** Carrying soil out: drop it once this far from the entrance (mm). */
  dumpAt: field('f32'),
  // --- Phase 6: colony life ---
  /** Simulated time of eclosion (s; negative for workers older than the run), and the age at which it dies. */
  born: field('f64'),
  lifespan: field('f32'),
  /**
   * Body reserve and crop (social stomach) contents (mg sugar). Written only in World.completeStep.
   * Physiology fields are f64: per-tick changes (≈1e-8 mg) are below f32 resolution.
   */
  reserve: field('f64'),
  crop: field('f64'),
  /** Task taken up (Task) and the response thresholds for foraging and nursing. */
  task: field('u8'),
  thetaF: field('f64'),
  thetaN: field('f64'),
  /** Perceived hunger (0–1): crop emptiness of self and contacts, averaged over colony.hungerMemory. */
  hunger: field('f64'),
  /** Nestmate in contact (slot), −1 for none. */
  partner: field('i32'),
  // --- Phase 7: environment ---
  /** Brood item carried (BroodStore index), −1 for none. Written only in World.completeStep. */
  load: field('i32'),
  /** Dazed by a raindrop or stuck in a water drop: seconds left (set in completeStep, counted down by explore). */
  stun: field('f32'),
  // --- nest shape ---
  /** Digging drive: crowding met in the nest, remembered over dig.driveTau (excavate.ts). */
  digDrive: field('f32'),
};

/** Changes to shared state an agent asks for; World.completeStep applies them in slot order. */
export const Request = {
  NONE: 0, DIG: 1, DROP: 2,
  /** Trophallaxis: pass crop contents to the partner (requestCell = its slot). */
  GIVE: 3,
  /** Feed the hungriest larva near the voxel requestCell. */
  FEED: 4,
  /** Fill the crop at the feeder it reached this tick. */
  FILL: 5,
  /** Pick up a brood item near the voxel requestCell (Phase 7). */
  PICK: 6,
  /** Put the carried brood item down where the ant stands. */
  PUT: 7,
} as const;

/** Tasks of the division of labour (Phase 6). IDLE workers walk, rest and dig in the nest. */
export const Task = { IDLE: 0, FORAGE: 1, NURSE: 2 } as const;

export const AgentState = {
  /** Searching / walking out from the nest. */
  SEARCH: 0,
  /** Carrying food back to the nest. */
  RETURN: 1,
  /** Inside the nest, not foraging (stands still). */
  REST: 2,
  /** Home vector run off without finding the nest: searching around where it should be. */
  NEST_SEARCH: 3,
  /** In the nest, walking the tunnels; digs where the soil face is and nestmates are many. */
  DIG: 4,
  /** Carrying a soil pellet: up and out of the nest, then away from the entrance to drop it. */
  HAUL: 5,
  /** Pellet dropped: back to the entrance and down into the nest. */
  REENTER: 6,
  /** Resting in the nest (stands still), in a cluster with nestmates. */
  NEST_REST: 7,
  /** Nursing: walking towards hungry brood and feeding it (Phase 6). */
  NURSE: 8,
  /** Back from foraging: passing the crop's food to nestmates in the nest. */
  UNLOAD: 9,
  /** Climbing out of the nest to forage. */
  EXIT: 10,
} as const;

export const CarryKind = { NONE: 0, FOOD: 1, SOIL: 2, BROOD: 3 } as const;

export type AgentSoA = SoA<typeof AGENT_SCHEMA>;

export class AgentStore {
  readonly capacity: number;
  readonly a: AgentSoA;
  /** One past the highest slot ever used; iterate [0, highWater). */
  highWater = 0;
  alive = 0;
  private free: number[] = [];

  /**
   * shared: allocate fields in SharedArrayBuffers (for multi-threaded stepping).
   * buffers: attach to another thread's shared fields instead of allocating.
   * Slot bookkeeping (highWater, alive, free list) belongs to the owning thread.
   */
  constructor(capacity: number, opts: { shared?: boolean; buffers?: Record<string, SharedArrayBuffer> } = {}) {
    if (capacity > MAX_CAPACITY) throw new Error(`AgentStore: capacity ${capacity} > ${MAX_CAPACITY}`);
    this.capacity = capacity;
    this.a = opts.buffers ? attachSoA(AGENT_SCHEMA, opts.buffers) : allocSoA(AGENT_SCHEMA, capacity, opts.shared === true);
  }

  sharedBuffers(): Record<string, SharedArrayBuffer> {
    return soaBuffers(this.a);
  }

  /** Allocate a slot. Reuses the most recently freed slot (deterministic LIFO). */
  spawn(caste: number): number {
    let slot: number;
    if (this.free.length > 0) slot = this.free.pop()!;
    else {
      if (this.highWater >= this.capacity) throw new Error('AgentStore: capacity exhausted');
      slot = this.highWater++;
    }
    const a = this.a;
    a.flags[slot] = AgentFlag.ALIVE;
    a.caste[slot] = caste;
    a.carryKind[slot] = 0;
    a.posX[slot] = 0;
    a.posY[slot] = 0;
    a.posZ[slot] = 0;
    a.rot.fill(0, slot * 4, slot * 4 + 4);
    a.rot[slot * 4 + 3] = 1;
    a.gaitPhase[slot] = 0;
    a.speed[slot] = 0;
    a.heading[slot] = 0;
    a.pitch[slot] = 0;
    a.roll[slot] = 0;
    a.turnRate[slot] = 0;
    a.state[slot] = 0;
    a.lastStep[slot] = 0;
    a.deposit[slot] = 0;
    a.steer[slot] = 0;
    a.stepX[slot] = 0;
    a.stepZ[slot] = 0;
    a.piX[slot] = 0;
    a.piZ[slot] = 0;
    a.foodX[slot] = 0;
    a.foodZ[slot] = 0;
    a.compassError[slot] = 0;
    a.odometer[slot] = 1;
    a.tripTime[slot] = 0;
    a.giveUp[slot] = 0;
    a.searchTime[slot] = 0;
    a.avoidTurn[slot] = 0;
    a.cell[slot] = -1;
    a.dirX[slot] = 1; a.dirY[slot] = 0; a.dirZ[slot] = 0;
    a.upX[slot] = 0; a.upY[slot] = 1; a.upZ[slot] = 0;
    a.request[slot] = 0;
    a.requestCell[slot] = -1;
    a.dumpAt[slot] = 0;
    a.born[slot] = 0;
    a.lifespan[slot] = 0;
    a.reserve[slot] = 0;
    a.crop[slot] = 0;
    a.task[slot] = 0;
    a.thetaF[slot] = 0;
    a.thetaN[slot] = 0;
    a.hunger[slot] = 0;
    a.partner[slot] = -1;
    a.load[slot] = -1;
    a.stun[slot] = 0;
    this.alive++;
    return slot;
  }

  kill(slot: number): void {
    const a = this.a;
    if ((a.flags[slot]! & AgentFlag.ALIVE) === 0) return;
    a.flags[slot] = 0;
    a.gen[slot] = (a.gen[slot]! + 1) & GEN_MASK;
    this.free.push(slot);
    this.alive--;
  }

  isAlive(slot: number): boolean {
    return (this.a.flags[slot]! & AgentFlag.ALIVE) !== 0;
  }

  ref(slot: number): number {
    return ((this.a.gen[slot]! << SLOT_BITS) | slot) >>> 0;
  }

  /** Resolve a ref to its slot, or -1 if the agent has since died. */
  resolve(ref: number): number {
    const slot = ref & (MAX_CAPACITY - 1);
    const gen = ref >>> SLOT_BITS;
    return slot < this.highWater && this.isAlive(slot) && this.a.gen[slot] === gen ? slot : -1;
  }

  /** Slots awaiting reuse, in pop order from the end. Part of the hashed state. */
  freeSlots(): readonly number[] {
    return this.free;
  }

  /** Field views over the used range, in schema order (for state hashing). */
  views(): ArrayBufferView[] {
    return soaViews(AGENT_SCHEMA, this.a, this.highWater);
  }
}
