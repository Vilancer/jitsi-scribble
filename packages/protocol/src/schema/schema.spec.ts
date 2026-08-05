import * as Schema from 'effect/Schema';
import { describe, expect, it } from 'vitest';

import { WireFrameSchema } from './index.js';

describe('WireFrameSchema', () => {
  it('decodes a well-formed StartFrame structurally equal to the input', () => {
    const input = { v: 1, t: 's', from: 'p1', id: 'str1', p: [2048, 2048], frame: { w: 1920, h: 1080 } };
    const result = Schema.decodeUnknownSync(WireFrameSchema)(input);
    expect(result).toEqual(input);
  });

  it('round-trips a MoveFrame with pts:[[0,0],[4095,4095]] via encode then decode', () => {
    const input = { v: 1 as const, t: 'm' as const, from: 'p1', id: 'str1', pts: [[0, 0], [4095, 4095]] as Array<readonly [number, number]> };
    const encoded = Schema.encodeUnknownSync(WireFrameSchema)(input);
    const decoded = Schema.decodeUnknownSync(WireFrameSchema)(encoded);
    expect(decoded).toEqual(input);
  });

  it('rejects a frame missing v', () => {
    const input = { t: 's', from: 'p1', id: 'str1', p: [0, 0], frame: { w: 1, h: 1 } };
    expect(() => Schema.decodeUnknownSync(WireFrameSchema)(input)).toThrow();
  });

  it("rejects a frame with t:'s' but no id field", () => {
    const input = { v: 1, t: 's', from: 'p1', p: [0, 0], frame: { w: 1, h: 1 } };
    expect(() => Schema.decodeUnknownSync(WireFrameSchema)(input)).toThrow();
  });

  it('decodes a PresenceFrame with a typed vis:boolean field', () => {
    const input = { v: 1, t: 'p', from: 'p1', vis: false };
    const result = Schema.decodeUnknownSync(WireFrameSchema)(input);
    expect(result).toEqual(input);
  });

  it("decodes an EndFrame with kind:'tap' structurally equal to the input (D-01)", () => {
    const input = { v: 1, t: 'e', from: 'p1', id: 'str1', kind: 'tap' };
    const result = Schema.decodeUnknownSync(WireFrameSchema)(input);
    expect(result).toEqual(input);
  });

  it("rejects an EndFrame with kind:'bogus' — Left result (D-01, T-05-04)", () => {
    const input = { v: 1, t: 'e', from: 'p1', id: 'str1', kind: 'bogus' };
    const result = Schema.decodeUnknownEither(WireFrameSchema)(input);
    expect(result._tag).toBe('Left');
  });
});
