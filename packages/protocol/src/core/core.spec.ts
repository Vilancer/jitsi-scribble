import { describe, expect, it } from 'vitest';

import { computePhaseAndAlpha, FADE_MS, HOLD_MS, LOCAL_SENDER, STALE_MS, StrokeStore } from './index.js';

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
