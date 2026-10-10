/**
 * Dev-server-only endpoint: POST /__report/file?path=<rel> writes the request
 * body to docs/reports/<rel>. Lets the running app save screenshots and
 * benchmark CSVs straight into the phase reports.
 * Paths are restricted to [a-z0-9-_/] with a png/csv/json/md extension.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

const SAFE_PATH = /^[a-z0-9][a-z0-9\-_/]*\.(png|csv|json|md)$/;

export function reportPlugin(): Plugin {
  return {
    name: 'antverse-report',
    apply: 'serve',
    configureServer(server) {
      const root = resolve(server.config.root, 'docs', 'reports');
      server.middlewares.use('/__report/file', (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        const rel = url.searchParams.get('path') ?? '';
        const target = resolve(root, rel);
        if (req.method !== 'POST' || !SAFE_PATH.test(rel) || rel.includes('..') || !target.startsWith(root + sep)) {
          res.statusCode = 400;
          res.end('bad request');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          void mkdir(dirname(target), { recursive: true })
            .then(() => writeFile(target, Buffer.concat(chunks)))
            .then(() => { res.statusCode = 200; res.end('ok'); })
            .catch((e: unknown) => { res.statusCode = 500; res.end(String(e)); });
        });
      });
    },
  };
}
