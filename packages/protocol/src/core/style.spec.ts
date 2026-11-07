import { describe, expect, it } from 'vitest';

import { decode } from '../codec/index.js';
import type { WireFrame } from '../schema/index.js';
import { MAX_POINTS_PER_MESSAGE, MSG_MOVE, MSG_START } from '../wire-constants.js';
import { MAX_POINTS_PER_OUTBOUND_MOVE, StrokeStore } from './index.js';

const style = { color: '#FF453A', width: 6, tool: 'marker' };

function pair(): { a: StrokeStore; b: StrokeStore; sent: WireFrame[] } {
  const a = new StrokeStore({ localId: 'alice' });
  const b = new StrokeStore();
  const sent: WireFrame[] = [];
  a.onOutbound((frame) => {
    sent.push(frame);
    b.apply(JSON.stringify(frame), 'alice');
  });
  a.tick(1000);
  b.tick(1000);
  return { a, b, sent };
}

describe('stroke style', () => {
  it('travels on the Start frame and lands on the remote stroke', () => {
    const { a, b, sent } = pair();
    a.beginLocal('s1', { w: 1080, h: 2400 }, style);
    a.appendLocal('s1', 0.2, 0.3);
    a.endLocal('s1', 'stroke');

    const start = sent.find((f) => f.t === MSG_START);
    expect(start).toMatchObject({ st: { c: '#FF453A', w: 6, k: 'marker' } });
    expect(a.snapshot()[0].style).toEqual(style);
    expect(b.snapshot()[0].style).toEqual(style);
  });

  it('a stroke without a style has style undefined on both sides and no st on the wire', () => {
    const { a, b, sent } = pair();
    a.beginLocal('s1', { w: 10, h: 10 });
    a.appendLocal('s1', 0.5, 0.5);
    expect(sent[0]).not.toHaveProperty('st');
    expect(a.snapshot()[0].style).toBeUndefined();
    expect(b.snapshot()[0].style).toBeUndefined();
  });

  it('style is copied, so mutating the caller object later changes nothing', () => {
    const { a } = pair();
    const mutable = { ...style };
    a.beginLocal('s1', { w: 10, h: 10 }, mutable);
    mutable.color = '#000000';
    expect(a.snapshot()[0].style?.color).toBe('#FF453A');
  });
});

describe('outbound Move chunking', () => {
  it('a burst of points with no tick in between (a shape) is split into decodable frames', () => {
    const { a, b, sent } = pair();
    a.beginLocal('shape', { w: 1000, h: 1000 }, style);
    const n = 100;
    for (let i = 0; i < n; i++) a.appendLocal('shape', i / n, 0.5);
    a.endLocal('shape', 'stroke');

    const moves = sent.filter((f) => f.t === MSG_MOVE);
    expect(moves.length).toBe(Math.ceil((n - 1) / MAX_POINTS_PER_OUTBOUND_MOVE));
    for (const m of moves) {
      expect(m.t === MSG_MOVE && m.pts.length).toBeLessThanOrEqual(MAX_POINTS_PER_OUTBOUND_MOVE);
      expect(decode(JSON.stringify(m)).ok).toBe(true);
    }
    expect(MAX_POINTS_PER_OUTBOUND_MOVE).toBeLessThan(MAX_POINTS_PER_MESSAGE);
    expect(b.snapshot()[0].points).toHaveLength(n);
  });
});

describe('apply() reports what it accepted', () => {
  it('returns the frame when accepted and null when rate-limited or undecodable', async () => {
    const { RATE_CAPACITY } = await import('./index.js');
    const store = new StrokeStore();
    store.tick(1000);
    const frame = { v: 1, t: 's', from: 'x', id: 'a', p: [0, 0], frame: { w: 1, h: 1 } };
    expect(store.apply(JSON.stringify(frame), 'x')).toMatchObject({ t: 's', id: 'a' });
    expect(store.apply('not json', 'x')).toBeNull();
    let accepted = 0;
    for (let i = 0; i < RATE_CAPACITY + 20; i++) {
      if (store.apply(JSON.stringify({ ...frame, id: `f${i}` }), 'x')) accepted++;
    }
    expect(accepted).toBeLessThan(RATE_CAPACITY);
  });
});
