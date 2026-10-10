/**
 * Principle 3 & 4: every parameter is external, has a unit, and points to an
 * evidence entry in docs/BIOLOGY.md or docs/ENGINEERING.md.
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { DEFAULT_PARAMS } from '../../src/config/params.ts';
import { REF_PATTERN, walkParams, type Param } from '../../src/config/schema.ts';
import { listTs, read, ROOT, SRC, srcRel } from './source.ts';

const REGISTRIES = ['docs/BIOLOGY.md', 'docs/ENGINEERING.md'];

interface Entry { id: string; file: string; body: string }

function parseRegistry(): Entry[] {
  const entries: Entry[] = [];
  for (const file of REGISTRIES) {
    const text = read(join(ROOT, file));
    const parts = text.split(/^### /m).slice(1);
    for (const part of parts) {
      const id = part.split(/\s/, 1)[0]!;
      const body = part.split(/^#{1,3} /m)[0]!;
      entries.push({ id, file, body });
    }
  }
  return entries;
}

const entries = parseRegistry();
const ids = new Set(entries.map((e) => e.id));
const params: [string, Param][] = [];
walkParams(DEFAULT_PARAMS, (path, param) => params.push([path, param]));

describe('evidence registry', () => {
  it('entry ids are well-formed and unique', () => {
    for (const e of entries) expect(e.id, `${e.file}: ${e.id}`).toMatch(new RegExp(`^${REF_PATTERN.source.replace(/\\b/g, '')}$`));
    expect(ids.size).toBe(entries.length);
  });

  it('ENG ids live in ENGINEERING.md, others in BIOLOGY.md', () => {
    for (const e of entries) expect(e.file, e.id).toBe(e.id.startsWith('ENG-') ? 'docs/ENGINEERING.md' : 'docs/BIOLOGY.md');
  });

  it('BIO/PHY entries cite a source and state confidence; ASM entries say how to verify', () => {
    for (const e of entries) {
      if (e.id.startsWith('BIO-') || e.id.startsWith('PHY-')) {
        expect(e.body, e.id).toMatch(/\*\*出典\*\*/);
        expect(e.body, e.id).toMatch(/\*\*確度\*\*/);
      }
      if (e.id.startsWith('ASM-')) expect(e.body, e.id).toMatch(/\*\*検証\*\*/);
    }
  });
});

describe('parameters', () => {
  it('there are parameters to check', () => {
    expect(params.length).toBeGreaterThan(10);
  });

  it.each(params)('%s has a unit and a registered evidence id', (path, param) => {
    expect(param.unit, path).toBeTruthy();
    expect(ids.has(param.ref), `${path} -> ${param.ref} not in ${REGISTRIES.join(' / ')}`).toBe(true);
  });

  it('every evidence id mentioned in source code is registered', () => {
    for (const f of listTs(SRC)) {
      for (const m of read(f).matchAll(REF_PATTERN)) {
        expect(ids.has(m[0]), `${srcRel(f)} mentions unknown ${m[0]}`).toBe(true);
      }
    }
  });
});
