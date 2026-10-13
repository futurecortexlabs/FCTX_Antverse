/**
 * Observation (Phase 8): how the person looks at the colony.
 *
 * Views (keys 1 / 2 / 3, or the buttons):
 *   overview  orbit camera over the ground (the default);
 *   section   the ground taken away, the camera free to go below the surface:
 *             the nest, its cast, the brood and the ants in the soil;
 *   ant       the eyes of one ant: the camera rides on its head, looking
 *             where it looks — on the ground or on a tunnel wall.
 * One ant is observed at a time: click (tap) one, or N / P for the next /
 * previous; Esc lets it go. Debug views (toggle keys): H the pheromone
 * heatmap, C ants coloured by state, V the observed ant's home vector and
 * memory; its details are in the HUD panel.
 *
 * Purely a view: it reads snapshots and asks the worker for copies of an
 * ant's state; nothing here changes the simulation.
 */

import * as THREE from 'three/webgpu';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Config } from '../config/params.ts';
import type { AntRenderer } from '../render/ants/ant-renderer.ts';
import { ObserverMarks, stateColor } from '../render/debug/observer-marks.ts';
import { META_BYTE, META_FLAG_SHIFT, SNAP_FLAG_ALIVE, STATE_NAMES, STATE_NONE, TASK_NAMES, type AntInfo } from '../worker/protocol.ts';
import type { Hud } from './hud/hud.ts';
import type { SimHost } from './sim-host.ts';

export type ViewMode = 'overview' | 'section' | 'ant';

export interface ObserverDeps {
  cfg: Config;
  host: SimHost;
  ants: AntRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  canvas: HTMLCanvasElement;
  hud: Hud;
  scene: THREE.Scene;
  setCutaway(on: boolean): void;
  /** Toggle the pheromone heatmap; returns whether it is now shown (null: no field in this world). */
  togglePheromone(): boolean | null;
}

export class Observer {
  mode: ViewMode = 'overview';
  selected: number | null = null;
  info: AntInfo | null = null;
  stateColors = false;
  vectors = true;
  private readonly d: ObserverDeps;
  private readonly marks: ObserverMarks;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly colors: Float32Array;
  private readonly pose = new Float32Array(7);
  private lastInspect = -Infinity;
  private pending = false;
  private readonly baseFov: number;

  constructor(d: ObserverDeps) {
    this.d = d;
    this.marks = new ObserverMarks(d.cfg);
    d.scene.add(this.marks.group);
    this.colors = new Float32Array(d.cfg.sim.capacity * 3).fill(1);
    this.baseFov = d.camera.fov;
    const b = (key: string, label: string, title: string, fn: () => void): void => { this.buttons.set(key, d.hud.addObserveButton(label, title, fn)); };
    b('overview', 'Overview', 'Orbit over the ground (1)', () => this.setMode('overview'));
    b('section', 'Section', 'Ground taken away: the nest and the ants in the soil (2)', () => this.setMode('section'));
    b('ant', 'Ant view', "Through the observed ant's eyes (3)", () => this.setMode('ant'));
    b('prev', '◀', 'Previous ant (P)', () => this.step(-1));
    b('next', '▶', 'Next ant (N)', () => this.step(1));
    b('heat', 'Pheromone', 'Pheromone heatmap (H)', () => this.toggleHeat());
    b('colors', 'States', 'Colour ants by state (C)', () => this.toggleColors());
    b('vectors', 'Vectors', "The observed ant's home vector and food memory (V)", () => { this.vectors = !this.vectors; this.refresh(); });
    window.addEventListener('keydown', (e) => this.onKey(e));
    d.canvas.addEventListener('pointerdown', (e) => { this.down = [e.clientX, e.clientY]; });
    d.canvas.addEventListener('pointerup', (e) => {
      // A click (not a drag of the orbit camera) picks the ant under the pointer.
      if (this.down && Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) < d.cfg.render.pickRadius / 2) this.pick(e.clientX, e.clientY);
      this.down = null;
    });
    this.heat = d.cfg.render.showPheromone;
    this.refresh();
  }

  private down: [number, number] | null = null;
  /** Whether the ground is cut away now. */
  private cut = false;
  private heat: boolean;

  setMode(m: ViewMode): void {
    const d = this.d;
    if (m === 'ant' && this.selected === null) this.selectNearCentre();
    if (m === 'ant' && this.selected === null) return;
    if (this.mode === 'ant' && m !== 'ant') {
      // Back to orbiting, round where the ant is.
      d.camera.fov = this.baseFov;
      d.camera.updateProjectionMatrix();
      d.camera.up.set(0, 1, 0);
      d.controls.enabled = true;
      if (this.d.ants.poseOf(this.selected ?? -1, this.pose)) {
        d.controls.target.set(this.pose[0]!, this.pose[1]!, this.pose[2]!);
        d.camera.position.set(this.pose[0]! + 15, this.pose[1]! + 12, this.pose[2]! + 15);
      }
    }
    this.mode = m;
    this.cut = m === 'section';
    d.setCutaway(this.cut);
    if (m === 'ant') {
      d.controls.enabled = false;
      d.camera.fov = d.cfg.render.antViewFov;
      d.camera.updateProjectionMatrix();
    }
    this.refresh();
  }

  /** The camera may go below the ground surface (no ground guard). */
  get freeCamera(): boolean {
    return this.mode !== 'overview';
  }

  select(slot: number | null): void {
    this.selected = slot;
    this.info = null;
    this.lastInspect = -Infinity;
    if (slot === null && this.mode === 'ant') this.setMode('overview');
    this.refresh();
  }

  /** Per frame, after the ants were updated (so their interpolated poses are current). */
  update(now: number): void {
    const d = this.d, cfg = d.cfg;
    if (now - this.lastInspect >= cfg.render.inspectInterval && !this.pending) {
      this.lastInspect = now;
      this.pending = true;
      const sel = this.selected;
      const jobs: Promise<unknown>[] = [];
      if (sel !== null) jobs.push(d.host.inspect(sel).then((info) => { if (this.selected === sel) { this.info = info; if (!info) this.select(null); } }));
      if (this.stateColors) jobs.push(d.host.states().then((st) => this.paint(st)));
      void Promise.all(jobs).finally(() => { this.pending = false; });
    }
    const have = this.selected !== null && d.ants.poseOf(this.selected, this.pose);
    if (have && this.mode === 'ant') {
      this.ride();
      // In the soil, see the tunnel walls (the cast) rather than the underside of the ground.
      const under = this.info?.underground ?? this.pose[1]! < 0;
      if (under !== this.cut) { this.cut = under; d.setCutaway(under); }
    }
    d.ants.hidden = this.mode === 'ant' && this.selected !== null ? this.selected : -1;
    if (have && this.mode !== 'ant') this.marks.update(this.pose[0]!, this.pose[1]!, this.pose[2]!, this.info, this.vectors);
    else this.marks.update(0, 0, 0, null, false);
    d.ants.colors = this.stateColors ? this.colors : null;
    d.hud.setPanel(this.panelText());
  }

  // ---------------------------------------------------------------------------

  /** The camera on the ant's head: eye antViewEye body lengths ahead / up, looking antViewLook ahead. */
  private ride(): void {
    const d = this.d, r = d.cfg.render, L = d.cfg.ant.workerBodyLength;
    const q = new THREE.Quaternion(this.pose[3]!, this.pose[4]!, this.pose[5]!, this.pose[6]!);
    const at = new THREE.Vector3(this.pose[0]!, this.pose[1]!, this.pose[2]!);
    const [ahead, up] = r.antViewEye as readonly [number, number];
    const eye = new THREE.Vector3(ahead! * L, up! * L, 0).applyQuaternion(q).add(at);
    const look = new THREE.Vector3(r.antViewLook * L, 0, 0).applyQuaternion(q).add(at);
    const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    d.camera.position.copy(eye);
    d.camera.up.copy(upv);
    d.camera.lookAt(look);
    d.controls.target.copy(look);
  }

  /** The ant whose drawn position is nearest the pointer (within pickRadius pixels). */
  private pick(clientX: number, clientY: number): void {
    const d = this.d, rect = d.canvas.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    const best = this.nearestOnScreen(px, py, rect.width, rect.height);
    if (best !== null) this.select(best);
  }

  private selectNearCentre(): void {
    const rect = this.d.canvas.getBoundingClientRect();
    const best = this.nearestOnScreen(rect.width / 2, rect.height / 2, rect.width, rect.height, Infinity);
    if (best !== null) this.select(best);
  }

  private nearestOnScreen(px: number, py: number, w: number, h: number, radius = this.d.cfg.render.pickRadius): number | null {
    const d = this.d, s = d.host.interp, v = new THREE.Vector3();
    let best: number | null = null, bestD = radius;
    for (let slot = 0; slot < s.count; slot++) {
      if (((s.currMeta[slot]! >>> META_FLAG_SHIFT) & META_BYTE & SNAP_FLAG_ALIVE) === 0) continue;
      if (!d.ants.poseOf(slot, this.pose)) continue;
      v.set(this.pose[0]!, this.pose[1]!, this.pose[2]!).project(d.camera);
      if (v.z > 1) continue; // behind the camera
      const sx = ((v.x + 1) / 2) * w, sy = ((1 - v.y) / 2) * h;
      const dist = Math.hypot(sx - px, sy - py);
      if (dist < bestD) { bestD = dist; best = slot; }
    }
    return best;
  }

  /** Next / previous living ant by slot. */
  private step(dir: number): void {
    const s = this.d.host.interp;
    if (s.count === 0) return;
    let slot = this.selected ?? (dir > 0 ? -1 : s.count);
    for (let k = 0; k < s.count; k++) {
      slot = (slot + dir + s.count) % s.count;
      if (((s.currMeta[slot]! >>> META_FLAG_SHIFT) & META_BYTE & SNAP_FLAG_ALIVE) !== 0) { this.select(slot); return; }
    }
  }

  private toggleHeat(): void {
    const on = this.d.togglePheromone();
    if (on !== null) this.heat = on;
    this.refresh();
  }

  private toggleColors(): void {
    this.stateColors = !this.stateColors;
    this.lastInspect = -Infinity;
    if (!this.stateColors) this.colors.fill(1);
    this.refresh();
  }

  private paint(st: Uint8Array): void {
    if (!this.stateColors) return;
    const n = Math.min(st.length / 2, this.colors.length / 3);
    for (let s = 0; s < n; s++) {
      const state = st[2 * s]!;
      if (state === STATE_NONE) { this.colors[3 * s] = 1; this.colors[3 * s + 1] = 1; this.colors[3 * s + 2] = 1; }
      else stateColor(this.d.cfg, state, this.colors, 3 * s);
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === '1') this.setMode('overview');
    else if (k === '2') this.setMode('section');
    else if (k === '3') this.setMode('ant');
    else if (k === 'n') this.step(1);
    else if (k === 'p') this.step(-1);
    else if (k === 'h') this.toggleHeat();
    else if (k === 'c') this.toggleColors();
    else if (k === 'v') { this.vectors = !this.vectors; this.refresh(); }
    else if (k === 'escape') this.select(null);
  }

  private refresh(): void {
    for (const [k, b] of this.buttons) {
      const on = k === this.mode || (k === 'heat' && this.heat) || (k === 'colors' && this.stateColors) || (k === 'vectors' && this.vectors);
      b.classList.toggle('active', on);
    }
  }

  private panelText(): string {
    const i = this.info;
    if (this.selected === null) return this.stateColors ? this.legend() : '';
    if (!i) return `ant #${this.selected}`;
    const st = STATE_NAMES[i.state] ?? `state ${i.state}`;
    const lines = [
      `ant #${i.slot}${i.caste === 1 ? ' (queen)' : ''} — ${st}${i.task ? ` / ${TASK_NAMES[i.task] ?? i.task}` : ''}${i.underground ? ' | in the soil' : ''}${i.recruit ? ' | recruited' : ''}${i.stun > 0 ? ` | dazed ${i.stun.toFixed(0)} s` : ''}`,
      `at (${i.x.toFixed(1)}, ${i.z.toFixed(1)}) mm, ${(-Math.min(0, i.y)).toFixed(0)} mm down | speed ${i.speed.toFixed(1)} mm/s`,
    ];
    const queen = i.caste === 1;
    // The queen stays in the nest: no home vector, no worker age or thresholds.
    if (i.nestX !== null && !queen) {
      const err = Math.hypot(i.homeX - i.nestX, i.homeZ - i.nestZ!);
      lines.push(`home vector → (${i.homeX.toFixed(1)}, ${i.homeZ.toFixed(1)}), ${err.toFixed(1)} mm off the entrance${i.foodX !== null ? ` | remembers food at (${i.foodX.toFixed(0)}, ${i.foodZ!.toFixed(0)})` : ''}`);
    }
    if (queen) lines.push(`crop ${i.crop.toFixed(3)} mg | reserve ${i.reserve.toFixed(3)} mg`);
    else if (i.ageDays > 0 || i.crop > 0) {
      lines.push(`age ${i.ageDays.toFixed(0)} d | crop ${i.crop.toFixed(3)} mg | reserve ${i.reserve.toFixed(3)} mg | hunger ${i.hunger.toFixed(2)} | θ forage ${i.thetaF.toFixed(2)} nurse ${i.thetaN.toFixed(2)}${i.carryingBrood ? ' | carrying brood' : ''}`);
    }
    return lines.join('\n') + (this.stateColors ? '\n' + this.legend() : '');
  }

  private legend(): string {
    return 'colours: ' + STATE_NAMES.map((n, k) => `${k}=${n}`).join(' · ');
  }
}
