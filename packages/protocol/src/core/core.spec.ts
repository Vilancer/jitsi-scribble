import { describe, expect, it, vi } from 'vitest';

import * as codec from '../codec/index.js';
import { MSG_CLEAR, MSG_END, MSG_MOVE, MSG_PRESENCE, MSG_START, PROTOCOL_VERSION, QUANT_STEPS } from '../wire-constants.js';
import {
  computePhaseAndAlpha,
  dequantize,
  FADE_MS,
  HOLD_MS,
  LOCAL_SENDER,
  MAX_POINTS_PER_STROKE,
  MAX_STROKES_PER_SENDER,
  MAX_TOTAL_STROKES,
  MOVE_COALESCE_DISTANCE_EPSILON,
  MOVE_COALESCE_TIME_MS,
  quantize,
  RATE_CAPACITY,
  STALE_MS,
  StrokeStore,
} from './index.js';

describe('StrokeStore state machine (CORE-01, CORE-02)', () => {
  it('beginLocal then appendLocal with no prior tick() creates a live, alpha:1 stroke', () => {
    const store = new StrokeStore();
    store.beginLocal('s1', { w: 1920, h: 1080 });
    store.appendLocal('s1', 0.5, 0.5);

    expect(store.snapshot()).toEqual([
      expect.objectContaining({
        id: 's1',
        from: LOCAL_SENDER,
        phase: 'live',
        alpha: 1,
        points: [[0.5, 0.5]],
      }),
    ]);
  });

  it('tick(now) with no endLocal call yet keeps phase live alpha 1', () => {
    const store = new StrokeStore();
    store.beginLocal('s1', { w: 1920, h: 1080 });
    store.tick(1000);

    expect(store.snapshot()[0]).toEqual(expect.objectContaining({ phase: 'live', alpha: 1 }));
  });

  it('at elapsed exactly HOLD_MS after effective end, reads phase fading alpha 1 (half-open boundary)', () => {
    const store = new StrokeStore();
    store.beginLocal('s1', { w: 1920, h: 1080 });
    store.tick(1000);
    store.endLocal('s1'); // timestamped at lastTickNow = 1000

    store.tick(1000 + HOLD_MS); // elapsed = HOLD_MS exactly
    expect(store.snapshot()[0]).toEqual(expect.objectContaining({ phase: 'fading', alpha: 1 }));
  });

  it('mid-fade tick reads phase fading with alpha strictly between 0 and 1', () => {
    const store = new StrokeStore();
    store.beginLocal('s1', { w: 1920, h: 1080 });
    store.tick(1000);
    store.endLocal('s1');

    store.tick(3499); // elapsed = 2499
    const stroke = store.snapshot()[0];
    expect(stroke.phase).toBe('fading');
    expect(stroke.alpha).toBeGreaterThan(0);
    expect(stroke.alpha).toBeLessThan(1);
    expect(stroke.alpha).toBeCloseTo(0.002, 3);
  });

  it('at elapsed exactly HOLD_MS+FADE_MS reads dead alpha 0, still present this tick, evicted the next', () => {
    const store = new StrokeStore();
    store.beginLocal('s1', { w: 1920, h: 1080 });
    store.tick(1000);
    store.endLocal('s1');

    store.tick(1000 + HOLD_MS + FADE_MS); // elapsed = 2500 exactly
    expect(store.snapshot()).toEqual([expect.objectContaining({ phase: 'dead', alpha: 0 })]);

    store.tick(1000 + HOLD_MS + FADE_MS + 100); // one further tick past the dead tick
    expect(store.snapshot()).toEqual([]);
  });

  it('snapshot() on a fresh store returns []; tick(0) on that store does not throw', () => {
    const store = new StrokeStore();
    expect(store.snapshot()).toEqual([]);
    expect(() => store.tick(0)).not.toThrow();
    expect(store.snapshot()).toEqual([]);
  });

  it('two strokes begun between the same pair of tick() calls retain beginLocal-call order', () => {
    const store = new StrokeStore();
    store.beginLocal('s1', { w: 1, h: 1 });
    store.beginLocal('s2', { w: 1, h: 1 });

    expect(store.snapshot().map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('two independent subscribers both fire in registration order; unsubscribing one stops only it', () => {
    const store = new StrokeStore();
    const calls: string[] = [];
    const unsub1 = store.subscribe(() => calls.push('fn1'));
    store.subscribe(() => calls.push('fn2'));

    store.tick(0);
    expect(calls).toEqual(['fn1', 'fn2']);

    calls.length = 0;
    unsub1();
    store.tick(1);
    expect(calls).toEqual(['fn2']);
  });

  it('a store with zero subscribe() calls still runs the full lifecycle without throwing', () => {
    const store = new StrokeStore();
    expect(() => {
      store.beginLocal('s1', { w: 1, h: 1 });
      store.appendLocal('s1', 0.1, 0.1);
      store.endLocal('s1');
      store.tick(1000);
      store.clear();
      store.snapshot();
    }).not.toThrow();
  });
});

describe('StrokeStore.clear(scope) — D-05 instant-vanish (CORE-03, GEO-05)', () => {
  it("clear('all') removes a live, a mid-hold, and a mid-fade stroke in one call; snapshot() is [] with no further tick()", () => {
    const store = new StrokeStore();
    store.beginLocal('live', { w: 1, h: 1 }); // never ended -> stays live
    store.beginLocal('holding', { w: 1, h: 1 });
    store.beginLocal('fading', { w: 1, h: 1 });
    store.tick(1000);
    store.endLocal('holding'); // effective end at 1000
    store.endLocal('fading'); // effective end at 1000
    store.tick(1000 + HOLD_MS + 100); // holding: elapsed=100 -> live/held; fading needs a later end

    // Re-derive 'fading' precisely: end it later than 'holding' so, at one
    // shared tick, 'holding' is mid-hold and 'fading' is mid-fade.
    const store2 = new StrokeStore();
    store2.beginLocal('live', { w: 1, h: 1 });
    store2.beginLocal('holding', { w: 1, h: 1 });
    store2.beginLocal('fading', { w: 1, h: 1 });
    store2.tick(0);
    store2.endLocal('fading'); // ends at 0
    store2.tick(2000); // fading: elapsed 2000 = HOLD_MS -> mid-fade boundary (alpha 1, phase fading)
    store2.endLocal('holding'); // ends at 2000
    store2.tick(2100); // holding: elapsed 100 -> live/held; fading: elapsed 2100 -> mid-fade, alpha<1
    expect(store2.snapshot().map((s) => s.phase).sort()).toEqual(['fading', 'live', 'live']);

    store2.clear('all');
    expect(store2.snapshot()).toEqual([]);
    // (store from the first block is unused for assertion beyond exercising the API without throwing)
    expect(() => store.clear('all')).not.toThrow();
  });

  it("clear('all') on an empty store does not throw and leaves snapshot() === []", () => {
    const store = new StrokeStore();
    expect(() => store.clear('all')).not.toThrow();
    expect(store.snapshot()).toEqual([]);
  });

  it("clear('mine') removes only local strokes, leaving a remote stroke and its relative position untouched", () => {
    const store = new StrokeStore();
    store.beginLocal('a', { w: 1, h: 1 });
    store.beginLocal('b', { w: 1, h: 1 });
    // Insert a remote stroke directly (apply() does not exist until Plan 03-02).
    store.__testInsertRemote('remote-1', 'r1');

    store.clear('mine');
    expect(store.snapshot().map((x) => x.id)).toEqual(['r1']);
  });

  it("clear(LOCAL_SENDER) produces identical resulting state to clear('mine') on the same store contents", () => {
    const makeStore = () => {
      const store = new StrokeStore();
      store.beginLocal('a', { w: 1, h: 1 });
      store.beginLocal('b', { w: 1, h: 1 });
      return store;
    };

    const storeA = makeStore();
    storeA.clear('mine');

    const storeB = makeStore();
    storeB.clear(LOCAL_SENDER);

    expect(storeA.snapshot()).toEqual(storeB.snapshot());
  });

  it('clear(scope) targeting a specific sender removes only that sender, preserving order of the rest', () => {
    const store = new StrokeStore();
    store.__testInsertRemote('sender-a', 'a');
    store.__testInsertRemote('sender-b', 'b');
    store.__testInsertRemote('sender-c', 'c');

    store.clear('sender-b');
    expect(store.snapshot().map((x) => x.id)).toEqual(['a', 'c']);
  });

  it("clear('all') instantly removes a live local stroke (GEO-05's video-dimension-change trigger) with no fade played", () => {
    const store = new StrokeStore();
    store.beginLocal('s1', { w: 1, h: 1 });
    store.tick(0);
    expect(store.snapshot()[0].phase).toBe('live');

    store.clear('all');
    expect(store.snapshot()).toEqual([]);
  });
});

describe('StrokeStore — one implementation, many consumers (CORE-07)', () => {
  it('three independent subscribers all fire, in registration order, on one tick() call', () => {
    const store = new StrokeStore();
    const calls: string[] = [];
    store.subscribe(() => calls.push('fn1'));
    store.subscribe(() => calls.push('fn2'));
    store.subscribe(() => calls.push('fn3'));

    store.tick(0);
    expect(calls).toEqual(['fn1', 'fn2', 'fn3']);
  });

  it('unsubscribing the middle of three registered subscribers leaves the other two firing in order', () => {
    const store = new StrokeStore();
    const calls: string[] = [];
    store.subscribe(() => calls.push('fn1'));
    const unsub2 = store.subscribe(() => calls.push('fn2'));
    store.subscribe(() => calls.push('fn3'));

    unsub2();
    store.tick(0);
    expect(calls).toEqual(['fn1', 'fn3']);
  });

  it('a store on which subscribe() is never called still runs the full local lifecycle without throwing', () => {
    const store = new StrokeStore();
    expect(() => {
      store.beginLocal('s1', { w: 1, h: 1 });
      store.appendLocal('s1', 0.2, 0.3);
      store.endLocal('s1');
      store.tick(1000);
      store.clear('all');
      store.snapshot();
    }).not.toThrow();
  });
});

describe('computePhaseAndAlpha (pure function, CORE-01/CORE-02)', () => {
  it('no effective end yet -> live, alpha 1', () => {
    expect(computePhaseAndAlpha(500, { endedAt: undefined, lastMoveAt: 0 })).toEqual({
      phase: 'live',
      alpha: 1,
    });
  });

  it('stale watchdog: no move for STALE_MS while live is treated as ended at lastMoveAt + STALE_MS', () => {
    const lastMoveAt = 0;
    const now = lastMoveAt + STALE_MS + HOLD_MS; // elapsed since synthesized end = HOLD_MS exactly
    expect(computePhaseAndAlpha(now, { endedAt: undefined, lastMoveAt })).toEqual({
      phase: 'fading',
      alpha: 1,
    });
  });
});

describe('quantize/dequantize — the wire int <-> real-domain float bridge (RESEARCH.md Pattern 4)', () => {
  it('quantize maps the three cross-checkable fixture values exactly', () => {
    expect(quantize(0)).toBe(1024);
    expect(quantize(1)).toBe(3071);
    expect(quantize(0.5)).toBe(2048);
  });

  it('dequantize(quantize(x)) round-trips within 1/QUANT_STEPS tolerance', () => {
    for (const x of [-0.5, 0, 0.3, 1, 1.5]) {
      expect(Math.abs(dequantize(quantize(x)) - x)).toBeLessThanOrEqual(1 / QUANT_STEPS);
    }
  });

  it('quantize clamps a value outside [QUANT_MIN, QUANT_MAX] to the nearest boundary before rounding', () => {
    expect(quantize(-10)).toBe(quantize(-0.5));
    expect(quantize(10)).toBe(quantize(1.5));
  });
});

describe('StrokeStore.apply() — remote-ingest decode-and-dispatch skeleton (CORE-06)', () => {
  const startPayload = (from: string, id: string, u = 0.5, v = 0.5, frame = { w: 1920, h: 1080 }) => ({
    v: PROTOCOL_VERSION,
    t: MSG_START,
    from,
    id,
    p: [quantize(u), quantize(v)],
    frame,
  });

  const movePayload = (from: string, id: string, pts: readonly (readonly [number, number])[]) => ({
    v: PROTOCOL_VERSION,
    t: MSG_MOVE,
    from,
    id,
    pts: pts.map(([u, v]) => [quantize(u), quantize(v)]),
  });

  const endPayload = (from: string, id: string) => ({
    v: PROTOCOL_VERSION,
    t: MSG_END,
    from,
    id,
  });

  it('apply() of a well-formed Start payload creates a stroke visible in snapshot() with dequantized points', () => {
    const store = new StrokeStore();
    store.apply(startPayload('p1', 's1', 0.5, 0.5), 'p1');

    const stroke = store.snapshot()[0];
    expect(stroke.from).toBe('p1');
    expect(stroke.frame).toEqual({ w: 1920, h: 1080 });
    expect(stroke.points).toHaveLength(1);
    expect(stroke.points[0][0]).toBeCloseTo(0.5, 3);
    expect(stroke.points[0][1]).toBeCloseTo(0.5, 3);
  });

  it("apply() of a Move for an id never Start'd (orphan move) synthesizes a new stroke with frame:undefined (CORE-06)", () => {
    const store = new StrokeStore();
    store.apply(movePayload('p1', 'orphan', [[0.1, 0.2]]), 'p1');

    const stroke = store.snapshot()[0];
    expect(stroke.frame).toBeUndefined();
    expect(stroke.points[0][0]).toBeCloseTo(0.1, 3);
    expect(stroke.points[0][1]).toBeCloseTo(0.2, 3);
  });

  it('apply() of a well-formed End for a known stroke sets it on the path to fading exactly like endLocal()', () => {
    const store = new StrokeStore();
    store.apply(startPayload('p1', 's1'), 'p1');
    store.tick(1000);
    store.apply(endPayload('p1', 's1'), 'p1');

    store.tick(1000 + HOLD_MS); // elapsed = HOLD_MS exactly -> fading, alpha 1 (half-open boundary)
    expect(store.snapshot()[0]).toEqual(expect.objectContaining({ phase: 'fading', alpha: 1 }));
  });

  it('apply() of an End for an id never seen is a no-op — no stroke synthesized (unlike orphan Move)', () => {
    const store = new StrokeStore();
    store.apply(endPayload('p1', 'never-started'), 'p1');
    expect(store.snapshot()).toEqual([]);
  });

  it('apply() of a payload codec.decode() rejects never throws and never inserts a stroke', () => {
    const store = new StrokeStore();
    expect(() => store.apply({ v: 999, t: MSG_START, from: 'p1', id: 's1' }, 'p1')).not.toThrow();
    expect(store.snapshot()).toEqual([]);

    expect(() => store.apply('not even an object shape { garbage', 'p1')).not.toThrow();
    expect(store.snapshot()).toEqual([]);
  });

  it('two senders sending Start with the identical id produce two independent, non-corrupting strokes', () => {
    const store = new StrokeStore();
    store.apply(startPayload('a', 'x', 0.1, 0.1), 'a');
    store.apply(startPayload('b', 'x', 0.9, 0.9), 'b');

    const strokes = store.snapshot();
    expect(strokes).toHaveLength(2);
    const byFrom = Object.fromEntries(strokes.map((s) => [s.from, s]));
    expect(byFrom.a.points[0][0]).toBeCloseTo(0.1, 3);
    expect(byFrom.b.points[0][0]).toBeCloseTo(0.9, 3);

    store.apply(endPayload('a', 'x'), 'a');
    // Ending sender a's stroke must not affect sender b's identically-id'd stroke.
    expect(store.snapshot().find((s) => s.from === 'b')?.points[0][0]).toBeCloseTo(0.9, 3);
  });
});

describe('StrokeStore defensive caps — evict-oldest, shared across local and remote inserts (CORE-04, D-03)', () => {
  it('exports the exact D-03 cap numbers', () => {
    expect(MAX_STROKES_PER_SENDER).toBe(4);
    expect(MAX_TOTAL_STROKES).toBe(16);
    expect(MAX_POINTS_PER_STROKE).toBe(256);
  });

  it('inserting a 3rd stroke into a store capped at maxTotalStrokes:2 evicts the globally-oldest by createdAt', () => {
    const store = new StrokeStore({ maxTotalStrokes: 2 });
    store.__testInsertRemote('a', 'first');
    store.tick(10);
    store.__testInsertRemote('b', 'second');
    store.tick(20);
    store.apply(
      { v: PROTOCOL_VERSION, t: MSG_START, from: 'c', id: 'third', p: [2048, 2048], frame: { w: 1, h: 1 } },
      'c',
    );

    const strokes = store.snapshot();
    expect(strokes).toHaveLength(2);
    expect(strokes.map((s) => s.id)).toEqual(['second', 'third']);
  });

  it("a sender with maxStrokesPerSender concurrent strokes open: one more Start evicts THAT sender's own oldest, not another sender's older stroke", () => {
    const store = new StrokeStore({ maxStrokesPerSender: 2, maxTotalStrokes: 100 });
    store.__testInsertRemote('other', 'globally-oldest');
    store.tick(5);
    store.apply(
      { v: PROTOCOL_VERSION, t: MSG_START, from: 'a', id: 's1', p: [2048, 2048], frame: { w: 1, h: 1 } },
      'a',
    );
    store.tick(10);
    store.apply(
      { v: PROTOCOL_VERSION, t: MSG_START, from: 'a', id: 's2', p: [2048, 2048], frame: { w: 1, h: 1 } },
      'a',
    );
    store.tick(20);
    store.apply(
      { v: PROTOCOL_VERSION, t: MSG_START, from: 'a', id: 's3', p: [2048, 2048], frame: { w: 1, h: 1 } },
      'a',
    );

    const strokes = store.snapshot();
    expect(strokes.map((s) => s.id).sort()).toEqual(['globally-oldest', 's2', 's3'].sort());
    expect(strokes.filter((s) => s.from === 'a')).toHaveLength(2);
  });

  it('a local stroke (beginLocal) is NOT exempt from the total cap — it is evicted just like a remote insert', () => {
    const store = new StrokeStore({ maxTotalStrokes: 1 });
    store.__testInsertRemote('remote', 'r1');
    store.tick(10);
    store.beginLocal('local-1', { w: 1, h: 1 });

    const strokes = store.snapshot();
    expect(strokes).toHaveLength(1);
    expect(strokes[0].from).toBe(LOCAL_SENDER);
  });

  it('appending points past maxPointsPerStroke evicts that stroke\'s own OLDEST points first (sliding window)', () => {
    const store = new StrokeStore({ maxPointsPerStroke: 3 });
    store.beginLocal('s1', { w: 1, h: 1 });
    for (let i = 0; i < 5; i++) store.appendLocal('s1', i / 10, i / 10);

    const stroke = store.snapshot()[0];
    expect(stroke.points).toHaveLength(3);
    expect(stroke.points).toEqual([
      [0.2, 0.2],
      [0.3, 0.3],
      [0.4, 0.4],
    ]);
  });

  it('a remote Move appending points past maxPointsPerStroke evicts the oldest points, never rejects the whole message', () => {
    const store = new StrokeStore({ maxPointsPerStroke: 2 });
    store.apply(
      { v: PROTOCOL_VERSION, t: MSG_START, from: 'p1', id: 's1', p: [2048, 2048], frame: { w: 1, h: 1 } },
      'p1',
    );
    store.apply(
      {
        v: PROTOCOL_VERSION,
        t: MSG_MOVE,
        from: 'p1',
        id: 's1',
        pts: [
          [quantize(0.1), quantize(0.1)],
          [quantize(0.2), quantize(0.2)],
        ],
      },
      'p1',
    );

    const stroke = store.snapshot()[0];
    expect(stroke.points).toHaveLength(2);
    expect(stroke.points[0][0]).toBeCloseTo(0.1, 3);
    expect(stroke.points[1][0]).toBeCloseTo(0.2, 3);
  });

  it('cap eviction never logs — console.warn is not called during a total-cap eviction', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new StrokeStore({ maxTotalStrokes: 1 });
    store.__testInsertRemote('a', 'first');
    store.apply(
      { v: PROTOCOL_VERSION, t: MSG_START, from: 'b', id: 'second', p: [2048, 2048], frame: { w: 1, h: 1 } },
      'b',
    );

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('StrokeStore per-sender receive rate limiting (CORE-05, D-04) + Clear/Presence routing', () => {
  const startFrame = (from: string, id: string) => ({
    v: PROTOCOL_VERSION,
    t: MSG_START,
    from,
    id,
    p: [2048, 2048] as [number, number],
    frame: { w: 1, h: 1 },
  });

  it('exports RATE_CAPACITY = 90', () => {
    expect(RATE_CAPACITY).toBe(90);
  });

  it("a sender's first-ever apply() call is never rate-limited", () => {
    const store = new StrokeStore();
    store.apply(startFrame('fresh-sender', 's1'), 'fresh-sender');
    expect(store.snapshot()).toHaveLength(1);
  });

  it('flooding 200 calls in one window from the same sender: only the first 90 are admitted, and a warning logs exactly once', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new StrokeStore({ maxTotalStrokes: 1000, maxStrokesPerSender: 1000 });
    store.tick(0);
    for (let i = 0; i < 200; i++) {
      store.apply(startFrame('flooder', `s${i}`), 'flooder');
    }

    expect(store.snapshot().filter((s) => s.from === 'flooder')).toHaveLength(90);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('after tokens recover past 1, the next over-budget episode logs again (per-episode, not permanent)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new StrokeStore({ maxTotalStrokes: 1000, maxStrokesPerSender: 1000 });
    store.tick(0);
    for (let i = 0; i < 91; i++) store.apply(startFrame('flooder', `a${i}`), 'flooder');
    expect(warnSpy).toHaveBeenCalledTimes(1);

    store.tick(2000); // refills tokens well past 1 (2000ms * 0.09/ms = 180, capped at RATE_CAPACITY)
    store.apply(startFrame('flooder', 'recovered'), 'flooder'); // admitted, re-arms warnedSinceRecovery

    for (let i = 0; i < 91; i++) store.apply(startFrame('flooder', `b${i}`), 'flooder');
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it('a rate-limited (dropped) message never reaches decode()', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const decodeSpy = vi.spyOn(codec, 'decode');
    const store = new StrokeStore({ maxTotalStrokes: 1000, maxStrokesPerSender: 1000 });
    store.tick(0);
    for (let i = 0; i < 90; i++) store.apply(startFrame('flooder2', `s${i}`), 'flooder2');
    expect(decodeSpy).toHaveBeenCalledTimes(90);
    decodeSpy.mockClear();

    // Over budget now — a deliberately malformed payload must not reach decode().
    store.apply({ garbage: true }, 'flooder2');
    expect(decodeSpy).not.toHaveBeenCalled();

    decodeSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("two senders have fully independent token buckets — flooding 'a' has zero effect on 'b'", () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new StrokeStore({ maxTotalStrokes: 1000, maxStrokesPerSender: 1000 });
    store.tick(0);
    for (let i = 0; i < 91; i++) store.apply(startFrame('a', `a${i}`), 'a');

    store.apply(startFrame('b', 'b0'), 'b');
    expect(store.snapshot().some((s) => s.from === 'b' && s.id === 'b0')).toBe(true);
    warnSpy.mockRestore();
  });

  it("apply() of a well-formed Clear payload removes only that sender's strokes, leaving others untouched", () => {
    const store = new StrokeStore();
    store.apply(startFrame('p1', 's1'), 'p1');
    store.apply(startFrame('p2', 's2'), 'p2');

    store.apply({ v: PROTOCOL_VERSION, t: MSG_CLEAR, from: 'p1' }, 'p1');

    expect(store.snapshot().map((s) => s.from)).toEqual(['p2']);
  });

  it('apply() of a well-formed Presence payload is a deliberate no-op — no state change, no throw, no log', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new StrokeStore();
    store.apply(startFrame('p1', 's1'), 'p1');
    const before = store.snapshot();

    expect(() => store.apply({ v: PROTOCOL_VERSION, t: MSG_PRESENCE, from: 'p1', vis: true }, 'p1')).not.toThrow();
    expect(store.snapshot()).toEqual(before);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('StrokeStore.onOutbound — immediate start/end + move coalescing (PROTO-03)', () => {
  it('exports the exact PROTO-03 coalescing constants', () => {
    expect(MOVE_COALESCE_TIME_MS).toBe(33);
    expect(MOVE_COALESCE_DISTANCE_EPSILON).toBe(0.01);
  });

  it('the FIRST appendLocal call after beginLocal immediately fires onOutbound once with a Start-shaped frame', () => {
    const store = new StrokeStore();
    const frames: unknown[] = [];
    store.onOutbound((f) => frames.push(f));

    store.beginLocal('s1', { w: 1920, h: 1080 });
    store.appendLocal('s1', 0.5, 0.5);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      t: MSG_START,
      from: LOCAL_SENDER,
      id: 's1',
      p: [quantize(0.5), quantize(0.5)],
      frame: { w: 1920, h: 1080 },
    });
  });

  it('a SECOND appendLocal call within the distance epsilon, no tick() in between, does NOT fire onOutbound again yet', () => {
    const store = new StrokeStore();
    const frames: unknown[] = [];
    store.onOutbound((f) => frames.push(f));

    store.beginLocal('s1', { w: 1, h: 1 });
    store.appendLocal('s1', 0.5, 0.5);
    store.appendLocal('s1', 0.5 + MOVE_COALESCE_DISTANCE_EPSILON / 2, 0.5);

    expect(frames).toHaveLength(1); // only the Start
  });

  it('tick(now) at least MOVE_COALESCE_TIME_MS after the Start, with pending points, fires one Move with all pending points in order', () => {
    const store = new StrokeStore();
    const frames: any[] = [];
    store.onOutbound((f) => frames.push(f));

    store.tick(0);
    store.beginLocal('s1', { w: 1, h: 1 });
    store.appendLocal('s1', 0.5, 0.5); // Start, immediate
    store.appendLocal('s1', 0.51, 0.5); // buffered
    store.appendLocal('s1', 0.52, 0.5); // buffered

    store.tick(MOVE_COALESCE_TIME_MS);

    expect(frames).toHaveLength(2);
    expect(frames[1]).toMatchObject({
      t: MSG_MOVE,
      from: LOCAL_SENDER,
      id: 's1',
      pts: [
        [quantize(0.51), quantize(0.5)],
        [quantize(0.52), quantize(0.5)],
      ],
    });
  });

  it('elapsed exactly MOVE_COALESCE_TIME_MS is a closed lower bound — it flushes, not just elapsed > MOVE_COALESCE_TIME_MS', () => {
    const store = new StrokeStore();
    const frames: any[] = [];
    store.onOutbound((f) => frames.push(f));

    store.tick(0);
    store.beginLocal('s1', { w: 1, h: 1 });
    store.appendLocal('s1', 0.5, 0.5); // Start at tick-now 0
    store.appendLocal('s1', 0.501, 0.5); // buffered, within epsilon distance

    store.tick(MOVE_COALESCE_TIME_MS); // elapsed since Start's lastFlushAt == MOVE_COALESCE_TIME_MS exactly

    expect(frames.filter((f) => f.t === MSG_MOVE)).toHaveLength(1);
  });

  it('a point appended at distance >= epsilon from the last flushed point flushes on the NEXT tick() even if elapsed < MOVE_COALESCE_TIME_MS', () => {
    const store = new StrokeStore();
    const frames: any[] = [];
    store.onOutbound((f) => frames.push(f));

    store.tick(0);
    store.beginLocal('s1', { w: 1, h: 1 });
    store.appendLocal('s1', 0.5, 0.5); // Start
    store.appendLocal('s1', 0.5 + MOVE_COALESCE_DISTANCE_EPSILON, 0.5); // far enough to trip distance flush

    store.tick(1); // well under MOVE_COALESCE_TIME_MS

    expect(frames.filter((f) => f.t === MSG_MOVE)).toHaveLength(1);
  });

  it('a tick() call with zero pending points fires zero onOutbound events for that stroke', () => {
    const store = new StrokeStore();
    const frames: any[] = [];

    store.tick(0);
    store.beginLocal('s1', { w: 1, h: 1 });
    store.appendLocal('s1', 0.5, 0.5); // Start only, no buffered points

    store.onOutbound((f) => frames.push(f)); // subscribe AFTER the Start already fired
    store.tick(MOVE_COALESCE_TIME_MS + 100);

    expect(frames).toHaveLength(0);
  });

  it("endLocal with pending unflushed points fires one final Move, THEN exactly one End — in that order", () => {
    const store = new StrokeStore();
    const frames: any[] = [];
    store.onOutbound((f) => frames.push(f));

    store.tick(0);
    store.beginLocal('s1', { w: 1, h: 1 });
    store.appendLocal('s1', 0.5, 0.5); // Start
    store.appendLocal('s1', 0.6, 0.5); // buffered, never flushed by a tick()
    store.endLocal('s1');

    expect(frames.map((f) => f.t)).toEqual([MSG_START, MSG_MOVE, MSG_END]);
    expect(frames[1].pts).toEqual([[quantize(0.6), quantize(0.5)]]);
    expect(frames[2]).toMatchObject({ t: MSG_END, from: LOCAL_SENDER, id: 's1' });
  });

  it('applying a remote Start+Move via apply() never fires onOutbound, regardless of how many tick() calls follow', () => {
    const store = new StrokeStore();
    const frames: unknown[] = [];
    store.onOutbound((f) => frames.push(f));

    store.apply(
      { v: PROTOCOL_VERSION, t: MSG_START, from: 'remote-1', id: 'r1', p: [2048, 2048], frame: { w: 1, h: 1 } },
      'remote-1',
    );
    store.apply(
      { v: PROTOCOL_VERSION, t: MSG_MOVE, from: 'remote-1', id: 'r1', pts: [[2100, 2100]] },
      'remote-1',
    );
    store.tick(0);
    store.tick(1000);
    store.tick(MOVE_COALESCE_TIME_MS * 10);

    expect(frames).toHaveLength(0);
  });

  it("a StrokeStore constructed with localId: 'real-participant-id' emits every onOutbound frame with from: 'real-participant-id'", () => {
    const store = new StrokeStore({ localId: 'real-participant-id' });
    const frames: any[] = [];
    store.onOutbound((f) => frames.push(f));

    store.beginLocal('s1', { w: 1, h: 1 });
    store.appendLocal('s1', 0.5, 0.5);
    store.endLocal('s1');

    expect(frames.every((f) => f.from === 'real-participant-id')).toBe(true);
  });

  it('a StrokeStore constructed with no localId option emits onOutbound frames with from: LOCAL_SENDER', () => {
    const store = new StrokeStore();
    const frames: any[] = [];
    store.onOutbound((f) => frames.push(f));

    store.beginLocal('s1', { w: 1, h: 1 });
    store.appendLocal('s1', 0.5, 0.5);

    expect(frames[0].from).toBe(LOCAL_SENDER);
  });

  it('registering two independent onOutbound(fn) listeners both fire, in registration order, for the same emission', () => {
    const store = new StrokeStore();
    const calls: string[] = [];
    store.onOutbound(() => calls.push('fn1'));
    store.onOutbound(() => calls.push('fn2'));

    store.beginLocal('s1', { w: 1, h: 1 });
    store.appendLocal('s1', 0.5, 0.5);

    expect(calls).toEqual(['fn1', 'fn2']);
  });
});
