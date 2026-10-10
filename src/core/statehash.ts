/**
 * Fast 32-bit hash over typed-array contents, used to prove that two runs
 * reached bit-identical state (seed reproducibility tests and the in-app
 * determinism check). Not cryptographic.
 */

import { mix32 } from './rng.ts';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export class StateHasher {
  private h = FNV_OFFSET;

  word(w: number): this {
    this.h = Math.imul(this.h ^ (w >>> 0), FNV_PRIME) >>> 0;
    return this;
  }

  /** Hash a number by its float64 bit pattern. */
  f64(x: number): this {
    scratch64[0] = x;
    return this.word(scratch32[0]!).word(scratch32[1]!);
  }

  view(v: ArrayBufferView): this {
    const { buffer, byteOffset, byteLength } = v;
    const words = byteLength >>> 2;
    if (byteOffset % 4 === 0) {
      const u32 = new Uint32Array(buffer, byteOffset, words);
      for (let i = 0; i < words; i++) this.h = Math.imul(this.h ^ u32[i]!, FNV_PRIME) >>> 0;
    } else {
      const dv = new DataView(buffer, byteOffset, byteLength);
      for (let i = 0; i < words; i++) this.h = Math.imul(this.h ^ dv.getUint32(i * 4, true), FNV_PRIME) >>> 0;
    }
    const tail = new Uint8Array(buffer, byteOffset + words * 4, byteLength - words * 4);
    for (let i = 0; i < tail.length; i++) this.h = Math.imul(this.h ^ tail[i]!, FNV_PRIME) >>> 0;
    return this.word(byteLength);
  }

  digest(): number {
    return mix32(this.h);
  }
}

const scratch64 = new Float64Array(1);
const scratch32 = new Uint32Array(scratch64.buffer);

export function formatHash(h: number): string {
  return (h >>> 0).toString(16).padStart(8, '0');
}
