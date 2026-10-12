/**
 * Drive the running dev server in a real, GPU-backed Chrome window through
 * the DevTools protocol (no extra dependencies: Node's fetch + WebSocket).
 * Uses a throwaway profile and disables background throttling so rAF keeps
 * running even if the window is covered.
 *
 *   node scripts/browser-run.ts smoke            # backend / adapter / FPS / determinism
 *   node scripts/browser-run.ts shots            # Phase 0 screenshots -> docs/reports/phase-0/
 *   node scripts/browser-run.ts eval '<expr>' [query]   # evaluate an expression in the running app
 *   node scripts/browser-run.ts walk             # Phase 2 walking views + frame sequence -> docs/reports/phase-2/
 *   node scripts/browser-run.ts bridge [seed]    # Phase 3 double bridge: stills + time-lapse -> docs/reports/phase-3/
 *   node scripts/browser-run.ts homing [seed]    # Phase 4 homing on open ground: stills -> docs/reports/phase-4/
 *   node scripts/browser-run.ts tiers            # quality tiers + automatic reduction on a throttled CPU
 *   node scripts/browser-run.ts terrain          # Phase 1 terrain views + metrics -> docs/reports/phase-1/
 *   node scripts/browser-run.ts bench [webgl]    # ?bench=1 sweep -> docs/reports/bench/
 *   node scripts/browser-run.ts colony [hours] [query]  # Phase 6 colony: foraging ground + nest -> docs/reports/phase-6/
 *   node scripts/browser-run.ts mobile [webgl|-] [url]  # phone emulation -> docs/reports/mobile/
 *
 * Requires `npm run dev` on http://localhost:5173.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.ANTVERSE_URL ?? 'http://localhost:5173/';
const PORT = Number(process.env.CDP_PORT ?? 9333);
const WIDTH = 1600;
const HEIGHT = 900;
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter((p): p is string => !!p);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

class Cdp {
  private id = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private ws: WebSocket;
  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (msg.id === undefined) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    });
  }
  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => { ws.addEventListener('open', () => res()); ws.addEventListener('error', () => rej(new Error('ws error'))); });
    return new Cdp(ws);
  }
  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise<T>((resolve, reject) => this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject }));
  }
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async waitFor(expression: string, timeoutMs: number): Promise<void> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await this.eval<boolean>(`!!(${expression})`).catch(() => false)) return;
      await sleep(250);
    }
    throw new Error(`timeout waiting for ${expression}`);
  }
  async goto(url: string): Promise<void> {
    await this.send('Page.navigate', { url });
    await this.waitFor('window.antverse && window.antverse.host.stats', 30000);
  }
  async screenshot(path: string): Promise<void> {
    const r = await this.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, Buffer.from(r.data, 'base64'));
    console.log(`saved ${path}`);
  }
  close(): void { this.ws.close(); }
}

async function launch(): Promise<{ chrome: ChildProcess; cdp: Cdp; profile: string }> {
  const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error('Chrome/Edge not found; set CHROME_PATH');
  const profile = join(tmpdir(), `antverse-cdp-${Date.now()}`);
  const chrome = spawn(exe, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank',
  ], { stdio: 'ignore' });
  let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
  for (let i = 0; i < 60 && targets.length === 0; i++) {
    await sleep(250);
    targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json() as Promise<typeof targets>).then((t) => t.filter((x) => x.type === 'page')).catch(() => []);
  }
  if (targets.length === 0) throw new Error('could not reach Chrome DevTools');
  const cdp = await Cdp.connect(targets[0]!.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  return { chrome, cdp, profile };
}

const HUD = `document.querySelector('.hud pre').textContent`;
const SETTLE = `new Promise(r => setTimeout(r, 3000))`;

async function smoke(cdp: Cdp): Promise<void> {
  for (const backend of ['', 'webgl']) {
    await cdp.goto(BASE + (backend ? `?backend=${backend}` : ''));
    await cdp.eval(SETTLE);
    console.log(`\n--- ${backend || 'default'} ---\n${await cdp.eval<string>(HUD)}`);
  }
  await cdp.goto(BASE);
  const rep = await cdp.eval(`window.antverse.host.determinismCheck(window.antverse.cfg.sim.determinismCheckTicks)`);
  console.log('\ndeterminism', JSON.stringify(rep, null, 1));
}

/** Place the camera: position and target in mm. */
const cam = (p: number[], t: number[]): string => `(() => { const a = window.antverse; a.camera.position.set(${p.join(',')}); a.controls.target.set(${t.join(',')}); a.controls.update(); })()`;

async function shots(cdp: Cdp): Promise<void> {
  const dir = 'docs/reports/phase-0';
  await cdp.goto(BASE);
  await cdp.eval(SETTLE);
  await cdp.screenshot(`${dir}/01-overview.png`);
  await cdp.eval(cam([12, 6, 12], [0, 0, 2]));
  await cdp.eval(SETTLE);
  await cdp.screenshot(`${dir}/02-scale-bar-10mm.png`);
  // Close to the ground: camera 0.8 mm above the surface next to an ant.
  await cdp.eval(`(() => { const a = window.antverse, s = a.host.interp; const x = s.curr[0], z = s.curr[2];
    a.camera.position.set(x + 4, 0.8, z + 4); a.controls.target.set(x, 0.5, z); a.controls.update(); })()`);
  await cdp.eval(`new Promise(r => setTimeout(r, 300))`);
  await cdp.eval(`window.antverse.host.setPaused(true)`);
  await cdp.eval(`new Promise(r => setTimeout(r, 500))`);
  await cdp.eval(`(() => { const a = window.antverse, s = a.host.interp; const x = s.curr[0], z = s.curr[2];
    a.camera.position.set(x + 4, 0.8, z + 4); a.controls.target.set(x, 0.5, z); a.controls.update(); })()`);
  await cdp.eval(`new Promise(r => setTimeout(r, 500))`);
  await cdp.screenshot(`${dir}/03-ground-level-0.8mm.png`);
  await cdp.eval(`window.antverse.host.setPaused(false)`);
  await cdp.goto(BASE + '?preset=ants-10k');
  await cdp.eval(SETTLE);
  await cdp.eval(cam([0, 260, 330], [0, 0, 0]));
  await cdp.eval(SETTLE);
  await cdp.screenshot(`${dir}/04-10k-agents.png`);
}

/**
 * Phase 1 terrain views from 1.5 m down to 0.2 mm above the surface, at spots
 * chosen from the terrain data itself (a grass tuft, a leaf, the largest
 * pebble, bare soil by the nest). Waits until all ground chunks are built.
 * Saves screenshots and per-view metrics to docs/reports/phase-1/.
 */
async function terrainViews(cdp: Cdp): Promise<void> {
  const dir = 'docs/reports/phase-1';
  await cdp.goto(BASE + '?set=population.count=300');
  const settle = `(async () => {
    const a = window.antverse; let calm = 0;
    for (let i = 0; i < 400 && calm < 6; i++) { await new Promise(r => setTimeout(r, 100)); calm = a.ground.busy ? 0 : calm + 1; }
    await new Promise(r => setTimeout(r, 1500));
  })()`;
  const views = await cdp.eval<{ name: string; cam: number[]; tgt: number[] }[]>(`(() => {
    const t = window.antverse.terrain, sup = (x, z) => t.supportHeight(x, z);
    const G = t.grass, L = t.leaves, P = t.pebbles;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < G.blades; i++) { const d = Math.hypot(G.base[3*i], G.base[3*i+2]); if (d < bd) { bd = d; bi = i; } }
    const bx = G.base[3*bi], bz = G.base[3*bi+2];
    let li = 0, ld = Infinity;
    for (let k = 0; k < L.count; k++) { const d = Math.hypot(L.cx[k], L.cz[k]); if (d < ld) { ld = d; li = k; } }
    let pi = 0;
    for (let i = 1; i < P.count; i++) if (P.radii[3*i] > P.radii[3*pi]) pi = i;
    const px = P.center[3*pi], pz = P.center[3*pi+2], pr = P.radii[3*pi];
    const lx = L.cx[li], lz = L.cz[li];
    const s0 = sup(0, 0);
    return [
      { name: '01-overview-1500mm', cam: [0, s0 + 1500, 1800], tgt: [0, s0, 0] },
      { name: '02-nest-area-100mm', cam: [70, s0 + 100, 90], tgt: [0, s0, 0] },
      { name: '03-grass-forest-ant-height-2mm', cam: [bx + 70, sup(bx + 70, bz + 70) + 2, bz + 70], tgt: [bx, sup(bx, bz) + 25, bz] },
      { name: '04-leaf-litter-15mm', cam: [lx + 25, sup(lx, lz) + 15, lz + 25], tgt: [lx, sup(lx, lz), lz] },
      { name: '05-pebble-' + (2 * pr).toFixed(0) + 'mm', cam: [px + 4 * pr, sup(px, pz) + 2 * pr, pz + 4 * pr], tgt: [px, sup(px, pz), pz] },
      { name: '06-bare-soil-5mm', cam: [3, sup(3, 3) + 5, 3], tgt: [-2, sup(-2, -2), -2] },
      { name: '07-ant-eye-1mm', cam: [4, sup(4, 0) + 1, 0], tgt: [-12, sup(-12, 0) + 0.5, 0] },
      { name: '08-grain-scale-0.2mm', cam: [1, sup(1, 1) + 0.2, 1], tgt: [-1, sup(-1, -1), -1] },
    ];
  })()`);
  const metrics: unknown[] = [];
  await cdp.eval(`window.antverse.host.setPaused(true)`);
  for (const v of views) {
    await cdp.eval(`(() => { const a = window.antverse; a.camera.position.set(${v.cam.join(',')}); a.controls.target.set(${v.tgt.join(',')}); a.controls.update(); })()`);
    await cdp.eval(settle);
    const m = await cdp.eval(`(() => {
      const a = window.antverse, t = a.terrain, c = a.camera.position;
      const hud = document.querySelector('.hud pre').textContent;
      const num = (re) => { const m = re.exec(hud); return m ? Number(m[1]) : null; };
      return { fps: num(/FPS ([0-9.]+)/), cpu: num(/main CPU ([0-9.]+) ms/), gpu: num(/GPU ([0-9.]+) ms/),
        clearance: c.y - t.supportHeight(c.x, c.z), ground: { ...a.ground.stats }, grains: a.grains.count };
    })()`);
    metrics.push({ view: v.name, ...(m as object) });
    console.log(v.name, JSON.stringify(m));
    await cdp.screenshot(`${dir}/${v.name}.png`);
  }
  writeFileSync(`${dir}/views.json`, JSON.stringify(metrics, null, 2));
}

/**
 * Quality tiers: start each tier on the dev server and report its settings
 * and frame rate; then run the web tier on a CPU throttled 6× (a slow PC)
 * and show what the automatic quality reduction did.
 */
async function tiers(cdp: Cdp): Promise<void> {
  const state = `(() => {
    const a = window.antverse, hud = document.querySelector('.hud pre').textContent;
    const num = (re) => { const m = re.exec(hud); return m ? Number(m[1]) : null; };
    return { tier: a.tier, fps: num(/FPS ([0-9.]+)/), cpu: num(/main CPU ([0-9.]+) ms/), gpu: num(/GPU ([0-9.]+) ms/),
      pixelRatio: a.renderer.getPixelRatio(), lodError: a.ground.params.maxScreenError, chunks: a.ground.stats.drawn,
      shadowMap: a.cfg.terrainRender.shadowMapSize, auto: !!a.governor, reduced: a.governor ? a.governor.degraded() : false };
  })()`;
  const near = `(() => { const a = window.antverse, t = a.terrain; a.camera.position.set(40, t.supportHeight(40, 0) + 2, 0); a.controls.target.set(0, t.supportHeight(0, 0) + 3, 0); a.controls.update(); })()`;
  for (const q of ['ultra', 'web', 'mobile']) {
    await cdp.goto(BASE + `?quality=${q}`);
    await cdp.eval(near);
    await cdp.eval('new Promise(r => setTimeout(r, 6000))');
    console.log(q, JSON.stringify(await cdp.eval(state)));
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await cdp.goto(BASE + '?quality=web');
  await cdp.eval(near);
  for (let i = 0; i < 4; i++) {
    await cdp.eval('new Promise(r => setTimeout(r, 5000))');
    console.log(`web, CPU ×6 slower, t=${(i + 1) * 5}s`, JSON.stringify(await cdp.eval(state)));
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  for (let i = 0; i < 3; i++) {
    await cdp.eval('new Promise(r => setTimeout(r, 5000))');
    console.log(`web, throttle removed, t=${(i + 1) * 5}s`, JSON.stringify(await cdp.eval(state)));
  }
}

/**
 * Phase 2 walking views: follow one ant (nearest the nest) and capture
 * stills from several angles plus a frame sequence for an animated GIF
 * (assembled by scripts/make-gif.py). Output: docs/reports/phase-2/.
 */
async function walkViews(cdp: Cdp): Promise<void> {
  const dir = 'docs/reports/phase-2';
  await cdp.goto(BASE + '?set=population.count=300');
  await cdp.eval('new Promise(r => setTimeout(r, 2500))');
  const slot = await cdp.eval<number>(`(() => { const s = window.antverse.host.interp; let best = 0, bd = Infinity;
    for (let i = 0; i < s.count; i++) { const o = i * 9, d = Math.hypot(s.curr[o], s.curr[o + 2]); if (d < bd) { bd = d; best = i; } } return best; })()`);
  const views: [string, number[]][] = [
    ['01-side', [0, 1.2, 9]], ['02-front-low', [8, 0.8, 2]], ['03-above', [2, 9, 3]], ['04-close-legs', [1.5, 0.6, 4.5]],
  ];
  for (const [name, off] of views) {
    await cdp.eval(`window.antverse.followAnt(${slot}, [${off.join(',')}])`);
    await cdp.eval('new Promise(r => setTimeout(r, 1500))');
    await cdp.screenshot(`${dir}/${name}.png`);
  }
  // Frame sequence at ×0.25 speed so each step is visible.
  await cdp.eval(`(() => { window.antverse.host.setSpeed(0.25); window.antverse.followAnt(${slot}, [0, 1.6, 8]); })()`);
  await cdp.eval('new Promise(r => setTimeout(r, 1500))');
  mkdirSync(`${dir}/seq`, { recursive: true });
  for (let k = 0; k < 24; k++) {
    await cdp.screenshot(`${dir}/seq/f${String(k).padStart(2, '0')}.png`);
    await cdp.eval('new Promise(r => setTimeout(r, 40))');
  }
  await cdp.eval(`(() => { window.antverse.followAnt(null); window.antverse.host.setSpeed(1); })()`);
}

/**
 * Phase 3 double bridge: the default view of the apparatus at several sim
 * times (fast-forwarded), a close-up of fork A, and a time-lapse frame
 * sequence for an animated GIF. Output: docs/reports/phase-3/.
 */
async function bridgeViews(cdp: Cdp, seed: string | undefined): Promise<void> {
  const dir = 'docs/reports/phase-3';
  await cdp.goto(BASE + `?preset=double-bridge&seed=${seed ?? 1}`);
  const simTime = (): Promise<number> => cdp.eval<number>('window.antverse.host.stats ? window.antverse.host.stats.simTime : 0');
  const runTo = async (t: number, speed: number): Promise<void> => {
    await cdp.eval(`window.antverse.host.setSpeed(${speed})`);
    while (await simTime() < t) await sleep(200);
    await cdp.eval('window.antverse.host.setSpeed(1)');
    await sleep(800);
  };
  const home = await cdp.eval<{ p: number[]; t: number[] }>(`(() => { const a = window.antverse; return { p: a.camera.position.toArray(), t: a.controls.target.toArray() }; })()`);
  const log: string[] = [];
  const shot = async (name: string): Promise<void> => {
    await cdp.screenshot(`${dir}/${name}.png`);
    log.push(`${name}: sim ${(await simTime()).toFixed(0)} s | ${(await cdp.eval<string>(HUD)).split('\n').find((l) => l.startsWith('double bridge')) ?? ''}`);
  };
  await runTo(20, 4);
  await shot('01-leaving-the-nest');
  await runTo(120, 16);
  await shot('02-two-minutes');
  await runTo(600, 32);
  await shot('03-ten-minutes');
  // Straight down (nest left, feeder right, short branch at +z = bottom of the image).
  const [tx, ty, tz] = home.t as [number, number, number];
  await cdp.eval(cam([tx, ty + 330, tz + 0.01], [tx, ty, tz]));
  await cdp.eval(`(() => { const a = window.antverse; a.camera.up.set(0, 0, -1); a.camera.lookAt(${tx}, ${ty}, ${tz}); })()`);
  await sleep(1200);
  await shot('04-ten-minutes-top-down');
  await cdp.eval(`window.antverse.camera.up.set(0, 1, 0)`);
  await cdp.eval(cam(home.p, home.t));
  await runTo(1200, 32);
  await shot('05-twenty-minutes');
  const y0 = await cdp.eval<number>('window.antverse.terrain.supportHeight(0, 0)');
  await cdp.eval(cam([-25, y0 + 28, 30], [8, y0, 0]));
  await sleep(1200);
  await shot('06-fork-a-close');
  await cdp.eval(cam([-6, y0 + 7, 9], [4, y0, 0]));
  await sleep(1200);
  await shot('07-fork-a-ant-level');
  await cdp.eval(`window.antverse.togglePheromone(false)`);
  await cdp.eval(cam(home.p, home.t));
  await sleep(1200);
  await shot('08-twenty-minutes-no-heatmap');
  writeFileSync(`${dir}/views.txt`, log.join('\n') + '\n');
  console.log(log.join('\n'));
  // Time-lapse from a fresh start: one frame per second of wall time at ×16.
  await cdp.goto(BASE + `?preset=double-bridge&seed=${seed ?? 1}`);
  mkdirSync(`${dir}/seq`, { recursive: true });
  await cdp.eval('window.antverse.host.setSpeed(16)');
  for (let k = 0; k < 60; k++) {
    await cdp.screenshot(`${dir}/seq/f${String(k).padStart(2, '0')}.png`);
    await sleep(1000);
  }
}

/**
 * Phase 4 homing on open ground: the default view, straight down, the nest
 * entrance close up, and a forager carrying food followed on its way home.
 * Output: docs/reports/phase-4/.
 */
async function homingViews(cdp: Cdp, seed: string | undefined): Promise<void> {
  const dir = 'docs/reports/phase-4';
  await cdp.goto(BASE + `?preset=homing&seed=${seed ?? 1}`);
  const simTime = (): Promise<number> => cdp.eval<number>('window.antverse.host.stats ? window.antverse.host.stats.simTime : 0');
  const runTo = async (t: number, speed: number): Promise<void> => {
    await cdp.eval(`window.antverse.host.setSpeed(${speed})`);
    while (await simTime() < t) await sleep(200);
    await cdp.eval('window.antverse.host.setSpeed(1)');
    await sleep(800);
  };
  const log: string[] = [];
  const shot = async (name: string): Promise<void> => {
    await cdp.screenshot(`${dir}/${name}.png`);
    log.push(`${name}: sim ${(await simTime()).toFixed(0)} s | ${(await cdp.eval<string>(HUD)).split('\n').find((l) => l.startsWith('foraging')) ?? ''}`);
  };
  const home = await cdp.eval<{ p: number[]; t: number[] }>(`(() => { const a = window.antverse; return { p: a.camera.position.toArray(), t: a.controls.target.toArray() }; })()`);
  await runTo(180, 16);
  await shot('01-three-minutes');
  const [tx, ty, tz] = home.t as [number, number, number];
  await cdp.eval(cam([tx, ty + 700, tz + 0.01], [tx, ty, tz]));
  await cdp.eval(`(() => { const a = window.antverse; a.camera.up.set(0, 0, -1); a.camera.lookAt(${tx}, ${ty}, ${tz}); })()`);
  await sleep(1200);
  await shot('02-top-down');
  await cdp.eval('window.antverse.camera.up.set(0, 1, 0)');
  const y0 = await cdp.eval<number>('window.antverse.terrain.supportHeight(0, 0)');
  await cdp.eval(cam([-30, y0 + 35, 40], [0, y0, 0]));
  await sleep(1200);
  await shot('03-nest-entrance');
  // Follow an ant carrying food (meta carry byte), the one farthest from the nest.
  const slot = await cdp.eval<number>(`(() => { const s = window.antverse.host.interp; let best = -1, bd = -1;
    for (let i = 0; i < s.count; i++) { if (((s.currMeta[i] >>> 16) & 0xff) === 0) continue; const o = i * 9, d = Math.hypot(s.curr[o], s.curr[o + 2]); if (d > bd) { bd = d; best = i; } } return best; })()`);
  if (slot >= 0) {
    await cdp.eval(`window.antverse.followAnt(${slot}, [0, 14, 40])`);
    await sleep(1500);
    await shot('04-carrying-food-home');
    await cdp.eval('window.antverse.followAnt(null)');
  }
  writeFileSync(`${dir}/views.txt`, log.join('\n') + '\n');
  console.log(log.join('\n'));
}

/**
 * Phase 5 nest excavation: fast-forward a digging colony, then views of the
 * spoil mound from the surface and of the nest cast with the ground cut away.
 * Output: docs/reports/phase-5/ (prefix lets several runs coexist).
 */
async function nestViews(cdp: Cdp, hoursArg: string | undefined, query: string | undefined): Promise<void> {
  const dir = 'docs/reports/phase-5';
  const hours = Number(hoursArg ?? 2);
  await cdp.goto(BASE + `?preset=digging${query ?? ''}`);
  const simTime = (): Promise<number> => cdp.eval<number>('window.antverse.host.stats ? window.antverse.host.stats.simTime : 0');
  await cdp.eval('window.antverse.host.setSpeed(100000)'); // MAX
  while (await simTime() < hours * 3600) await sleep(1000);
  await cdp.eval('window.antverse.host.setSpeed(1)');
  await sleep(3000);
  const log: string[] = [];
  const shot = async (name: string): Promise<void> => {
    await cdp.screenshot(`${dir}/${name}.png`);
    log.push(`${name}: sim ${(await simTime()).toFixed(0)} s | ${(await cdp.eval<string>(HUD)).split('\n').filter((l) => l.startsWith('foraging') || l.startsWith('nest')).join(' | ')}`);
  };
  const y0 = await cdp.eval<number>('window.antverse.terrain.supportHeight(0, 0)');
  await cdp.eval(cam([60, y0 + 45, 70], [0, y0, 0]));
  await sleep(1500);
  await shot('01-mound');
  await cdp.eval('window.antverse.setCutaway(true)');
  for (const [name, p, t] of [
    ['02-cast-side', [260, y0 - 60, 0], [0, y0 - 90, 0]],
    ['03-cast-oblique', [180, y0 + 40, 180], [0, y0 - 80, 0]],
    ['04-cast-close', [55, y0 - 15, 55], [0, y0 - 25, 0]],
  ] as [string, number[], number[]][]) {
    await cdp.eval(cam(p, t));
    await sleep(1500);
    await shot(name);
  }
  await cdp.eval('window.antverse.setCutaway(false)');
  writeFileSync(`${dir}/views.txt`, log.join('\n') + '\n');
  console.log(log.join('\n'));
}

/**
 * Phase 6 colony: fast-forward, then the foraging ground (trail heatmap on)
 * and the nest with the ground cut away (queen, brood, workers).
 * Output: docs/reports/phase-6/.
 */
async function colonyViews(cdp: Cdp, hoursArg: string | undefined, query: string | undefined): Promise<void> {
  const dir = 'docs/reports/phase-6';
  mkdirSync(dir, { recursive: true });
  const hours = Number(hoursArg ?? 1);
  await cdp.goto(BASE + `?preset=colony${query ?? ''}`);
  const simTime = (): Promise<number> => cdp.eval<number>('window.antverse.host.stats ? window.antverse.host.stats.simTime : 0');
  await cdp.eval('window.antverse.host.setSpeed(100000)'); // MAX
  while (await simTime() < hours * 3600) await sleep(1000);
  await cdp.eval('window.antverse.host.setSpeed(1)');
  await sleep(3000);
  const log: string[] = [];
  const shot = async (name: string): Promise<void> => {
    await cdp.screenshot(`${dir}/${name}.png`);
    log.push(`${name}: sim ${(await simTime()).toFixed(0)} s | ${(await cdp.eval<string>(HUD)).split('\n').filter((l) => l.startsWith('workers') || l.startsWith('colony') || l.startsWith('nest')).join(' | ')}`);
  };
  const y0 = await cdp.eval<number>('window.antverse.terrain.supportHeight(0, 0)');
  await cdp.eval('window.antverse.togglePheromone(true)');
  await cdp.eval(cam([30, y0 + 260, 200], [30, y0, 40]));
  await sleep(1500);
  await shot('01-foraging-ground');
  await cdp.eval('window.antverse.setCutaway(true)');
  for (const [name, p, t] of [
    ['02-nest-side', [120, y0 - 40, 0], [0, y0 - 45, 0]],
    // The camera stays above the ground surface: look down the shaft to its floor.
    ['03-nest-floor', [10, y0 + 4, 6], [0, y0 - 60, 0]],
  ] as [string, number[], number[]][]) {
    // Looking down the shaft, the mound's sheet (draped over the whole area round the entrance) is in the way.
    if (name === '03-nest-floor') await cdp.eval("window.antverse.nest().group.getObjectByName('mound').visible = false");
    await cdp.eval(cam(p, t));
    await sleep(1500);
    await shot(name);
  }
  await cdp.eval("window.antverse.nest().group.getObjectByName('mound').visible = true");
  await cdp.eval('window.antverse.setCutaway(false)');
  writeFileSync(`${dir}/views.txt`, log.join('\n') + '\n');
  console.log(log.join('\n'));
}

/**
 * Phase 7 environment: rain on the colony's ground (drops on leaves, falling
 * rain), the same place at night, and the nest's brood in the morning warmth.
 * Output: docs/reports/phase-7/.
 */
async function weatherViews(cdp: Cdp): Promise<void> {
  const dir = 'docs/reports/phase-7';
  mkdirSync(dir, { recursive: true });
  const log: string[] = [];
  const simTime = (): Promise<number> => cdp.eval<number>('window.antverse.host.stats ? window.antverse.host.stats.simTime : 0');
  const shot = async (name: string): Promise<void> => {
    await cdp.screenshot(`${dir}/${name}.png`);
    log.push(`${name}: sim ${(await simTime()).toFixed(0)} s | ${(await cdp.eval<string>(HUD)).split('\n').filter((l) => l.startsWith('environment') || l.startsWith('workers') || l.startsWith('colony')).join(' | ')}`);
  };
  const until = async (t: number): Promise<void> => {
    while (!(await cdp.eval<boolean>('!!(window.antverse && window.antverse.host && window.antverse.host.stats)'))) await sleep(500);
    await cdp.eval('window.antverse.host.setSpeed(100000)');
    while (await simTime() < t) await sleep(500);
    await cdp.eval('window.antverse.host.setSpeed(1)');
    await sleep(2500);
  };
  // 1. Rain at noon: 30 mm/h from the start for an hour.
  await cdp.goto(BASE + '?preset=field&set=env.startHour=11.5&set=env.rain=0,1,30');
  const y0 = await cdp.eval<number>('window.antverse.terrain.supportHeight(60, 40)');
  await until(1200);
  await cdp.eval(cam([75, y0 + 25, 70], [60, y0, 40]));
  await sleep(2000);
  await shot('01-rain-drops');
  await cdp.eval(cam([20, y0 + 120, 160], [20, y0, 20]));
  await sleep(2000);
  await shot('02-rain-overview');
  // 2. Night (22:00) over the same ground.
  await cdp.goto(BASE + '?preset=field&set=env.startHour=22');
  await until(60);
  await cdp.eval(cam([20, y0 + 120, 160], [20, y0, 20]));
  await sleep(2000);
  await shot('03-night');
  // 3. Late morning: brood brought up into the warm upper soil (cut-away).
  await cdp.goto(BASE + '?preset=field&set=env.startHour=6');
  await until(4 * 3600);
  await cdp.eval('window.antverse.setCutaway(true)');
  const yN = await cdp.eval<number>('window.antverse.terrain.supportHeight(0, 0)');
  await cdp.eval(cam([110, yN - 30, 0], [0, yN - 30, 0]));
  await sleep(2000);
  await shot('04-brood-morning');
  await cdp.eval('window.antverse.setCutaway(false)');
  writeFileSync(`${dir}/views.txt`, log.join('\n') + '\n');
  console.log(log.join('\n'));
}

/** Phone emulation (390x844 CSS px, DPR 3, touch). `base` lets you target a static/LAN/artifact URL. */
async function mobile(cdp: Cdp, base: string, backend: string | undefined): Promise<void> {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  const url = base + (backend ? `?backend=${backend}` : '');
  await cdp.goto(url);
  await cdp.eval(SETTLE);
  const state = await cdp.eval<Record<string, unknown>>(`(() => {
    const a = window.antverse, s = a.host.stats;
    return { tier: a.tier, coarse: matchMedia('(pointer: coarse)').matches, screen: [screen.width, screen.height], dpr: devicePixelRatio,
      pixelRatio: a.renderer.getPixelRatio(), backend: a.info.backend, depth: a.info.depth, transport: a.host.transport,
      isolated: crossOriginIsolated, collapsed: document.querySelector('.hud').classList.contains('collapsed'),
      summary: document.querySelector('.hud-summary').textContent, tick: s.tick, achieved: s.achievedSpeed };
  })()`);
  console.log(JSON.stringify(state, null, 1));
  const tag = backend ? `-${backend}` : '';
  await cdp.screenshot(`docs/reports/mobile/phone${tag}.png`);
  // Visibility auto-pause: hide the page, check the sim paused, show it again.
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  const paused = await cdp.eval(`(async () => {
    const h = window.antverse.host;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 600));
    const whileHidden = h.paused;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 600));
    return { whileHidden, afterVisible: h.paused };
  })()`);
  console.log('auto-pause', JSON.stringify(paused));
}

async function bench(cdp: Cdp, backend: string | undefined): Promise<void> {
  await cdp.goto(BASE + '?bench=1' + (backend ? `&backend=${backend}` : ''));
  await cdp.waitFor('window.__antverseBench', 15 * 60 * 1000);
  console.log(await cdp.eval<string>('window.__antverseBench.csv'));
}

async function main(): Promise<void> {
  const [cmd = 'smoke', arg] = process.argv.slice(2);
  const { chrome, cdp, profile } = await launch();
  try {
    if (cmd === 'smoke') await smoke(cdp);
    else if (cmd === 'shots') await shots(cdp);
    else if (cmd === 'terrain') await terrainViews(cdp);
    else if (cmd === 'tiers') await tiers(cdp);
    else if (cmd === 'walk') await walkViews(cdp);
    else if (cmd === 'bridge') await bridgeViews(cdp, arg);
    else if (cmd === 'homing') await homingViews(cdp, arg);
    else if (cmd === 'nest') await nestViews(cdp, arg, process.argv[4]);
    else if (cmd === 'colony') await colonyViews(cdp, arg, process.argv[4]);
    else if (cmd === 'weather') await weatherViews(cdp);
    else if (cmd === 'eval') { await cdp.goto(BASE + (process.argv[4] ?? '')); console.log(JSON.stringify(await cdp.eval(arg ?? 'null'), null, 1)); }
    else if (cmd === 'bench') await bench(cdp, arg);
    else if (cmd === 'mobile') await mobile(cdp, process.argv[4] ?? BASE, arg && arg !== '-' ? arg : undefined);
    else throw new Error(`unknown command ${cmd}`);
  } finally {
    cdp.close();
    chrome.kill();
    await sleep(1000);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* profile may still be locked */ }
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
