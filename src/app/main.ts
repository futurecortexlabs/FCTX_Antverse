/**
 * App entry. URL options:
 *   ?seed=N  ?preset=name  ?set=path=value (repeatable)
 *   ?backend=webgl   force the WebGL2 backend
 *   ?bench=1         run the agent-count performance sweep
 */

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildConfig, parseUrlOptions, ConfigError, type Overlay } from '../config/load.ts';
import { MS_PER_S } from '../core/units.ts';
import { createRenderer } from '../render/renderer.ts';
import { buildReferenceScene } from '../render/scene-reference.ts';
import { AntInstances } from '../render/ants/ant-instances.ts';
import { SimHost } from './sim-host.ts';
import { Hud } from './hud/hud.ts';
import { RollingStats } from '../core/rolling-stats.ts';
import { BenchSweep, benchCsv } from '../bench/sweep.ts';
import { saveReportFile } from './report.ts';
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
  if (url.preset) {
    const preset = PRESETS[`/config/presets/${url.preset}.json`];
    if (!preset) fail(`Unknown preset "${url.preset}". Available: ${Object.keys(PRESETS).join(', ')}`);
    overlays.push(preset);
  }
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
  buildReferenceScene(scene, cfg);
  const ants = new AntInstances(cfg);
  scene.add(ants.mesh);

  const camera = new THREE.PerspectiveCamera(r.fov, 1, r.near, r.far);
  const [cx, cy, cz] = r.cameraStart;
  camera.position.set(cx!, cy!, cz!);
  const controls = new OrbitControls(camera, renderer.domElement);
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
  const hud = new Hud(cfg, {
    setSpeed: (s) => host.setSpeed(s),
    setPaused: (p) => host.setPaused(p),
    step: () => host.step(),
    determinismCheck: () => {
      hud.note('Determinism check running…');
      void host.determinismCheck(cfg.sim.determinismCheckTicks).then((rep) => hud.showDeterminism(rep));
    },
    screenshot: import.meta.env.DEV ? () => { pendingShot = `phase-0/shot-${Date.now()}.png`; } : undefined,
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
        reset: (count) => host.reset([...overlays, { debugWalk: { count } }]),
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
          note: 'Phase 0 placeholder bodies, debug random walk',
        });
        (window as unknown as { __antverseBench: unknown }).__antverseBench = { rows, csv };
        console.table(rows);
        hud.note(`<pre>${csv}</pre>`);
        if (import.meta.env.DEV) void saveReportFile(`bench/phase-0-${info.backend.toLowerCase()}.csv`, csv);
      })
    : null;

  // Expose a small handle for automated checks (DevTools / test harness).
  (window as unknown as { antverse: unknown }).antverse = { host, cfg, info, renderer, camera, controls, hud };

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const t0 = now;
    const interval = lastFrame > 0 ? now - lastFrame : 0;
    lastFrame = now;

    host.update(performance.timeOrigin + now);
    ants.update(host.interp);
    controls.update();
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
      }, host.stats, info, host.transport);
      if (bench && !bench.done) hud.note(bench.status());
    }
  });
}

void main();
