/**
 * Renderer bootstrap: WebGPU first, WebGL2 backend as fallback (both via
 * three's WebGPURenderer, so TSL materials work on either).
 *
 * Depth: the scene spans 0.05 mm (near) to 20 m (far) — a 4e5 ratio that a
 * standard depth buffer cannot resolve. Reversed-Z is requested; if the
 * backend cannot provide it, logarithmic depth is used instead.
 */

import * as THREE from 'three/webgpu';
import type { Config } from '../config/params.ts';

export type BackendName = 'WebGPU' | 'WebGL2';
export type DepthMode = 'reversed-z' | 'logarithmic' | 'standard';

export interface RendererInfo {
  backend: BackendName;
  depth: DepthMode;
  gpuTiming: boolean;
  adapter: string;
}

interface BackendInternals {
  isWebGPUBackend?: boolean;
  trackTimestamp?: boolean;
  device?: { adapterInfo?: { vendor?: string; architecture?: string; description?: string; device?: string } };
  gl?: WebGL2RenderingContext;
}

async function tryCreate(cfg: Config, forceWebGL: boolean, depth: DepthMode): Promise<THREE.WebGPURenderer> {
  const renderer = new THREE.WebGPURenderer({
    antialias: cfg.render.antialias,
    forceWebGL,
    powerPreference: 'high-performance',
    reversedDepthBuffer: depth === 'reversed-z',
    logarithmicDepthBuffer: depth === 'logarithmic',
    trackTimestamp: cfg.render.gpuTiming,
  });
  await renderer.init();
  return renderer;
}

function adapterName(backend: BackendInternals): string {
  const info = backend.device?.adapterInfo;
  if (info) {
    const parts = [info.vendor, info.architecture, info.description || info.device].filter((s) => s);
    if (parts.length > 0) return parts.join(' / ');
  }
  const gl = backend.gl;
  if (gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  }
  return 'unknown';
}

export async function createRenderer(cfg: Config, forceWebGL: boolean): Promise<{ renderer: THREE.WebGPURenderer; info: RendererInfo }> {
  let renderer = await tryCreate(cfg, forceWebGL, cfg.render.reversedDepth ? 'reversed-z' : 'logarithmic');
  let depth: DepthMode = renderer.reversedDepthBuffer ? 'reversed-z' : renderer.logarithmicDepthBuffer ? 'logarithmic' : 'standard';
  if (depth === 'standard') {
    renderer.dispose();
    renderer = await tryCreate(cfg, forceWebGL, 'logarithmic');
    depth = renderer.logarithmicDepthBuffer ? 'logarithmic' : 'standard';
  }
  const backend = renderer.backend as unknown as BackendInternals;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, cfg.render.maxPixelRatio));
  return {
    renderer,
    info: {
      backend: backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
      depth,
      gpuTiming: backend.trackTimestamp === true,
      adapter: adapterName(backend),
    },
  };
}
