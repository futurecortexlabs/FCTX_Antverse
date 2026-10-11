/**
 * Plot double-bridge runs: the short-branch share of crossings per bin for
 * every trial (thin lines), their median (thick), and the convergence
 * threshold. Reads <name>-bins.csv written by experiment-double-bridge.ts.
 *
 *   node scripts/plot-double-bridge.ts <name> [title] [threshold]
 *
 * Writes docs/reports/phase-3/<name>.svg.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [name = 'double-bridge', title = 'Short-branch share of crossings', thr = '0.8'] = process.argv.slice(2);
const dir = 'docs/reports/phase-3';
const rows = readFileSync(`${dir}/${name}-bins.csv`, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
// seed, bin, t_end_s, short, long, trips
const bySeed = new Map<number, { t: number; share: number | null }[]>();
for (const [seed, , t, s, l] of rows) {
  const list = bySeed.get(seed!) ?? [];
  list.push({ t: t! / 60, share: s! + l! > 0 ? s! / (s! + l!) : null });
  bySeed.set(seed!, list);
}
const W = 720, H = 360, L = 56, R = 16, T = 36, B = 44;
const tMax = Math.max(...rows.map((r) => r[2]!)) / 60;
const X = (t: number): number => L + (t / tMax) * (W - L - R);
const Y = (v: number): number => T + (1 - v) * (H - T - B);
const parts: string[] = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="12">`);
parts.push(`<rect width="${W}" height="${H}" fill="#fbfaf7"/>`);
parts.push(`<text x="${L}" y="20" font-size="14" font-weight="600" fill="#222">${title}</text>`);
for (let v = 0; v <= 1.0001; v += 0.2) {
  parts.push(`<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e4e1d8"/>`);
  parts.push(`<text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" fill="#555">${v.toFixed(1)}</text>`);
}
for (let t = 0; t <= tMax + 1e-9; t += 5) {
  parts.push(`<text x="${X(t)}" y="${H - B + 18}" text-anchor="middle" fill="#555">${t}</text>`);
}
parts.push(`<text x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle" fill="#333">simulated time (min)</text>`);
parts.push(`<line x1="${L}" x2="${W - R}" y1="${Y(Number(thr))}" y2="${Y(Number(thr))}" stroke="#c0392b" stroke-dasharray="5 4"/>`);
parts.push(`<text x="${W - R - 4}" y="${Y(Number(thr)) - 5}" text-anchor="end" fill="#c0392b">threshold ${thr}</text>`);
for (const list of bySeed.values()) {
  const pts = list.filter((p) => p.share !== null).map((p) => `${X(p.t).toFixed(1)},${Y(p.share!).toFixed(1)}`);
  parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="#6b4c9a" stroke-opacity="0.22" stroke-width="1"/>`);
}
const bins = Math.max(...[...bySeed.values()].map((l) => l.length));
const median: string[] = [];
for (let i = 0; i < bins; i++) {
  const v = [...bySeed.values()].map((l) => l[i]?.share).filter((s): s is number => s !== null && s !== undefined).sort((a, b) => a - b);
  if (v.length === 0) continue;
  const m = v.length % 2 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2;
  median.push(`${X((i + 1) * (tMax / bins)).toFixed(1)},${Y(m).toFixed(1)}`);
}
parts.push(`<polyline points="${median.join(' ')}" fill="none" stroke="#3d2466" stroke-width="2.5"/>`);
parts.push(`<text x="${L + 8}" y="${Y(0.04)}" fill="#3d2466">thin: each of ${bySeed.size} trials · thick: median</text>`);
parts.push('</svg>');
writeFileSync(`${dir}/${name}.svg`, parts.join('\n') + '\n');
console.log(`wrote ${dir}/${name}.svg`);
