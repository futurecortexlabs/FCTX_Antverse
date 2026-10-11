/**
 * Plot the excavation experiment (scripts/experiment-digging.ts):
 *   <name>-volume.svg   cumulative volume dug over time, one line per run, by group size
 *   <name>-scaling.svg  final volume against group size, with the least-squares line
 *   <name>-depth.svg    dug volume per 10 mm of depth (median over runs), by group size
 *
 *   node scripts/plot-digging.ts [name]
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [name = 'digging'] = process.argv.slice(2);
const dir = 'docs/reports/phase-5';
const COLORS: Record<number, string> = { 50: '#7a9a3a', 100: '#2463a6', 200: '#b5651d', 400: '#8e2c6b' };
const colorOf = (n: number): string => COLORS[n] ?? '#555';

const binRows = readFileSync(`${dir}/${name}-bins.csv`, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
const runRows = readFileSync(`${dir}/${name}.csv`, 'utf8').split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('workers')).map((l) => l.split(','));

function frame(W: number, H: number, title: string): string[] {
  return [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="12">`,
    `<rect width="${W}" height="${H}" fill="#fbfaf7"/>`, `<text x="56" y="20" font-size="14" font-weight="600" fill="#222">${title}</text>`];
}
function axes(o: string[], X: (v: number) => number, Y: (v: number) => number, xs: number[], ys: number[], xl: string, yl: string, W: number, H: number): void {
  for (const y of ys) o.push(`<line x1="${X(xs[0]!)}" x2="${X(xs[xs.length - 1]!)}" y1="${Y(y)}" y2="${Y(y)}" stroke="#e4e1d8"/>`, `<text x="48" y="${Y(y) + 4}" text-anchor="end" fill="#555">${y}</text>`);
  for (const x of xs) o.push(`<text x="${X(x)}" y="${H - 26}" text-anchor="middle" fill="#555">${x}</text>`);
  o.push(`<text x="${W / 2}" y="${H - 6}" text-anchor="middle" fill="#333">${xl}</text>`, `<text x="12" y="${H / 2}" fill="#333" transform="rotate(-90 12 ${H / 2})" text-anchor="middle">${yl}</text>`);
}
const nice = (v: number): number => { const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; };

// --- volume over time ---
{
  const W = 720, H = 360, L = 56, R = 16, T = 36, B = 40;
  const runs = new Map<string, { n: number; pts: [number, number][] }>();
  for (const [n, seed, , t, dug] of binRows) {
    const k = `${n}-${seed}`;
    const r = runs.get(k) ?? { n: n!, pts: [[0, 0]] };
    r.pts.push([t! / 3600, r.pts[r.pts.length - 1]![1] + dug!]);
    runs.set(k, r);
  }
  const tMax = Math.max(...binRows.map((r) => r[3]!)) / 3600;
  const vMax = nice(Math.max(...[...runs.values()].map((r) => r.pts[r.pts.length - 1]![1])));
  const X = (t: number): number => L + (t / tMax) * (W - L - R), Y = (v: number): number => T + (1 - v / vMax) * (H - T - B);
  const o = frame(W, H, 'Soil dug over time (each line one run; colour = number of workers)');
  axes(o, X, Y, [0, 2, 4, 6, 8, 10, 12].filter((t) => t <= tMax), [0, vMax / 4, vMax / 2, (3 * vMax) / 4, vMax], 'simulated time (h)', 'volume dug (mm³)', W, H);
  for (const r of runs.values()) o.push(`<polyline points="${r.pts.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${colorOf(r.n)}" stroke-width="1.4" stroke-opacity="0.8"/>`);
  [...new Set([...runs.values()].map((r) => r.n))].sort((a, b) => a - b).forEach((n, i) => o.push(`<text x="${L + 10}" y="${T + 16 + 15 * i}" fill="${colorOf(n)}">N = ${n}</text>`));
  o.push('</svg>');
  writeFileSync(`${dir}/${name}-volume.svg`, o.join('\n') + '\n');
}

// --- final volume vs group size ---
{
  const W = 520, H = 360, L = 56, R = 16, T = 36, B = 40;
  const pts = runRows.map((r) => [Number(r[0]), Number(r[2])] as [number, number]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length, my = ys.reduce((s, y) => s + y, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; syy += (ys[i]! - my) ** 2; }
  const b = sxy / sxx, a = my - b * mx, r2 = (sxy * sxy) / (sxx * syy);
  const nMax = Math.max(...xs) * 1.05, vMax = nice(Math.max(...ys));
  const X = (n: number): number => L + (n / nMax) * (W - L - R), Y = (v: number): number => T + (1 - v / vMax) * (H - T - B);
  const o = frame(W, H, `Final volume vs workers: V = ${a.toFixed(0)} + ${b.toFixed(1)}·N mm³, R² = ${r2.toFixed(3)}`);
  axes(o, X, Y, [0, 100, 200, 300, 400].filter((n) => n <= nMax), [0, vMax / 4, vMax / 2, (3 * vMax) / 4, vMax], 'workers N', 'final volume (mm³)', W, H);
  o.push(`<line x1="${X(0)}" y1="${Y(a)}" x2="${X(nMax)}" y2="${Y(a + b * nMax)}" stroke="#999" stroke-dasharray="5 4"/>`);
  for (const [n, v] of pts) o.push(`<circle cx="${X(n).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="4" fill="${colorOf(n)}" fill-opacity="0.75"/>`);
  o.push('</svg>');
  writeFileSync(`${dir}/${name}-scaling.svg`, o.join('\n') + '\n');
}

// --- volume by depth ---
{
  const W = 520, H = 360, L = 56, R = 16, T = 36, B = 40;
  const byN = new Map<number, number[][]>();
  for (const r of runRows) { const n = Number(r[0]); const l = byN.get(n) ?? []; l.push((r[10] ?? '').split(' ').map(Number)); byN.set(n, l); }
  const bands = Math.max(...[...byN.values()].flat().map((d) => d.length));
  const med = (v: number[]): number => { const s = [...v].sort((p, q) => p - q); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };
  const series = [...byN.entries()].sort((p, q) => p[0] - q[0]).map(([n, runs]) => ({ n, v: Array.from({ length: bands }, (_, b) => med(runs.map((d) => d[b] ?? 0))) }));
  const vMax = nice(Math.max(...series.flatMap((s) => s.v)));
  const X = (v: number): number => L + (v / vMax) * (W - L - R), Y = (b: number): number => T + (b / bands) * (H - T - B);
  const o = frame(W, H, 'Volume per 10 mm of depth (median of runs)');
  for (let b = 0; b <= bands; b++) o.push(`<text x="48" y="${Y(b) + 4}" text-anchor="end" fill="#555">${b * 10}</text>`);
  for (const v of [0, vMax / 2, vMax]) o.push(`<text x="${X(v)}" y="${H - 26}" text-anchor="middle" fill="#555">${v}</text>`);
  o.push(`<text x="${W / 2}" y="${H - 6}" text-anchor="middle" fill="#333">volume (mm³)</text>`, `<text x="12" y="${H / 2}" fill="#333" transform="rotate(-90 12 ${H / 2})" text-anchor="middle">depth below the surface (mm)</text>`);
  for (const s of series) o.push(`<polyline points="${s.v.map((v, b) => `${X(v).toFixed(1)},${Y(b + 0.5).toFixed(1)}`).join(' ')}" fill="none" stroke="${colorOf(s.n)}" stroke-width="2"/>`);
  series.forEach((s, i) => o.push(`<text x="${W - R - 70}" y="${T + 16 + 15 * i}" fill="${colorOf(s.n)}">N = ${s.n}</text>`));
  o.push('</svg>');
  writeFileSync(`${dir}/${name}-depth.svg`, o.join('\n') + '\n');
}
console.log(`wrote ${dir}/${name}-{volume,scaling,depth}.svg`);
