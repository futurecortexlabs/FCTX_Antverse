/**
 * Plot the pheromone-wipe experiment: median food deliveries per minute over
 * the trials of each run, with the wipe time marked.
 *
 *   node scripts/plot-wipe.ts <wipe s> <out name> <run:label> [<run:label> ...]
 *
 * Reads docs/reports/phase-4/<run>-bins.csv; writes docs/reports/phase-4/<out name>.svg.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [wipeArg, outName, ...runs] = process.argv.slice(2);
if (!wipeArg || !outName || runs.length === 0) throw new Error('usage: plot-wipe.ts <wipe s> <out> <run:label>...');
const dir = 'docs/reports/phase-4';
const COLORS = ['#2463a6', '#c0392b', '#3d8b37', '#6b4c9a'];
const series = runs.map((r) => {
  const [run, label] = r.split(':') as [string, string];
  const rows = readFileSync(`${dir}/${run}-bins.csv`, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
  const byBin = new Map<number, number[]>();
  for (const row of rows) { const l = byBin.get(row[1]!) ?? []; l.push(row[5]!); byBin.set(row[1]!, l); }
  const med = [...byBin.entries()].sort((a, b) => a[0] - b[0]).map(([bin, v]) => {
    const s = v.sort((a, b) => a - b);
    return [(bin + 1), s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2] as const;
  });
  return { label, med };
});
const W = 720, H = 340, L = 56, R = 16, T = 36, B = 44;
const tMax = Math.max(...series.flatMap((s) => s.med.map((m) => m[0])));
const yMax = Math.ceil(Math.max(...series.flatMap((s) => s.med.map((m) => m[1]))) / 100) * 100;
const X = (t: number): number => L + (t / tMax) * (W - L - R);
const Y = (v: number): number => T + (1 - v / yMax) * (H - T - B);
const o: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="12">`,
  `<rect width="${W}" height="${H}" fill="#fbfaf7"/>`,
  `<text x="${L}" y="20" font-size="14" font-weight="600" fill="#222">Double bridge: food deliveries per minute (median of trials); all pheromone wiped at ${Number(wipeArg) / 60} min</text>`];
for (let v = 0; v <= yMax; v += yMax / 5) {
  o.push(`<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e4e1d8"/>`, `<text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" fill="#555">${v.toFixed(0)}</text>`);
}
for (let t = 0; t <= tMax; t += 5) o.push(`<text x="${X(t)}" y="${H - B + 18}" text-anchor="middle" fill="#555">${t}</text>`);
o.push(`<text x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle" fill="#333">simulated time (min)</text>`);
o.push(`<line x1="${X(Number(wipeArg) / 60)}" x2="${X(Number(wipeArg) / 60)}" y1="${T}" y2="${H - B}" stroke="#888" stroke-dasharray="5 4"/>`);
series.forEach((s, k) => {
  const c = COLORS[k % COLORS.length]!;
  o.push(`<polyline points="${s.med.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="2.2"/>`);
  o.push(`<text x="${L + 10}" y="${T + 16 + 16 * k}" fill="${c}">${s.label}</text>`);
});
o.push('</svg>');
writeFileSync(`${dir}/${outName}.svg`, o.join('\n') + '\n');
console.log(`wrote ${dir}/${outName}.svg`);
