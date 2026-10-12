/**
 * Plot the environment experiments (scripts/experiment-environment.ts):
 *   <name>-day.svg    foragers out and brood depth over two days (mean of colonies), with light
 *   <name>-brood.svg  the brood's distance from broodTemp over two days, carrying vs not
 *   <name>-temp.svg   foragers out over the day on a cool, normal and hot day (mean of colonies)
 *   <name>-rain.svg   foragers out around the midday shower (mean of colonies)
 *
 *   node scripts/plot-environment.ts [name]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [name = 'environment'] = process.argv.slice(2);
const dir = 'docs/reports/phase-7';
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
const nice = (v: number): number => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; };
const line = (pts: [number, number][], X: (v: number) => number, Y: (v: number) => number, color: string, width = 1.6): string =>
  `<polyline points="${pts.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
/** Mean over colonies of column `col`, by key (an x value). */
function meanBy(data: string[][], filter: (r: string[]) => boolean, xCol: number, yCol: number): [number, number][] {
  const sum = new Map<number, [number, number]>();
  for (const r of data.filter(filter)) {
    const x = Number(r[xCol]), y = Number(r[yCol]);
    const e = sum.get(x) ?? [0, 0];
    e[0] += y; e[1]++;
    sum.set(x, e);
  }
  return [...sum.entries()].sort((a, b) => a[0] - b[0]).map(([x, [s, n]]) => [x, s / n]);
}
const BLUE = '#2463a6', RED = '#b5321d', GREEN = '#4f7d2a', GREY = '#999';
const W = 760, H = 360, L = 56, R = 16, T = 36, B = 40;

if (existsSync(`${dir}/${name}-day-series.csv`)) {
  const d = rows(`${name}-day-series.csv`); // seed,carry,hour,out,depth,off,light
  const out = meanBy(d, (r) => r[1] === '1', 2, 3), depth = meanBy(d, (r) => r[1] === '1', 2, 4), light = meanBy(d, (r) => r[1] === '1', 2, 6);
  const hMax = Math.max(...out.map((p) => p[0])) + 1;
  // Hour index i is the hour 06:00 + i … + i + 1; plot at its middle.
  const X = (h: number): number => L + ((h + 0.5) / hMax) * (W - L - R);
  {
    const yMax = nice(Math.max(...out.map((p) => p[1])));
    const Y = (v: number): number => T + (1 - v / yMax) * (H - T - B);
    const o = frame(W, H, 'Foragers out on the surface (blue) and light (grey, 0–1 scaled), mean of colonies; hour 0 = 06:00');
    axes(o, X, Y, [0, 6, 12, 18, 24, 30, 36, 42], [0, yMax / 2, yMax], 'hours from 06:00 on day 1', 'foragers out', W, H);
    o.push(line(light.map(([h, l]) => [h, l * yMax]), X, Y, GREY), line(out, X, Y, BLUE), '</svg>');
    writeFileSync(`${dir}/${name}-day.svg`, o.join('\n') + '\n');
  }
  {
    const off1 = meanBy(d, (r) => r[1] === '1', 2, 5), off0 = meanBy(d, (r) => r[1] === '0', 2, 5);
    const dMax = nice(Math.max(...depth.map((p) => p[1]))), oMax = nice(Math.max(...off1.map((p) => p[1]), ...off0.map((p) => p[1])));
    const Y = (v: number): number => T + (1 - v / oMax) * (H - T - B);
    const o = frame(W, H, `Brood: distance from 28 °C with carrying (blue) and without (red); depth (green, 0–${dMax} mm scaled)`);
    axes(o, X, Y, [0, 6, 12, 18, 24, 30, 36, 42], [0, oMax / 2, oMax], 'hours from 06:00 on day 1', '|T − 28 °C| of the brood (°C)', W, H);
    o.push(line(depth.map(([h, z]) => [h, (z / dMax) * oMax]), X, Y, GREEN), line(off0, X, Y, RED), line(off1, X, Y, BLUE), '</svg>');
    writeFileSync(`${dir}/${name}-brood.svg`, o.join('\n') + '\n');
  }
}

if (existsSync(`${dir}/${name}-temp-series.csv`)) {
  const d = rows(`${name}-temp-series.csv`); // seed,mean_temp,minute,out
  const temps = [...new Set(d.map((r) => Number(r[1])))].sort((a, b) => a - b);
  const colors = [BLUE, GREEN, RED];
  const series = temps.map((t) => meanBy(d, (r) => Number(r[1]) === t, 2, 3));
  // Hourly means for readability.
  const hourly = series.map((s) => { const out: [number, number][] = []; for (let i = 0; i < s.length; i += 60) { const w = s.slice(i, i + 60); out.push([i / 60 + 0.5, w.reduce((p, x) => p + x[1], 0) / w.length]); } return out; });
  const hMax = Math.max(...hourly.map((s) => s.length));
  const yMax = nice(Math.max(...hourly.flatMap((s) => s.map((p) => p[1]))));
  const X = (h: number): number => L + (h / hMax) * (W - L - R), Y = (v: number): number => T + (1 - v / yMax) * (H - T - B);
  const o = frame(W, H, `Foragers out (hourly mean of colonies) on a ${temps.map((t, i) => `${t} °C (${['blue', 'green', 'red'][i]})`).join(', ')} day; hour 0 = 04:00`);
  axes(o, X, Y, [0, 2, 4, 6, 8, 10, 12].filter((h) => h <= hMax), [0, yMax / 2, yMax], 'hours from 04:00', 'foragers out', W, H);
  hourly.forEach((s, i) => o.push(line(s, X, Y, colors[i] ?? GREY)));
  o.push('</svg>');
  writeFileSync(`${dir}/${name}-temp.svg`, o.join('\n') + '\n');
}

if (existsSync(`${dir}/${name}-rain-series.csv`)) {
  const d = rows(`${name}-rain-series.csv`); // seed,minute,out
  const s = meanBy(d, () => true, 1, 2);
  // 10-minute means.
  const m: [number, number][] = [];
  for (let i = 0; i < s.length; i += 10) { const w = s.slice(i, i + 10); m.push([(i + 5) / 60, w.reduce((p, x) => p + x[1], 0) / w.length]); }
  const hMax = s.length / 60, yMax = nice(Math.max(...m.map((p) => p[1])));
  const X = (h: number): number => L + (h / hMax) * (W - L - R), Y = (v: number): number => T + (1 - v / yMax) * (H - T - B);
  const o = frame(W, H, 'Foragers out (10-min mean of colonies) around a 10 mm/h shower at 12:00–13:00 (shaded); hour 0 = 06:00');
  o.push(`<rect x="${X(6)}" y="${T}" width="${X(7) - X(6)}" height="${H - T - B}" fill="#d9e6f2"/>`);
  axes(o, X, Y, [0, 2, 4, 6, 8].filter((h) => h <= hMax), [0, yMax / 2, yMax], 'hours from 06:00', 'foragers out', W, H);
  o.push(line(m, X, Y, BLUE), '</svg>');
  writeFileSync(`${dir}/${name}-rain.svg`, o.join('\n') + '\n');
}
console.log('plots written to', dir);
