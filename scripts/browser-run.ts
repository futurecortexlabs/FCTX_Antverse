/**
 * Drive the running dev server in a real, GPU-backed Chrome window through
 * the DevTools protocol (no extra dependencies: Node's fetch + WebSocket).
 * Uses a throwaway profile and disables background throttling so rAF keeps
 * running even if the window is covered.
 *
 *   node scripts/browser-run.ts smoke            # backend / adapter / FPS / determinism
 *   node scripts/browser-run.ts shots            # report screenshots -> docs/reports/phase-0/
 *   node scripts/browser-run.ts bench [webgl]    # ?bench=1 sweep -> docs/reports/bench/
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
    else if (cmd === 'bench') await bench(cdp, arg);
    else throw new Error(`unknown command ${cmd}`);
  } finally {
    cdp.close();
    chrome.kill();
    await sleep(1000);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* profile may still be locked */ }
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
