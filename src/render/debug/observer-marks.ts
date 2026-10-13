/**
 * Debug marks for the ant being observed (Phase 8): a ring round it, its
 * home vector (an arrow from the ant to where its path integration says the
 * nest is), a thin line to the true entrance (the gap is its navigation
 * error) and a line to the food site it remembers. Drawn over everything so
 * they stay visible behind grass and in the soil.
 */

import * as THREE from 'three/webgpu';
import type { Config } from '../../config/params.ts';
import type { AntInfo } from '../../worker/protocol.ts';

const RING_SEGMENTS = 32;
/** Vertices: ring (2 per segment), home arrow (shaft + 2 head strokes), true nest, food. */
const SEGMENTS = RING_SEGMENTS + 3 + 1 + 1;

export class ObserverMarks {
  readonly group = new THREE.Group();
  private readonly lines: THREE.LineSegments;
  private readonly pos: Float32Array;
  private readonly colors: Float32Array;
  private readonly cfg: Config;

  constructor(cfg: Config) {
    this.cfg = cfg;
    this.pos = new Float32Array(SEGMENTS * 2 * 3);
    this.colors = new Float32Array(SEGMENTS * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const mat = new THREE.LineBasicNodeMaterial({ vertexColors: true, depthTest: false, transparent: true });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.renderOrder = 10;
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
    this.group.visible = false;
  }

  /**
   * Show the marks for an ant at (x, y, z) (its interpolated position) with the observer's info;
   * `vectors` adds the home vector and memory lines.
   */
  update(x: number, y: number, z: number, info: AntInfo | null, vectors: boolean): void {
    const r = this.cfg.render;
    if (!info) { this.group.visible = false; return; }
    this.group.visible = true;
    const p = this.pos, c = this.colors;
    let v = 0;
    const seg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, col: readonly number[]): void => {
      p[v * 3] = ax; p[v * 3 + 1] = ay; p[v * 3 + 2] = az; c[v * 3] = col[0]!; c[v * 3 + 1] = col[1]!; c[v * 3 + 2] = col[2]!; v++;
      p[v * 3] = bx; p[v * 3 + 1] = by; p[v * 3 + 2] = bz; c[v * 3] = col[0]!; c[v * 3 + 1] = col[1]!; c[v * 3 + 2] = col[2]!; v++;
    };
    const R = r.selectRing * this.cfg.ant.workerBodyLength;
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a0 = (i / RING_SEGMENTS) * Math.PI * 2, a1 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2;
      seg(x + R * Math.cos(a0), y, z + R * Math.sin(a0), x + R * Math.cos(a1), y, z + R * Math.sin(a1), r.selectColor);
    }
    const hide = (): void => seg(x, y, z, x, y, z, r.selectColor);
    if (vectors && info.nestX !== null && !info.underground) {
      // Home vector: to where the ant believes the nest is, with an arrow head.
      const hx = info.homeX, hz = info.homeZ, dx = hx - x, dz = hz - z, len = Math.hypot(dx, dz) || 1;
      seg(x, y, z, hx, y, hz, r.homeVectorColor);
      const head = Math.min(len * 0.3, r.arrowHead), ux = dx / len, uz = dz / len;
      seg(hx, y, hz, hx - head * (ux + uz * 0.5), y, hz - head * (uz - ux * 0.5), r.homeVectorColor);
      seg(hx, y, hz, hx - head * (ux - uz * 0.5), y, hz - head * (uz + ux * 0.5), r.homeVectorColor);
      seg(x, y, z, info.nestX, y, info.nestZ!, r.trueNestColor);
      if (info.foodX !== null) seg(x, y, z, info.foodX, y, info.foodZ!, r.foodMemoryColor); else hide();
    } else {
      for (let k = 0; k < 5; k++) hide();
    }
    (this.lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.lines.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Colour per AgentState for the state view (render.stateColors, rgb triples in order). */
export function stateColor(cfg: Config, state: number, out: Float32Array, o: number): void {
  const t = cfg.render.stateColors as readonly number[];
  const k = (state % (t.length / 3)) * 3;
  out[o] = t[k]!; out[o + 1] = t[k + 1]!; out[o + 2] = t[k + 2]!;
}

