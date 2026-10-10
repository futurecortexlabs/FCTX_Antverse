/**
 * Building a Config: defaults + preset overlays + individual overrides,
 * validated against each Param's type and bounds. Pure functions — usable
 * from the main thread, the worker, Node tests and scripts alike.
 */

import { DEFAULT_PARAMS, type Config, type Params } from './params.ts';
import { isParam, walkParams, type Param, type ParamTree, type ParamValue } from './schema.ts';

/** A partial tree of plain values, e.g. `{ debugWalk: { count: 10000 } }`. */
export interface Overlay {
  readonly [key: string]: ParamValue | Overlay;
}

export class ConfigError extends Error {}

function checkValue(path: string, param: Param, value: unknown): ParamValue {
  const base = param.value;
  if (typeof base === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new ConfigError(`${path}: expected finite number, got ${JSON.stringify(value)}`);
  } else if (typeof base === 'boolean') {
    if (typeof value !== 'boolean') throw new ConfigError(`${path}: expected boolean, got ${JSON.stringify(value)}`);
    return value;
  } else {
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      throw new ConfigError(`${path}: expected number[], got ${JSON.stringify(value)}`);
    }
  }
  const nums = typeof value === 'number' ? [value] : (value as number[]);
  for (const v of nums) {
    if (param.min !== undefined && v < param.min) throw new ConfigError(`${path}: ${v} < min ${param.min} ${param.unit}`);
    if (param.max !== undefined && v > param.max) throw new ConfigError(`${path}: ${v} > max ${param.max} ${param.unit}`);
    if (param.integer && !Number.isInteger(v)) throw new ConfigError(`${path}: ${v} must be an integer`);
  }
  return value as ParamValue;
}

/** Return a new param tree with overlay values applied. Unknown keys are errors. */
export function applyOverlay<T extends ParamTree>(tree: T, overlay: Overlay, prefix = ''): T {
  const out: Record<string, Param | ParamTree> = { ...tree };
  for (const [key, value] of Object.entries(overlay)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const node = tree[key];
    if (node === undefined) throw new ConfigError(`${path}: unknown parameter`);
    if (isParam(node)) {
      out[key] = { ...node, value: checkValue(path, node, value) };
    } else {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ConfigError(`${path}: is a group, expected an object`);
      }
      out[key] = applyOverlay(node, value as Overlay, path);
    }
  }
  return out as T;
}

/** Turn `a.b.c` + raw string into an overlay, parsing by the target Param's type. */
export function overlayFromAssignment(tree: ParamTree, path: string, raw: string): Overlay {
  const keys = path.split('.');
  let node: Param | ParamTree | undefined = tree;
  for (const k of keys) {
    if (node === undefined || isParam(node)) throw new ConfigError(`${path}: unknown parameter`);
    node = (node as ParamTree)[k];
  }
  if (node === undefined || !isParam(node)) throw new ConfigError(`${path}: not a parameter`);
  let value: ParamValue;
  if (typeof node.value === 'boolean') value = raw === 'true' || raw === '1';
  else if (Array.isArray(node.value)) value = raw.split(',').map(Number);
  else value = Number(raw);
  let overlay: Overlay = { [keys[keys.length - 1]!]: value };
  for (let i = keys.length - 2; i >= 0; i--) overlay = { [keys[i]!]: overlay };
  return overlay;
}

/** Strip Param wrappers -> plain values, deep-frozen. */
export function toValues<T extends ParamTree>(tree: T): import('./schema.ts').Values<T> {
  const out: Record<string, unknown> = {};
  for (const [key, node] of Object.entries(tree)) {
    out[key] = isParam(node) ? (Array.isArray(node.value) ? Object.freeze([...node.value]) : node.value) : toValues(node);
  }
  return Object.freeze(out) as import('./schema.ts').Values<T>;
}

export interface BuildResult {
  readonly params: Params;
  readonly config: Config;
}

/** Defaults <- overlays (in order). */
export function buildConfig(overlays: readonly Overlay[] = []): BuildResult {
  let params: Params = DEFAULT_PARAMS;
  for (const o of overlays) params = applyOverlay(params, o);
  walkParams(params, (path, param) => checkValue(path, param, param.value));
  return { params, config: toValues(params) as Config };
}

/**
 * URL parameters understood by the app:
 *   ?seed=123                 shorthand for sim.seed
 *   ?preset=name              config/presets/name.json
 *   ?set=debugWalk.count=5000 (repeatable)
 */
export interface UrlOptions {
  readonly preset: string | null;
  readonly overlays: Overlay[];
}

export function parseUrlOptions(search: string): UrlOptions {
  const q = new URLSearchParams(search);
  const overlays: Overlay[] = [];
  const seed = q.get('seed');
  if (seed !== null) overlays.push(overlayFromAssignment(DEFAULT_PARAMS, 'sim.seed', seed));
  for (const s of q.getAll('set')) {
    const eq = s.indexOf('=');
    if (eq < 0) throw new ConfigError(`set=${s}: expected path=value`);
    overlays.push(overlayFromAssignment(DEFAULT_PARAMS, s.slice(0, eq), s.slice(eq + 1)));
  }
  return { preset: q.get('preset'), overlays };
}
