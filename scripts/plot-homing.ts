/**
 * Plot homing trajectories from <name>-paths.json (scripts/experiment-homing.ts):
 * small multiples, normal trials on the top row and displaced trials below.
 * Outbound search grey, homeward run blue, nest search orange; the nest is a
 * black dot, the fictive nest an open circle, the feeder amber.
 *
 *   node scripts/plot-homing.ts [name] [columns]
 *
 * Writes docs/reports/phase-4/<name>-paths.svg.
 */

import { readFileSync, writeFileSync } from 'node:fs';

type Sample = [number, number, number];
interface Trial { seed: number; returnIndex: number; fictive: [number, number]; feeder: [number, number, number] | null; reached: boolean; path: Sample[] }

const [name = 'homing', colsArg = '4'] = process.argv.slice(2);
const cols = Number(colsArg);
const dir = 'docs/reports/phase-4';
const data = JSON.parse(readFileSync(`${dir}/${name}-paths.json`, 'utf8')) as { normal: Trial[]; displaced: Trial[]; displacement: number };
const STATE_RETURN = 1, STATE_NEST_SEARCH = 3;
/** Seconds between path samples (experiment-homing.ts: every 15 ticks, every 2nd kept) and how much nest search to draw. */
const SAMPLE_S = 0.5, SEARCH_SHOWN_S = 120;
const P = 230, GAP = 14, TOP = 40, LABEL = 22;
const W = cols * P + (cols + 1) * GAP, H = TOP + 2 * (P + LABEL + GAP) + 30;
const out: string[] = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="11">`);
out.push(`<rect width="${W}" height="${H}" fill="#fbfaf7"/>`);
out.push(`<text x="${GAP}" y="22" font-size="14" font-weight="600" fill="#222">Homing by path integration, no pheromone — outbound search (grey), home run (blue), first ${SEARCH_SHOWN_S} s of nest search (orange)</text>`);

function panel(full: Trial, x0: number, y0: number, label: string): void {
  // Only the first SEARCH_SHOWN_S of nest search: the home run and where the search is centred.
  const firstSearch = full.path.findIndex((p, i) => i >= full.returnIndex && p[2] === STATE_NEST_SEARCH);
  const t = firstSearch < 0 ? full : { ...full, path: full.path.slice(0, firstSearch + Math.round(SEARCH_SHOWN_S / SAMPLE_S)) };
  // Square view around everything that matters, with a margin; 1 mm per unit, y = z.
  const pts = t.path.map((p) => [p[0], p[1]]);
  pts.push([0, 0], t.fictive);
  if (t.feeder) pts.push([t.feeder[0], t.feeder[1]]);
  const xs = pts.map((p) => p[0]!), zs = pts.map((p) => p[1]!);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 1.08 + 20;
  const k = P / span;
  const X = (x: number): number => x0 + P / 2 + (x - cx) * k;
  const Y = (z: number): number => y0 + P / 2 + (z - cz) * k;
  out.push(`<rect x="${x0}" y="${y0}" width="${P}" height="${P}" fill="#fff" stroke="#ddd8cc"/>`);
  const seg = (from: number, to: number, pred: (s: number) => boolean, color: string, w: number): void => {
    let d = '';
    for (let i = from; i < to; i++) {
      const p = t.path[i]!;
      if (!pred(p[2])) { d += ' '; continue; }
      d += `${d.endsWith(' ') || d === '' ? 'M' : 'L'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`;
    }
    const paths = d.split(' ').filter((s) => s.includes('L'));
    for (const p of paths) out.push(`<path d="${p}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round"/>`);
  };
  seg(0, t.returnIndex + 1, () => true, '#b9b4aa', 0.8);
  seg(t.returnIndex, t.path.length, (s) => s === STATE_RETURN, '#2463a6', 1.6);
  seg(t.returnIndex, t.path.length, (s) => s === STATE_NEST_SEARCH, '#e07b1f', 1);
  if (t.feeder) out.push(`<circle cx="${X(t.feeder[0])}" cy="${Y(t.feeder[1])}" r="${Math.max(2, t.feeder[2] * k)}" fill="#e3b04b"/>`);
  out.push(`<circle cx="${X(0)}" cy="${Y(0)}" r="3.5" fill="#222"/>`);
  if (t.fictive[0] !== 0 || t.fictive[1] !== 0) out.push(`<circle cx="${X(t.fictive[0])}" cy="${Y(t.fictive[1])}" r="5" fill="none" stroke="#222" stroke-width="1.5"/>`);
  // Scale bar: 100 mm.
  out.push(`<line x1="${x0 + 8}" x2="${x0 + 8 + 100 * k}" y1="${y0 + P - 8}" y2="${y0 + P - 8}" stroke="#555" stroke-width="1.5"/>`);
  out.push(`<text x="${x0 + 8}" y="${y0 + P - 12}" fill="#555">100 mm</text>`);
  out.push(`<text x="${x0}" y="${y0 + P + 15}" fill="#333">${label}</text>`);
}

const rows: [string, Trial[]][] = [['normal', data.normal], [`displaced ${data.displacement} mm (open circle: fictive nest)`, data.displaced]];
rows.forEach(([title, trials], r) => {
  const y0 = TOP + r * (P + LABEL + GAP) + 10;
  trials.slice(0, cols).forEach((t, c) => {
    const x0 = GAP + c * (P + GAP);
    panel(t, x0, y0, `${r === 0 ? 'normal' : 'displaced'} · seed ${t.seed}${r === 0 ? (t.reached ? ' · reached the nest' : ' · not home in time') : ''}`);
  });
  out.push(`<text x="${W - GAP}" y="${y0 - 3}" text-anchor="end" fill="#666">${title}</text>`);
});
out.push('</svg>');
writeFileSync(`${dir}/${name}-paths.svg`, out.join('\n') + '\n');
console.log(`wrote ${dir}/${name}-paths.svg`);
