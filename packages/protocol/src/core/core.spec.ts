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
