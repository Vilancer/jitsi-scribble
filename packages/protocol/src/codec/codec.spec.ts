import { describe, expect, it } from 'vitest';

import { decode, encode } from './index.js';
import type { StartFrame } from '../schema/index.js';

const startFrame: StartFrame = {
  v: 1,
  t: 's',
  from: 'p1',
  id: 'i1',
  p: [10, 20],
  frame: { w: 1920, h: 1080 },
};

describe('codec', () => {
  it('decode(encode(startFrame)) returns {ok:true, frame} structurally equal to startFrame', () => {
    const result = decode(encode(startFrame));
    expect(result).toEqual({ ok: true, frame: startFrame });
  });

  it("rejects a coordinate one past the max valid quantized int (4096) with 'coordinate-out-of-range'", () => {
    const result = decode('{"v":1,"t":"s","from":"p1","id":"i1","p":[4096,0],"frame":{"w":10,"h":10}}');
    expect(result).toEqual({ ok: false, error: 'coordinate-out-of-range' });
  });

  it('accepts the exact max valid quantized int (4095)', () => {
    const result = decode('{"v":1,"t":"s","from":"p1","id":"i1","p":[4095,0],"frame":{"w":10,"h":10}}');
    expect(result.ok).toBe(true);
  });

  it("rejects a negative coordinate (-1) with 'coordinate-out-of-range'", () => {
    const result = decode('{"v":1,"t":"s","from":"p1","id":"i1","p":[-1,0],"frame":{"w":10,"h":10}}');
    expect(result).toEqual({ ok: false, error: 'coordinate-out-of-range' });
  });

  it("rejects a MoveFrame with 65 points with 'too-many-points'", () => {
    const pts = Array.from({ length: 65 }, (_, i) => [i % 4096, 0]);
    const result = decode(JSON.stringify({ v: 1, t: 'm', from: 'p1', id: 'i1', pts }));
    expect(result).toEqual({ ok: false, error: 'too-many-points' });
  });

  it('accepts a MoveFrame with exactly 64 points', () => {
    const pts = Array.from({ length: 64 }, (_, i) => [i % 4096, 0]);
    const result = decode(JSON.stringify({ v: 1, t: 'm', from: 'p1', id: 'i1', pts }));
    expect(result.ok).toBe(true);
  });

  it("rejects a MoveFrame with pts:[] with 'empty-points'", () => {
    const result = decode(JSON.stringify({ v: 1, t: 'm', from: 'p1', id: 'i1', pts: [] }));
    expect(result).toEqual({ ok: false, error: 'empty-points' });
  });

  it("rejects a 129-character from string with 'identifier-too-long'", () => {
    const from = 'a'.repeat(129);
    const result = decode(JSON.stringify({ v: 1, t: 's', from, id: 'i1', p: [0, 0], frame: { w: 1, h: 1 } }));
    expect(result).toEqual({ ok: false, error: 'identifier-too-long' });
  });

  it('accepts an exactly 128-character from string', () => {
    const from = 'a'.repeat(128);
    const result = decode(JSON.stringify({ v: 1, t: 's', from, id: 'i1', p: [0, 0], frame: { w: 1, h: 1 } }));
    expect(result.ok).toBe(true);
  });

  it("rejects from:'' with 'identifier-empty'", () => {
    const result = decode(JSON.stringify({ v: 1, t: 's', from: '', id: 'i1', p: [0, 0], frame: { w: 1, h: 1 } }));
    expect(result).toEqual({ ok: false, error: 'identifier-empty' });
  });

  it("rejects p as a string instead of a two-element array with 'invalid-type', never throwing", () => {
    const result = decode(JSON.stringify({ v: 1, t: 's', from: 'p1', id: 'i1', p: 'not-an-array', frame: { w: 1, h: 1 } }));
    expect(result).toEqual({ ok: false, error: 'invalid-type' });
  });

  it("rejects a frame missing v with 'missing-field'", () => {
    const result = decode(JSON.stringify({ t: 's', from: 'p1', id: 'i1', p: [0, 0], frame: { w: 1, h: 1 } }));
    expect(result).toEqual({ ok: false, error: 'missing-field' });
  });

  it("rejects a well-formed frame with v:2 with 'version-mismatch'", () => {
    const result = decode(JSON.stringify({ v: 2, t: 's', from: 'p1', id: 'i1', p: [0, 0], frame: { w: 1, h: 1 } }));
    expect(result).toEqual({ ok: false, error: 'version-mismatch' });
  });

  it("decode('not json at all') returns {ok:false, error:'invalid-json'}, never throws", () => {
    expect(() => decode('not json at all')).not.toThrow();
    const result = decode('not json at all');
    expect(result).toEqual({ ok: false, error: 'invalid-json' });
  });
});
