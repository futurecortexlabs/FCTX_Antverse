/**
 * Turn the Vite build (dist/) into a page for a claude.ai Artifact, so the
 * app can be opened from a phone without running the dev server.
 *
 *   npx vite build && node scripts/artifact-page.ts
 *
 * Writes dist/artifact.html (page body only — the Artifact host adds the
 * document skeleton) and prints the `files` map of assets to publish with it.
 * Artifact pages are not cross-origin isolated, so the app runs with copied
 * snapshots instead of SharedArrayBuffer; WebGL2 is used where WebGPU is not
 * available.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? 'Antverse';
const scripts = [...html.matchAll(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g)].map((m) => m[1]!);
const styles = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g)].map((m) => m[1]!);
if (scripts.length === 0) throw new Error('no module script found in dist/index.html');

const page = [
  `<title>${title}</title>`,
  '<style>',
  '  /* Single dark look: a full-window 3D view with a dark HUD. */',
  '  :root { --bg: #111111; color-scheme: dark; }',
  '  html, body { height: 100%; background: var(--bg); }',
  '</style>',
  ...styles.map((s) => `<link rel="stylesheet" href="${s}">`),
  ...scripts.map((s) => `<script type="module" src="${s}"></script>`),
  '',
].join('\n');
writeFileSync('dist/artifact.html', page);

const files: Record<string, string> = {};
for (const f of readdirSync('dist/assets')) files[`assets/${f}`] = `dist/assets/${f}`;
console.log(JSON.stringify(files, null, 2));
