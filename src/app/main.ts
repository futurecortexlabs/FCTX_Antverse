/**
 * App entry. URL options:
 *   ?seed=N  ?preset=name (or #name)  ?set=path=value (repeatable)
 *   ?backend=webgl   force the WebGL2 backend
 *   ?bench=1         run the agent-count performance sweep
 *   ?quality=ultra|web|mobile override the quality tier (see app/device.ts)
 */

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildConfig, parseUrlOptions, ConfigError, type Overlay } from '../config/load.ts';
import { MS_PER_S } from '../core/units.ts';
import { createRenderer } from '../render/renderer.ts';
import { AntRenderer } from '../render/ants/ant-renderer.ts';
import { Environment } from '../render/environment.ts';
import { GroundRenderer } from '../render/terrain/ground.ts';
import { GrainField, buildGrass, buildLeaves, buildPebbles } from '../render/terrain/surface-objects.ts';
import { applyCameraGuard } from '../render/terrain/camera-guard.ts';
import { focalPx } from '../render/terrain/quadtree.ts';
import { buildOverlays } from '../render/debug/overlays.ts';
import { apparatusFrame, buildApparatus, PheromoneOverlay } from '../render/apparatus.ts';
import { NestView } from '../render/nest.ts';
import { Mound } from '../soil/mound.ts';
import { DoubleBridge } from '../terrain/apparatus.ts';
import { Terrain } from '../terrain/terrain.ts';
import { SimHost } from './sim-host.ts';
import { SNAP_FLOATS, type SimStats } from '../worker/protocol.ts';
import { Hud } from './hud/hud.ts';
import { RollingStats } from '../core/rolling-stats.ts';
import { BenchSweep, benchCsv } from '../bench/sweep.ts';
import { saveReportFile } from './report.ts';
import { detectTier, readDeviceEnv } from './device.ts';
import { QualityGovernor } from './quality-governor.ts';
import './style.css';

const PRESETS = import.meta.glob<Overlay>('/config/presets/*.json', { eager: true, import: 'default' });
const DEG = Math.PI / 180;

function fail(msg: string): never {
  const el = document.createElement('div');
  el.className = 'fatal';
  el.textContent = msg;
  document.body.appendChild(el);
  throw new Error(msg);
}

async function main(): Promise<void> {
  const query = new URLSearchParams(location.search);
  const overlays: Overlay[] = [];
  let url;
  try {
    url = parseUrlOptions(location.search);
  } catch (e) {
    fail(e instanceof ConfigError ? e.message : String(e));
  }
  const preset = (name: string): Overlay => {
    const o = PRESETS[`/config/presets/${name}.json`];
    if (!o) fail(`Unknown preset "${name}". Available: ${Object.keys(PRESETS).join(', ')}`);
    return o;
  };
  // Quality tier first, so an explicit URL preset / ?set= can still override it.
  let threshold;
  try {
    threshold = buildConfig(url.overlays).config.device.mobileMaxShortSide;
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
  const tier = detectTier(readDeviceEnv(), threshold, query.get('quality'));
  overlays.push(preset(`quality-${tier}`));
  // A preset can also be named by the hash (#double-bridge): hosts that drop the query string keep it.
  const hashPreset = location.hash.slice(1);
  const presetName = url.preset ?? (PRESETS[`/config/presets/${hashPreset}.json`] ? hashPreset : null);
  if (presetName) overlays.push(preset(presetName));
  overlays.push(...url.overlays);
  let config;
  try {
    config = buildConfig(overlays).config;
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
  const cfg = config;
  const r = cfg.render;

  const { renderer, info } = await createRenderer(cfg, query.get('backend') === 'webgl');
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const env = new Environment(scene, cfg);
  if (cfg.terrainRender.shadows) renderer.shadowMap.enabled = true;
  // The same deterministic terrain the sim worker builds (identical by construction).
  const tGen = performance.now();
  const terrain = new Terrain(cfg);
  const ground = new GroundRenderer(terrain, cfg);
  scene.add(ground.group);
  scene.add(buildPebbles(terrain, cfg));
  scene.add(buildLeaves(terrain, cfg));
  scene.add(buildGrass(terrain, cfg));
  const grains = new GrainField(terrain, cfg);
  scene.add(grains.mesh);
  if (cfg.terrainRender.showScaleBar) scene.add(buildOverlays(cfg, terrain));
  const apparatus = buildApparatus(cfg, terrain);
  if (apparatus) scene.add(apparatus);
  const bridge = cfg.scenario.doubleBridge ? new DoubleBridge(cfg) : null;
  const terrainBuildMs = performance.now() - tGen;
  const ants = new AntRenderer(cfg);
  scene.add(ants.group);
  const probe = {
    support: (x: number, z: number): number => terrain.supportHeight(x, z),
    solid: (x: number, y: number, z: number): boolean => terrain.solidAt(x, y, z),
  };

  const camera = new THREE.PerspectiveCamera(r.fov, 1, r.near, r.far);
  const [cx, cy, cz] = r.cameraStart;
  const originY = terrain.supportHeight(0, 0);
  camera.position.set(cx!, originY + cy!, cz!);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, originY, 0);
  const frame = apparatusFrame(cfg);
  if (frame) {
    // Look at the whole apparatus from the usual start direction (render.cameraStart).
    const dir = new THREE.Vector3(cx!, cy!, cz!).normalize().multiplyScalar(frame.size * r.apparatusView);
    controls.target.set(frame.x, originY, frame.z);
    camera.position.set(frame.x + dir.x, originY + dir.y, frame.z + dir.z);
  }
  controls.enableDamping = true;
  controls.minDistance = r.minCameraDistance;
  controls.maxDistance = r.maxCameraDistance;
  controls.maxPolarAngle = r.maxPolarAngle * DEG;
  controls.zoomToCursor = true;

  const resize = (): void => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  const host = new SimHost(cfg, overlays, { onError: (m) => hud.note(`<b class="ng">worker error:</b> ${m}`) });

  let pendingShot: string | null = null;
  // Stop simulating while the page is hidden (battery on phones); resume only if we paused it.
  let autoPaused = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !host.paused) { autoPaused = true; host.setPaused(true); }
    else if (!document.hidden && autoPaused) { autoPaused = false; host.setPaused(false); }
  });
  const hud = new Hud(cfg, tier, {
    setSpeed: (s) => host.setSpeed(s),
    setPaused: (p) => { autoPaused = false; host.setPaused(p); },
    isPaused: () => host.paused,
    step: () => host.step(),
    determinismCheck: () => {
      hud.note('Determinism check running…');
      void host.determinismCheck(cfg.sim.determinismCheckTicks).then((rep) => hud.showDeterminism(rep));
    },
    screenshot: import.meta.env.DEV ? () => { pendingShot = `shots/shot-${Date.now()}.png`; } : undefined,
  });

  // --- performance measurement ---
  const window_ = cfg.perf.windowFrames;
  const frameMs = new RollingStats(window_);
  const cpuMs = new RollingStats(window_);
  const gpuMs = new RollingStats(window_);
  let lastFrame = 0;
  let lastGpu: number | null = null;
  let lastHud = 0;

  const bench = query.get('bench') === '1'
    ? new BenchSweep(cfg, {
        reset: (count) => host.reset([...overlays, { population: { count } }]),
        aliveInSnapshot: () => host.interp.alive,
        simMsPerTick: () => host.stats?.msPerTick ?? 0,
        achievedSpeed: () => host.stats?.achievedSpeed ?? 0,
      }, (rows) => {
        const csv = benchCsv(rows, {
          date: new Date().toISOString(),
          backend: info.backend,
          adapter: info.adapter,
          transport: host.transport,
          viewport: `${window.innerWidth}x${window.innerHeight}@${renderer.getPixelRatio()}`,
          note: 'Phase 6: terrain + walking workers (LOD0 legs solved), parallel sim, pheromone, path integration, nest excavation, colony life and division of labour',
        });
        (window as unknown as { __antverseBench: unknown }).__antverseBench = { rows, csv };
        console.table(rows);
        hud.note(`<pre>${csv}</pre>`);
        if (import.meta.env.DEV) void saveReportFile(`bench/phase-5-${info.backend.toLowerCase()}.csv`, csv);
      })
    : null;

  // Automatic quality reduction (web / mobile tiers); never during a benchmark.
  const governor = cfg.quality.auto && !bench
    ? new QualityGovernor({ pixelRatio: renderer.getPixelRatio(), maxScreenError: cfg.terrainRender.maxScreenError }, cfg.quality)
    : null;

  // Camera follow: keep the camera at a fixed world offset from one ant (debug / capture; Phase 8 builds on it).
  let follow: { slot: number; offset: [number, number, number] } | null = null;
  const followAnt = (slot: number | null, offset: [number, number, number] = [0, 3, 12]): void => {
    follow = slot === null ? null : { slot, offset };
  };

  // Expose a small handle for automated checks (DevTools / test harness).
  // Pheromone heatmap, rebuilt whenever the worker reports a new field (reset).
  let pheromone: PheromoneOverlay | null = null;
  let pheromoneFor: unknown = null;
  const syncPheromone = (now: number): void => {
    if (host.field !== pheromoneFor) {
      pheromoneFor = host.field;
      if (pheromone) { scene.remove(pheromone.mesh); pheromone.dispose(); pheromone = null; }
      if (host.field) { pheromone = new PheromoneOverlay(host.field, cfg, originY, cfg.scenario.colony ? terrain : undefined); scene.add(pheromone.mesh); }
    }
    if (pheromone && host.fieldData) pheromone.update(now, host.fieldData);
  };
  /** Ants between the forks on each branch (from the interpolated positions). */
  const bridgeLine = (): string => {
    if (!bridge) return '';
    const c = host.interp.curr;
    let s = 0, l = 0, nest = 0;
    for (let k = 0; k < host.interp.count; k++) {
      const x = c[k * SNAP_FLOATS]!, z = c[k * SNAP_FLOATS + 2]!;
      if (bridge.inNest(x, z)) nest++;
      else if (x > bridge.forkA + bridge.half && x < bridge.forkB - bridge.half) {
        if (z < 0) l++; else s++; // short branch above the axis, long below
      }
    }
    return `double bridge: short branch ${s} | long branch ${l} | in nest ${nest} | short ${bridge.lengthShort.toFixed(0)} mm, long ${bridge.lengthLong.toFixed(0)} mm`;
  };
  /** Foraging states, indexed like AgentState: search, return, rest, nest search. */
  const foragingLine = (f: { states: number[]; carrying: number }): string => cfg.scenario.colony
    ? `workers: out ${f.states[0]! + f.states[1]! + f.states[3]!} (with food ${f.carrying}) | unloading ${f.states[9] ?? 0} | nursing ${f.states[8] ?? 0} | idle in the nest ${(f.states[4] ?? 0) + (f.states[7] ?? 0)} | carrying soil ${f.states[5] ?? 0}`
    : cfg.scenario.digging
    ? `workers: walking in the nest ${f.states[4] ?? 0} | resting in the nest ${f.states[7] ?? 0} | carrying soil out ${f.states[5] ?? 0} | going back in ${f.states[6] ?? 0}`
    : `foraging: out ${f.states[0]} | heading home ${f.states[1]} (with food ${f.carrying}) | searching for the nest ${f.states[3]} | in nest ${f.states[2]}`;
  const colonyLine = (c: NonNullable<SimStats['colony']>): string =>
    `colony: tasks idle ${c.tasks[0]} / forage ${c.tasks[1]} / nurse ${c.tasks[2]} | brood eggs ${c.brood[0]} larvae ${c.brood[1]} pupae ${c.brood[2]} | food in ${c.intake.toFixed(1)} mg | crops ${(c.cropFill * 100).toFixed(0)} % full | eclosed ${c.eclosed} died ${c.died}${c.queen ? '' : ' | queen dead'}`;
  // Nest of a digging world: the cast of the dug space, the spoil mound, and the mound as a
  // height overlay of the terrain (for placing feet on it). Rebuilt when the worker reports a new nest.
  let nest: NestView | null = null;
  let nestFor: unknown = null;
  let moundMirror: Mound | null = null;
  let cutaway = false;
  let broodShown = -1;
  let lastNest = -Infinity;
  const surfaceObjects = (): THREE.Object3D[] => scene.children.filter((o) => ['ground', 'pebbles', 'leaves', 'grass', 'grains'].includes(o.name) || o === grains.mesh || o === ground.group);
  const syncNest = (now: number): void => {
    if (host.nest !== nestFor) {
      nestFor = host.nest;
      if (nest) { scene.remove(nest.group); nest = null; }
      terrain.overlay = null;
      moundMirror = null;
      if (host.nest) {
        nest = new NestView(cfg, terrain, host.nest);
        scene.add(nest.group);
        const mc = cfg.mound;
        moundMirror = new Mound({ cx: 0, cz: 0, radius: mc.radius, cell: mc.cell, repose: mc.repose, open: cfg.scenario.nestRadius }, host.nest.mound.shared ?? undefined);
        terrain.overlay = moundMirror;
        nest.setCutaway(cutaway, surfaceObjects());
      }
    }
    if (!nest || now - lastNest < r.pheromoneInterval) return;
    lastNest = now;
    if (host.soilChunks.length > 0) { nest.applyChunks(host.soilChunks); host.soilChunks = []; }
    const shared = host.nest?.mound.shared != null;
    if (!shared && host.moundData && moundMirror) moundMirror.heights.set(host.moundData);
    if (shared && host.moundData && nest.sharedMoundChanged(host.moundData)) host.moundVersion++;
    nest.update(host.moundData, host.moundVersion, r.castBudget);
    if (host.brood && host.broodVersion !== broodShown) { broodShown = host.broodVersion; nest.setBrood(host.brood); }
  };
  const setCutaway = (on: boolean): void => { cutaway = on; nest?.setCutaway(on, surfaceObjects()); };
  const togglePheromone = (on?: boolean): void => { if (pheromone) pheromone.mesh.visible = on ?? !pheromone.mesh.visible; };

  (window as unknown as { antverse: unknown }).antverse = { host, cfg, info, renderer, camera, controls, hud, terrain, ground, grains, terrainBuildMs, tier, governor, ants, followAnt, togglePheromone, setCutaway, nest: () => nest };

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const t0 = now;
    const interval = lastFrame > 0 ? now - lastFrame : 0;
    lastFrame = now;

    host.update(performance.timeOrigin + now);
    if (follow && follow.slot < host.interp.count) {
      const o = follow.slot * SNAP_FLOATS, c = host.interp.curr;
      controls.target.set(c[o]!, c[o + 1]!, c[o + 2]!);
      camera.position.set(c[o]! + follow.offset[0], c[o + 1]! + follow.offset[1], c[o + 2]! + follow.offset[2]);
    }
    controls.update();
    if (applyCameraGuard(terrain, cfg, camera.position, controls.target)) camera.lookAt(controls.target);
    const viewportPx = renderer.domElement.height / renderer.getPixelRatio();
    const focal = focalPx(camera.fov * DEG, viewportPx);
    ants.update(host.interp, camera.position, focal, probe);
    ground.update(camera.position, focal);
    grains.update(camera, viewportPx, cfg.terrainRender.genBudget);
    env.update(camera, controls.target);
    syncPheromone(now);
    syncNest(now);
    renderer.render(scene, camera);

    if (pendingShot) {
      const path = pendingShot;
      pendingShot = null;
      const data = renderer.domElement.toDataURL('image/png');
      void saveReportFile(path, data).then((ok) => hud.note(ok ? `saved docs/reports/${path}` : 'screenshot save failed'));
    }
    if (info.gpuTiming) void renderer.resolveTimestampsAsync('render').then((v) => { if (typeof v === 'number') lastGpu = v; });

    const cpu = performance.now() - t0;
    if (interval > 0) {
      frameMs.push(interval);
      cpuMs.push(cpu);
      if (lastGpu !== null) gpuMs.push(lastGpu);
      bench?.onFrame(now, interval, cpu, lastGpu);
      if (governor?.sample(now, interval, cpu, info.gpuTiming ? lastGpu : null)) {
        renderer.setPixelRatio(governor.knobs.pixelRatio);
        resize();
        ground.params.maxScreenError = governor.knobs.maxScreenError;
      }
    }

    if (now - lastHud >= cfg.perf.hudInterval) {
      lastHud = now;
      const mean = frameMs.mean();
      hud.render({
        fps: mean > 0 ? MS_PER_S / mean : 0,
        frameP50: frameMs.percentile(0.5),
        frameP95: frameMs.percentile(0.95),
        cpuMs: cpuMs.mean(),
        gpuMs: gpuMs.count > 0 ? gpuMs.mean() : null,
        visible: ants.visible,
      }, host.stats, info, host.transport, [
        `ground ${ground.stats.drawn} chunks (${ground.stats.pending} pending, ${ground.stats.cached} cached) | ${(ground.stats.triangles / 1000).toFixed(0)}k tris`,
        `grains ${grains.count} | pebbles ${terrain.pebbles.count} | leaves ${terrain.leaves.count} | grass ${terrain.grass.blades}`,
        `ants LOD0 (legs) ${ants.stats.lod0} | LOD1 ${ants.stats.lod1} | LOD2 ${ants.stats.lod2}`,
        `camera ${(camera.position.y - terrain.supportHeight(camera.position.x, camera.position.z)).toFixed(2)} mm above surface`,
        ...(bridge ? [bridgeLine()] : []),
        ...(host.stats?.foraging ? [foragingLine(host.stats.foraging)] : []),
        ...(host.stats?.colony ? [colonyLine(host.stats.colony)] : []),
        ...(host.stats?.digging ? [`nest: dug ${host.stats.digging.dug.toFixed(0)} mm³ | pellets on the mound ${host.stats.digging.pellets} | workers in the soil ${host.stats.digging.underground}${nest ? ` | cast chunks pending ${nest.pending}` : ''}`] : []),
        `quality ${tier} | pixel ratio ${renderer.getPixelRatio().toFixed(2)} | LOD error ≤ ${ground.params.maxScreenError.toFixed(1)} px${governor ? (governor.degraded() ? ' (auto: reduced)' : ' (auto)') : ''}`,
      ]);
      if (bench && !bench.done) hud.note(bench.status());
    }
  });
}

main().catch((e: unknown) => {
  console.error(e);
  if (document.querySelector('.fatal')) return; // already reported by fail()
  const el = document.createElement('div');
  el.className = 'fatal';
  el.textContent = `Antverse could not start: ${e instanceof Error ? e.message : String(e)}\nThis browser needs WebGPU or WebGL2.`;
  document.body.appendChild(el);
});
