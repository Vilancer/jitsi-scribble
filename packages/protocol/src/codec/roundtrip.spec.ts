import * as Schema from 'effect/Schema';
import { describe, expect, it } from 'vitest';

import { decode, encode } from './index.js';
import { WireFrameSchema } from '../schema/index.js';
import type { WireFrame } from '../schema/index.js';

/**
 * The codec/schema divergence-risk mitigation (ARCHITECTURE.md section 2,
 * T-02-03-05): codec.decode(schema.encode(x)) roundtrips === x for valid
 * values, AND every hostile case is rejected by BOTH validators
 * (accept/reject parity — not identical error messages).
 */

const handPickedValidFrames: WireFrame[] = [
  { v: 1, t: 's', from: 'p1', id: 'i1', p: [0, 0], frame: { w: 1, h: 1 } },
  { v: 1, t: 's', from: 'p1', id: 'i1', p: [4095, 4095], frame: { w: 1920, h: 1080 } },
  { v: 1, t: 'm', from: 'p1', id: 'i1', pts: [[0, 0]] },
  { v: 1, t: 'm', from: 'p1', id: 'i1', pts: [[0, 0], [4095, 4095]] },
  { v: 1, t: 'e', from: 'p1', id: 'i1' },
  { v: 1, t: 'e', from: 'p1', id: 'i1', kind: 'tap' },
  { v: 1, t: 'e', from: 'p1', id: 'i1', kind: 'stroke' },
  { v: 1, t: 'c', from: 'p1' },
  { v: 1, t: 'p', from: 'p1', vis: true },
  { v: 1, t: 'p', from: 'p1', vis: false },
];

function randomValidPoint(): [number, number] {
  return [Math.floor(Math.random() * 4096), Math.floor(Math.random() * 4096)];
}

function randomValidFrame(): WireFrame {
  const kinds = ['s', 'm', 'e', 'c', 'p'] as const;
  const t = kinds[Math.floor(Math.random() * kinds.length)];
  switch (t) {
    case 's':
      return { v: 1, t, from: 'p1', id: 'i1', p: randomValidPoint(), frame: { w: 100, h: 100 } };
    case 'm':
      return { v: 1, t, from: 'p1', id: 'i1', pts: Array.from({ length: 1 + Math.floor(Math.random() * 64) }, randomValidPoint) };
    case 'e': {
      // D-01: randomly omit kind, or set it to 'tap'/'stroke' — same unseeded
      // Math.random() convention case 'p' already uses for its boolean vis
      // field, exercising all three End-frame shapes with no fixed seed.
      const r = Math.random();
      const kind: 'tap' | 'stroke' | undefined = r < 1 / 3 ? undefined : r < 2 / 3 ? 'tap' : 'stroke';
      return { v: 1, t, from: 'p1', id: 'i1', ...(kind !== undefined ? { kind } : {}) };
    }
    case 'c':
      return { v: 1, t, from: 'p1' };
    case 'p':
      return { v: 1, t, from: 'p1', vis: Math.random() < 0.5 };
  }
}

const randomValidFrames: WireFrame[] = Array.from({ length: 25 }, randomValidFrame);

describe('roundtrip: codec.decode(codec.encode(x)) === {ok:true, frame:x}', () => {
  for (const frame of [...handPickedValidFrames, ...randomValidFrames]) {
    it(`round-trips ${JSON.stringify(frame)}`, () => {
      expect(decode(encode(frame))).toEqual({ ok: true, frame });
    });
  }
});

describe('accept/reject parity: schema and codec agree on every hostile case', () => {
  const hostileCases: unknown[] = [
    { v: 1, t: 's', from: 'p1', id: 'i1', p: [4096, 0], frame: { w: 10, h: 10 } },
    { v: 1, t: 's', from: 'p1', id: 'i1', p: [-1, 0], frame: { w: 10, h: 10 } },
    { v: 1, t: 'm', from: 'p1', id: 'i1', pts: Array.from({ length: 65 }, () => [0, 0]) },
    { v: 1, t: 'm', from: 'p1', id: 'i1', pts: [] },
    { v: 1, t: 's', from: 'a'.repeat(129), id: 'i1', p: [0, 0], frame: { w: 1, h: 1 } },
    { v: 1, t: 's', from: '', id: 'i1', p: [0, 0], frame: { w: 1, h: 1 } },
    { v: 1, t: 's', from: 'p1', id: 'i1', p: 'not-an-array', frame: { w: 1, h: 1 } },
    { t: 's', from: 'p1', id: 'i1', p: [0, 0], frame: { w: 1, h: 1 } },
    { v: 2, t: 's', from: 'p1', id: 'i1', p: [0, 0], frame: { w: 1, h: 1 } },
    { v: 1, t: 's', from: 'p1', p: [0, 0], frame: { w: 1, h: 1 } }, // missing id
    { v: 1, t: 'e', from: 'p1', id: 'i1', kind: 'bogus' }, // D-01, T-05-04: forged kind value
  ];

  for (const hostile of hostileCases) {
    it(`both reject ${JSON.stringify(hostile)}`, () => {
      const schemaResult = Schema.decodeUnknownEither(WireFrameSchema)(hostile);
      const codecResult = decode(JSON.stringify(hostile));
      expect(schemaResult._tag).toBe('Left');
      expect(codecResult.ok).toBe(false);
    });
  }

  it("both reject non-JSON input ('not json at all')", () => {
    const schemaResult = Schema.decodeUnknownEither(WireFrameSchema)('not json at all');
    const codecResult = decode('not json at all');
    expect(schemaResult._tag).toBe('Left');
    expect(codecResult.ok).toBe(false);
  });
});
