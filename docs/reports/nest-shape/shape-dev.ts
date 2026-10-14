// Dev: grow a colony nest from a small pit and print its shape.
// node shape.ts <hours> <seeds comma> [--set path=value ...]
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
const R = 'file:///C:/Users/futur/Documents/GitHub/FCTX_Antverse/';
const { buildConfig, overlayFromAssignment } = await import(R + 'src/config/load.ts');
const { DEFAULT_PARAMS } = await import(R + 'src/config/params.ts');
const { World } = await import(R + 'src/sim/world.ts');
const { AgentFlag, Caste } = await import(R + 'src/sim/agents/store.ts');

function run(seed: number, hours: number, sets: string[]): string {
  const ov = [JSON.parse(readFileSync('C:/Users/futur/Documents/GitHub/FCTX_Antverse/config/presets/field.json', 'utf8')), { soil: { pit: [3, 15] } }, { sim: { seed } }];
  for (const s of sets) { const i = s.indexOf('='); ov.push(overlayFromAssignment(DEFAULT_PARAMS, s.slice(0, i), s.slice(i + 1))); }
  const cfg = buildConfig(ov).config;
  const w = new World(cfg);
  const soil = w.soil!;
  const ticks = Math.round(hours * 3600 / cfg.sim.dt);
  for (let t = 0; t < ticks; t++) w.step();
  // Profile: dug voxels per 2 mm depth slice; side view (x vs depth, max over z), 2 mm cells.
  const cx = soil.voxelX(0), cz = soil.voxelZ(0), top = soil.airTop[cx + cz * soil.nx]!;
  const W = 40, H = 80, C = 2;
  const view: number[][] = Array.from({ length: H }, () => new Array(W).fill(0));
  const area: number[] = new Array(H).fill(0);
  let deepest = 0;
  for (let d = top; d < top + H * C; d++) for (let x = cx - W; x < cx + W; x++) for (let z = cz - W; z < cz + W; z++) {
    if (!soil.isDug(x, d, z)) continue;
    const row = Math.floor((d - top) / C);
    area[row]++;
    deepest = Math.max(deepest, d - top);
    const col = Math.floor((x - cx + W) / C);
    if (col >= 0 && col < W) view[row]![col]++;
  }
  // Where the workers are (depth), by age.
  const a = w.agents.a; const now = w.simTime(); const byDepth: number[][] = Array.from({ length: H }, () => [0, 0]);
  for (let s = 0; s < w.agents.highWater; s++) {
    if ((a.flags[s]! & AgentFlag.ALIVE) === 0 || a.caste[s] !== Caste.WORKER || (a.flags[s]! & AgentFlag.UNDERGROUND) === 0) continue;
    const row = Math.min(H - 1, Math.max(0, Math.floor(-a.posY[s]! / C)));
    byDepth[row]![(now - a.born[s]!) / 86400 < cfg.colony.ageScale ? 0 : 1]++;
  }
  const lines = [`seed ${seed} ${hours} h: dug ${soil.dug - w.pitVoxels} mm³, deepest ${deepest} mm`];
  for (let r = 0; r <= Math.min(H - 1, Math.floor(deepest / C)); r++) {
    lines.push(`${String(r * C).padStart(3)} ${view[r]!.map((n) => (n === 0 ? ' ' : n < 3 ? '.' : n < 8 ? 'o' : '#')).join('')} | ${String(area[r]).padStart(4)}  young ${byDepth[r]![0]} old ${byDepth[r]![1]}`);
  }
  return lines.join('\n');
}

if (isMainThread) {
  const [hours, seeds, ...rest] = process.argv.slice(2);
  const sets: string[] = []; for (let i = 0; i < rest.length; i++) if (rest[i] === '--set') sets.push(rest[++i]!);
  const out = await Promise.all(seeds!.split(',').map((s) => new Promise<string>((res, rej) => {
    const wk = new Worker(new URL(import.meta.url), { workerData: { seed: Number(s), hours: Number(hours), sets } });
    wk.on('message', res); wk.on('error', rej);
  })));
  console.log(out.join('\n\n'));
} else {
  parentPort!.postMessage(run(workerData.seed, workerData.hours, workerData.sets));
}
