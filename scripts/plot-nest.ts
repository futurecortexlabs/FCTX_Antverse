/**
 * Plot of the nest-shape acceptance run (ENG-EXP-006):
 *   <name>-profile.svg  horizontal area of the nest per 1 mm layer against depth, one line per
 *                       colony (a vertical profile: wide = chamber, narrow = shaft)
 *
 *   node scripts/plot-nest.ts [name]
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [name = 'nest'] = process.argv.slice(2);
const dir = 'docs/reports/nest-shape';
const rows = readFileSync(`${dir}/${name}-areas.csv`, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
const bySeed = new Map<number, [number, number][]>();
for (const [seed, depth, area] of rows) {
  const pts = bySeed.get(seed!) ?? [];
  pts.push([depth!, area!]);
  bySeed.set(seed!, pts);
}
const W = 560, H = 640, L = 56, R = 16, T = 36, B = 40;
const dMax = Math.ceil(Math.max(...rows.map((r) => r[1]!)) / 20) * 20;
const aMax = Math.ceil(Math.max(...rows.map((r) => r[2]!)) / 500) * 500;
// Depth runs down the page, area across: the profile reads like a cut through the nest.
const X = (a: number): number => L + (a / aMax) * (W - L - R), Y = (d: number): number => T + (d / dMax) * (H - T - B);
const o = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="12">`,
  `<rect width="${W}" height="${H}" fill="#fbfaf7"/>`,
  `<text x="${L}" y="20" font-size="14" font-weight="600" fill="#222">Nest area per 1 mm layer by depth (each line one colony, 12 h)</text>`];
for (let d = 0; d <= dMax; d += 20) o.push(`<line x1="${X(0)}" x2="${X(aMax)}" y1="${Y(d)}" y2="${Y(d)}" stroke="#e4e1d8"/>`, `<text x="${L - 8}" y="${Y(d) + 4}" text-anchor="end" fill="#555">${d}</text>`);
for (let a = 0; a <= aMax; a += aMax / 4) o.push(`<text x="${X(a)}" y="${H - 26}" text-anchor="middle" fill="#555">${a}</text>`);
o.push(`<text x="${W / 2}" y="${H - 6}" text-anchor="middle" fill="#333">area of the layer (mm²)</text>`,
  `<text x="12" y="${H / 2}" fill="#333" transform="rotate(-90 12 ${H / 2})" text-anchor="middle">depth below the surface (mm)</text>`);
for (const pts of bySeed.values()) {
  o.push(`<polyline points="${pts.map(([d, a]) => `${X(a).toFixed(1)},${Y(d).toFixed(1)}`).join(' ')}" fill="none" stroke="#2463a6" stroke-width="1" stroke-opacity="0.55"/>`);
}
o.push('</svg>');
writeFileSync(`${dir}/${name}-profile.svg`, o.join('\n') + '\n');
console.log(`wrote ${dir}/${name}-profile.svg`);
