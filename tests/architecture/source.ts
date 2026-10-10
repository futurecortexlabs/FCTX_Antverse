/** Helpers for static checks over the source tree. */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const SRC = join(ROOT, 'src');

export function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

export const isTest = (p: string): boolean => p.endsWith('.test.ts');

/** Path relative to src/ with forward slashes, e.g. "sim/world.ts". */
export const srcRel = (p: string): string => relative(SRC, p).split(sep).join('/');

export function read(p: string): string {
  return readFileSync(p, 'utf8');
}

/** Remove comments and string/template literal contents (keeps quotes). */
export function stripCommentsAndStrings(code: string): string {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i]!, n = code[i + 1];
    if (c === '/' && n === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      out += c; i++;
      while (i < code.length && code[i] !== c) { if (code[i] === '\\') i++; i++; }
      out += c; i++;
      continue;
    }
    out += c; i++;
  }
  return out;
}

export interface ImportRef {
  /** src-relative path for internal imports, package specifier otherwise. */
  target: string;
  internal: boolean;
}

/** Static `import … from` / `export … from` specifiers. */
export function imports(p: string): ImportRef[] {
  const code = read(p);
  const specs = [...code.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gms)].map((m) => m[1]!);
  return specs.map((s) => (s.startsWith('.')
    ? { target: srcRel(resolve(dirname(p), s)), internal: true }
    : { target: s, internal: false }));
}
