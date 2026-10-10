/**
 * Structure-of-Arrays allocation from a declarative schema.
 *
 * Each field becomes one TypedArray of length capacity * components.
 * Field order (object key order) is part of the state-hash definition, so
 * append new fields instead of reordering.
 */

export type FieldKind = 'f32' | 'f64' | 'u8' | 'u16' | 'u32' | 'i32';

export interface FieldSpec<K extends FieldKind = FieldKind> {
  readonly kind: K;
  readonly components: number;
}

export type Schema = Readonly<Record<string, FieldSpec>>;

type ArrayFor<K extends FieldKind> =
  K extends 'f32' ? Float32Array :
  K extends 'f64' ? Float64Array :
  K extends 'u8' ? Uint8Array :
  K extends 'u16' ? Uint16Array :
  K extends 'u32' ? Uint32Array :
  Int32Array;

export type SoA<S extends Schema> = { readonly [F in keyof S]: ArrayFor<S[F]['kind']> };

export const field = <K extends FieldKind>(kind: K, components = 1): FieldSpec<K> => ({ kind, components });

const CTOR: Record<FieldKind, new (n: number) => ArrayBufferView & { length: number }> = {
  f32: Float32Array,
  f64: Float64Array,
  u8: Uint8Array,
  u16: Uint16Array,
  u32: Uint32Array,
  i32: Int32Array,
};

export function allocSoA<S extends Schema>(schema: S, capacity: number): SoA<S> {
  const out: Record<string, ArrayBufferView> = {};
  for (const [name, spec] of Object.entries(schema)) {
    out[name] = new CTOR[spec.kind](capacity * spec.components);
  }
  return out as SoA<S>;
}

/** Fields in schema order, each sliced to the first `count` records. */
export function soaViews<S extends Schema>(schema: S, soa: SoA<S>, count: number): ArrayBufferView[] {
  const views: ArrayBufferView[] = [];
  for (const [name, spec] of Object.entries(schema)) {
    const arr = (soa as Record<string, Float32Array>)[name]!;
    views.push(arr.subarray(0, count * spec.components));
  }
  return views;
}

export function soaBytesPerRecord(schema: Schema): number {
  const BYTES: Record<FieldKind, number> = { f32: 4, f64: 8, u8: 1, u16: 2, u32: 4, i32: 4 };
  let n = 0;
  for (const spec of Object.values(schema)) n += BYTES[spec.kind] * spec.components;
  return n;
}
