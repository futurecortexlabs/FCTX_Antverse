import { defineConfig } from 'vite';
import { reportPlugin } from './scripts/vite-report-plugin.ts';

/**
 * Cross-origin isolation enables SharedArrayBuffer for zero-copy snapshots
 * between the sim worker and the renderer (docs/ARCHITECTURE.md §1).
 * Any production host must send the same two headers; without them the app
 * falls back to copying snapshots.
 */
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
  build: { target: 'es2023' },
  plugins: [reportPlugin()],
});
