/**
 * Architecture rules (docs/ARCHITECTURE.md §1, §3):
 *  - dependency direction between layers;
 *  - three.js only in render/app;
 *  - no non-deterministic APIs in code that affects simulation state;
 *  - no magic numbers in behaviour rules.
 */

import { describe, expect, it } from 'vitest';
import { imports, isTest, listTs, read, SRC, srcRel, stripCommentsAndStrings } from './source.ts';

const files = listTs(SRC).filter((p) => !isTest(p));
const layerOf = (rel: string): string => rel.split('/')[0]!;

/** Allowed internal targets per layer. Entries are layer names or exact files. */
const ALLOWED: Record<string, string[]> = {
  core: ['core'],
  config: ['core', 'config'],
  terrain: ['core', 'config', 'terrain'],
  env: ['core', 'config', 'env'],
  locomotion: ['core', 'config', 'terrain', 'locomotion'],
  soil: ['core', 'config', 'terrain', 'soil'],
  sim: ['core', 'config', 'terrain', 'locomotion', 'soil', 'env', 'sim'],
  worker: ['core', 'config', 'sim', 'worker'],
  render: ['core', 'config', 'terrain', 'locomotion', 'soil', 'env', 'render', 'worker/protocol.ts'],
  bench: ['core', 'config', 'bench'],
  app: ['core', 'config', 'terrain', 'soil', 'env', 'render', 'bench', 'app', 'worker/protocol.ts'],
};

describe('layer dependencies', () => {
  it('every source file belongs to a known layer', () => {
    for (const f of files) expect(Object.keys(ALLOWED), srcRel(f)).toContain(layerOf(srcRel(f)));
  });

  it.each(files.map((f) => [srcRel(f), f]))('%s imports only allowed layers', (rel, f) => {
    const allowed = ALLOWED[layerOf(rel)]!;
    for (const { target, internal } of imports(f)) {
      if (!internal) {
        if (target.startsWith('three')) expect(['render', 'app'], `${rel} imports three`).toContain(layerOf(rel));
        continue;
      }
      const ok = allowed.some((a) => (a.endsWith('.ts') ? target === a : layerOf(target) === a));
      expect(ok, `${rel} -> ${target}`).toBe(true);
    }
  });
});

const DETERMINISTIC_LAYERS = ['core', 'config', 'terrain', 'locomotion', 'soil', 'env', 'sim'];
const BANNED = [
  /\bMath\.(?:random|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot)\b/,
  /\bDate\.now\b/,
  /\bperformance\.now\b/,
  /\*\*/,
];

describe('determinism hygiene', () => {
  const det = files.filter((f) => DETERMINISTIC_LAYERS.includes(layerOf(srcRel(f))) && !srcRel(f).endsWith('rolling-stats.ts'));
  it.each(det.map((f) => [srcRel(f), f]))('%s uses no engine-dependent math, clocks or Math.random', (rel, f) => {
    const code = stripCommentsAndStrings(read(f));
    for (const re of BANNED) expect(re.test(code), `${rel} matches ${re}`).toBe(false);
  });
});

/**
 * Literals allowed in behaviour rules: structural constants only
 * (sub-key / component indices, halves, doubling). Quantities with units
 * must come from config.
 */
const ALLOWED_LITERALS = new Set(['0', '1', '2', '0.5', '3', '4']);

describe('no magic numbers in behaviour rules', () => {
  const rules = files.filter((f) => srcRel(f).startsWith('sim/rules/'));
  it.each(rules.map((f) => [srcRel(f), f]))('%s takes every quantity from config', (rel, f) => {
    const code = stripCommentsAndStrings(read(f));
    const literals = [...code.matchAll(/(?<![\w.])(\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?![\w.])/gi)].map((m) => m[1]!);
    const bad = literals.filter((l) => !ALLOWED_LITERALS.has(l));
    expect(bad, rel).toEqual([]);
  });
});
