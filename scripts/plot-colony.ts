/**
 * Plot the colony experiments (scripts/experiment-colony.ts):
 *   <name>-removal.svg   foragers over time (2-hour running mean), removal vs control, per colony
 *   <name>-economy.svg   food held by the adults over 48 h, with and without food at the feeders
 *   <name>-recruit.svg   food taken in by a hungry colony, with and without trail pheromone
 *
 *   node scripts/plot-colony.ts [name]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [name = 'colony'] = process.argv.slice(2);
const dir = 'docs/reports/phase-6';
const rows = (file: string): string[][] => readFileSync(`${dir}/${file}`, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).slice(1).map((l) => l.split(','));

function frame(W: number, H: number, title: string): string[] {
  return [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="12">`,
    `<rect width="${W}" height="${H}" fill="#fbfaf7"/>`, `<text x="56" y="20" font-size="14" font-weight="600" fill="#222">${title}</text>`];
}
function axes(o: string[], X: (v: number) => number, Y: (v: number) => number, xs: number[], ys: number[], xl: string, yl: string, W: number, H: number): void {
  for (const y of ys) o.push(`<line x1="${X(xs[0]!)}" x2="${X(xs[xs.length - 1]!)}" y1="${Y(y)}" y2="${Y(y)}" stroke="#e4e1d8"/>`, `<text x="48" y="${Y(y) + 4}" text-anchor="end" fill="#555">${+y.toFixed(2)}</text>`);
  for (const x of xs) o.push(`<text x="${X(x)}" y="${H - 26}" text-anchor="middle" fill="#555">${x}</text>`);
  o.push(`<text x="${W / 2}" y="${H - 6}" text-anchor="middle" fill="#333">${xl}</text>`, `<text x="12" y="${H / 2}" fill="#333" transform="rotate(-90 12 ${H / 2})" text-anchor="middle">${yl}</text>`);
}
const nice = (v: number): number => { const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; };
const line = (pts: [number, number][], X: (v: number) => number, Y: (v: number) => number, color: string, width = 1.3, opacity = 0.75): string =>
  `<polyline points="${pts.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="${opacity}"/>`;
const RED = '#b5321d', BLUE = '#2463a6';

if (existsSync(`${dir}/${name}-removal-series.csv`)) {
  const W = 720, H = 360, L = 56, R = 16, T = 36, B = 40;
  const series = new Map<string, number[]>();
  for (const [seed, removal, , f] of rows(`${name}-removal-series.csv`)) {
    const k = `${seed}-${removal}`;
    (series.get(k) ?? series.set(k, []).get(k)!).push(Number(f));
  }
  // 2-hour running means (120 one-minute samples).
  const smooth = (xs: number[]): [number, number][] => xs.map((_, i) => {
    const a = Math.max(0, i - 119), win = xs.slice(a, i + 1);
    return [(i + 1) / 60, win.reduce((p, x) => p + x, 0) / win.length];
  });
  const all = [...series.values()].map(smooth);
  const tMax = Math.max(...all.map((s) => s[s.length - 1]![0])), yMax = nice(Math.max(...all.flatMap((s) => s.map((p) => p[1]))));
  const X = (t: number): number => L + (t / tMax) * (W - L - R), Y = (v: number): number => T + (1 - v / yMax) * (H - T - B);
  const o = frame(W, H, 'Foragers (2-h running mean): half removed at 6 h (red) vs the same colony left intact (blue)');
  axes(o, X, Y, [0, 2, 4, 6, 8, 10, 12].filter((t) => t <= tMax), [0, yMax / 2, yMax], 'simulated time (h)', 'workers foraging', W, H);
  for (const [k, xs] of series) o.push(line(smooth(xs), X, Y, k.endsWith('-1') ? RED : BLUE));
  o.push(`<line x1="${X(6)}" x2="${X(6)}" y1="${T}" y2="${H - B}" stroke="#888" stroke-dasharray="4 3"/>`, '</svg>');
  writeFileSync(`${dir}/${name}-removal.svg`, o.join('\n') + '\n');
}

if (existsSync(`${dir}/${name}-economy-series.csv`)) {
  const W = 720, H = 360, L = 56, R = 16, T = 36, B = 40;
  const series = new Map<string, [number, number][]>();
  for (const [seed, food, t, f] of rows(`${name}-economy-series.csv`)) {
    const k = `${seed}-${food}`;
    (series.get(k) ?? series.set(k, []).get(k)!).push([Number(t), Number(f)]);
  }
  const all = [...series.values()];
  const tMax = Math.max(...all.map((s) => s[s.length - 1]![0])), yMax = nice(Math.max(...all.flatMap((s) => s.map((p) => p[1]))));
  const X = (t: number): number => L + (t / tMax) * (W - L - R), Y = (v: number): number => T + (1 - v / yMax) * (H - T - B);
  const o = frame(W, H, 'Food held by the adults (crops + reserves): with food at the feeders (blue) and without (red)');
  axes(o, X, Y, [0, 12, 24, 36, 48].filter((t) => t <= tMax), [0, yMax / 4, yMax / 2, (3 * yMax) / 4, yMax], 'simulated time (h)', 'food (mg sugar)', W, H);
  for (const [k, pts] of series) o.push(line(pts, X, Y, k.endsWith('-1') ? BLUE : RED));
  o.push('</svg>');
  writeFileSync(`${dir}/${name}-economy.svg`, o.join('\n') + '\n');
}

if (existsSync(`${dir}/${name}-recruit.csv`)) {
  const W = 720, H = 360, L = 56, R = 16, T = 36, B = 40;
  const runs = rows(`${name}-recruit.csv`).map((r) => ({ trails: r[1] === '1', pts: r[5]!.split(' ').map((v, i) => [(i + 1) / 6, Number(v)] as [number, number]) }));
  const tMax = Math.max(...runs.map((r) => r.pts[r.pts.length - 1]![0])), yMax = nice(Math.max(...runs.flatMap((r) => r.pts.map((p) => p[1]))));
  const X = (t: number): number => L + (t / tMax) * (W - L - R), Y = (v: number): number => T + (1 - v / yMax) * (H - T - B);
  const o = frame(W, H, 'Food taken in by a hungry colony: with trail pheromone (blue) and without (red)');
  axes(o, X, Y, [0, 1, 2, 3].filter((t) => t <= tMax), [0, yMax / 2, yMax], 'simulated time (h)', 'food taken in (mg)', W, H);
  for (const r of runs) o.push(line([[0, 0], ...r.pts], X, Y, r.trails ? BLUE : RED));
  o.push('</svg>');
  writeFileSync(`${dir}/${name}-recruit.svg`, o.join('\n') + '\n');
}
console.log('plots written to', dir);
