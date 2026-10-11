/**
 * Parameter schema: every tunable value carries its unit and an evidence id.
 *
 * Evidence id prefixes (registry: docs/BIOLOGY.md, docs/ENGINEERING.md):
 *   BIO-*  biological finding with a citation
 *   PHY-*  physical constant / law
 *   ASM-*  assumption (仮定): no direct evidence; rationale + how to verify
 *   ENG-*  engineering choice unrelated to biology (resolution, budgets, UI)
 */

export type Unit =
  | 's' | 'ms' | 'mm' | 'mm/s' | 'mg' | 'degC'
  | 'rad' | 'rad/sqrt(s)' | 'rad/s' | 'deg'
  | 'count' | 'tick' | 'frames' | 'x' | 'bool' | 'px' | 'rgb' | '1/mm2' | '1/s'
  | 'u' | 'u/mm' | 'mm2/s' | 'mm3';

export type RefId = `${'BIO' | 'PHY' | 'ASM' | 'ENG'}-${string}-${number}`;
export const REF_PATTERN = /\b(?:BIO|PHY|ASM|ENG)-[A-Z]+-\d{3}\b/g;

export type ParamValue = number | boolean | readonly number[];

export interface Param<T extends ParamValue = ParamValue> {
  readonly value: T;
  readonly unit: Unit;
  readonly ref: RefId;
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
}

export interface ParamOpts {
  min?: number;
  max?: number;
  integer?: boolean;
}

export function p<T extends ParamValue>(value: T, unit: Unit, ref: RefId, opts: ParamOpts = {}): Param<T> {
  return { value, unit, ref, ...opts };
}

export function isParam(x: unknown): x is Param {
  return typeof x === 'object' && x !== null && 'value' in x && 'unit' in x && 'ref' in x;
}

/** Widen literal types so overlays can change values (e.g. 5 -> number). */
type Widen<T> = T extends number ? number : T extends boolean ? boolean : T extends readonly number[] ? readonly number[] : T;

/** Plain-value view of a param tree: `{ sim: { dt: Param<number> } }` -> `{ sim: { dt: number } }`. */
export type Values<T> = {
  readonly [K in keyof T]: T[K] extends Param<infer V> ? Widen<V> : Values<T[K]>;
};

export interface ParamTree {
  readonly [key: string]: Param | ParamTree;
}

/** Visit every Param with its dotted path. */
export function walkParams(tree: ParamTree, visit: (path: string, param: Param) => void, prefix = ''): void {
  for (const [key, node] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isParam(node)) visit(path, node);
    else walkParams(node, visit, path);
  }
}
