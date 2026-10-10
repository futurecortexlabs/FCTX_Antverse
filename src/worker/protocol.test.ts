import { describe, expect, it } from 'vitest';
import {
  SnapshotView, TripleBufferReader, TripleBufferWriter, initTripleBufferControl, snapshotByteLength, SNAP_FLOATS,
} from './protocol.ts';

describe('triple buffer', () => {
  function setup() {
    const ctrl = new Int32Array(new SharedArrayBuffer(4));
    initTripleBufferControl(ctrl);
    return { w: new TripleBufferWriter(ctrl), r: new TripleBufferReader(ctrl) };
  }

  it('reader sees nothing before the first publish', () => {
    const { r } = setup();
    expect(r.acquire()).toBe(false);
  });

  it('writer and reader never hold the same slot', () => {
    const { w, r } = setup();
    // Exhaustive-ish interleavings of publish/acquire.
    let x = 7;
    for (let i = 0; i < 10000; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      if (x & 1) w.publish(); else r.acquire();
      expect(w.back).not.toBe(r.front);
    }
  });

  it('reader always receives the newest published slot', () => {
    const { w, r } = setup();
    const content = [0, 0, 0];
    let version = 0;
    for (let i = 0; i < 5; i++) { content[w.back] = ++version; w.publish(); }
    expect(r.acquire()).toBe(true);
    expect(content[r.front]).toBe(version);
    expect(r.acquire()).toBe(false);
  });
});

describe('snapshot layout', () => {
  it('views do not overlap and fit the buffer', () => {
    const cap = 1000;
    const buf = new ArrayBuffer(snapshotByteLength(cap));
    const v = new SnapshotView(buf, cap);
    expect(v.floats.length).toBe(cap * SNAP_FLOATS);
    expect(v.meta.length).toBe(cap);
    expect(v.header.byteOffset + v.header.byteLength).toBeLessThanOrEqual(v.floats.byteOffset);
    expect(v.floats.byteOffset + v.floats.byteLength).toBeLessThanOrEqual(v.meta.byteOffset);
    expect(v.meta.byteOffset + v.meta.byteLength).toBe(buf.byteLength);
  });
});
