import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderHook } from '@testing-library/react-native';

import {
  appendPathSegment,
  buildInitialPathSegment,
  useLocalStrokeGesture,
} from './gesture.js';

/** gesture-handler's gesture objects store their configuration and worklet
 * callbacks on internal, untyped `config`/`handlers` bags (RESEARCH.md
 * Pattern 3's documented seam — `gesture.handlers.onX` is directly callable
 * under test). This narrow local shape avoids reaching for `any`. */
interface TouchPoint {
  id: number;
  x: number;
  y: number;
}
interface TouchEventPayload {
  changedTouches: TouchPoint[];
  numberOfTouches: number;
}
interface FakeStateManager {
  begin: jest.Mock;
  activate: jest.Mock;
  end: jest.Mock;
  fail: jest.Mock;
}
interface GestureInternals {
  handlers: {
    onTouchesDown: (e: TouchEventPayload, mgr: FakeStateManager) => void;
    onTouchesMove: (e: TouchEventPayload, mgr: FakeStateManager) => void;
    onTouchesUp: (e: TouchEventPayload, mgr: FakeStateManager) => void;
    onTouchesCancelled: (e: TouchEventPayload, mgr: FakeStateManager) => void;
  };
}

function mgr(): FakeStateManager {
  return {
    begin: jest.fn(),
    activate: jest.fn(),
    end: jest.fn(),
    fail: jest.fn(),
  };
}

function touch(id: number, x: number, y: number): TouchPoint {
  return { id, x, y };
}

interface CapturedCalls {
  begins: Array<[number, number]>;
  samples: Array<[number, number]>;
  ends: Array<'tap' | 'stroke'>;
}

async function renderGesture(): Promise<{
  handlers: GestureInternals['handlers'];
  calls: CapturedCalls;
  gesture: () => unknown;
}> {
  const calls: CapturedCalls = { begins: [], samples: [], ends: [] };
  const { result } = await renderHook(() =>
    useLocalStrokeGesture({
      onLocalBegin: (x, y) => calls.begins.push([x, y]),
      onLocalSample: (x, y) => calls.samples.push([x, y]),
      onLocalEnd: (kind) => calls.ends.push(kind),
    }),
  );
  return {
    handlers: (result.current.gesture as unknown as GestureInternals)
      .handlers,
    calls,
    gesture: () => result.current.gesture,
  };
}

// DRAW-08's static assertion: this file's only mutable state is Reanimated
// SharedValues — never a React `useState`/`useReducer` call of any kind.
describe('gesture.ts — no React component-state hook (DRAW-08)', () => {
  it('contains zero calls to useState or useReducer', () => {
    const source = readFileSync(join(__dirname, 'gesture.ts'), 'utf8');
    expect(source).not.toMatch(/\buseState\s*\(/);
    expect(source).not.toMatch(/\buseReducer\s*\(/);
  });
});

describe('gesture.ts — path-string append-only construction (DRAW-01/08)', () => {
  it('stroke start is a single assignment: "M x y", not a concatenation', () => {
    expect(buildInitialPathSegment(10, 20)).toBe('M 10 20');
  });

  it('a sequence of three appends produces exactly three " L" segments plus the initial "M"', () => {
    let path = buildInitialPathSegment(0, 0);
    path = appendPathSegment(path, 1, 1);
    path = appendPathSegment(path, 2, 2);
    path = appendPathSegment(path, 3, 3);

    expect(path).toBe('M 0 0 L 1 1 L 2 2 L 3 3');
    expect(path.match(/ L /g)).toHaveLength(3);
    expect(path.startsWith('M ')).toBe(true);
  });

  it('two consecutive identical (x, y) samples still append a single, non-deduplicated segment each', () => {
    let path = buildInitialPathSegment(5, 5);
    path = appendPathSegment(path, 5, 5);
    path = appendPathSegment(path, 5, 5);

    expect(path).toBe('M 5 5 L 5 5 L 5 5');
    expect(path.match(/ L /g)).toHaveLength(2);
  });
});

// The composed hook — driven through the Manual gesture's touch handlers
// exactly as gesture-handler would drive them, with a fake state manager.
// These scenarios mirror the on-device UAT findings that forced the rewrite
// (05-UAT.md tests 2 and 3): taps must actually classify as taps, and a
// pointer that lands FIRST but never moves must never own the stroke.
describe('useLocalStrokeGesture — Manual per-pointer event model (DRAW-01/03/05/08)', () => {
  it('a drag begins at its DOWN position once movement crosses the 8dp slop, samples from there, and ends as a stroke', async () => {
    const { handlers, calls } = await renderGesture();
    const m = mgr();

    handlers.onTouchesDown(
      { changedTouches: [touch(1, 0, 0)], numberOfTouches: 1 },
      m,
    );
    expect(m.begin).toHaveBeenCalledTimes(1);

    // Sub-slop wiggle: nothing begins yet.
    handlers.onTouchesMove(
      { changedTouches: [touch(1, 3, 3)], numberOfTouches: 1 },
      m,
    );
    expect(calls.begins).toHaveLength(0);
    expect(m.activate).not.toHaveBeenCalled();

    // Crosses the slop: stroke begins at the ORIGINAL down position.
    handlers.onTouchesMove(
      { changedTouches: [touch(1, 10, 10)], numberOfTouches: 1 },
      m,
    );
    expect(m.activate).toHaveBeenCalledTimes(1);
    expect(calls.begins).toEqual([[0, 0]]);
    expect(calls.samples).toEqual([[10, 10]]);

    handlers.onTouchesMove(
      { changedTouches: [touch(1, 20, 20)], numberOfTouches: 1 },
      m,
    );
    handlers.onTouchesUp(
      { changedTouches: [touch(1, 20, 20)], numberOfTouches: 0 },
      m,
    );

    expect(calls.ends).toEqual(['stroke']);
    expect(m.end).toHaveBeenCalledTimes(1);
  });

  it("the drag's pathString starts at the down position and appends each sample (CR-03's UI-thread d source)", async () => {
    const { handlers } = await renderGesture();
    const m = mgr();
    const { result } = await renderHook(() =>
      useLocalStrokeGesture({
        onLocalBegin: () => {},
        onLocalSample: () => {},
        onLocalEnd: () => {},
      }),
    );
    const h = (result.current.gesture as unknown as GestureInternals)
      .handlers;

    h.onTouchesDown(
      { changedTouches: [touch(1, 0, 0)], numberOfTouches: 1 },
      m,
    );
    h.onTouchesMove(
      { changedTouches: [touch(1, 10, 0)], numberOfTouches: 1 },
      m,
    );
    h.onTouchesMove(
      { changedTouches: [touch(1, 20, 5)], numberOfTouches: 1 },
      m,
    );

    expect(result.current.pathString.value).toBe('M 0 0 L 10 0 L 20 5');
    void handlers; // silence unused from the shared helper
  });

  it('a quick still tap emits a begin+end("tap") pair at its down position (UAT-2 regression)', async () => {
    const { handlers, calls } = await renderGesture();
    const m = mgr();

    handlers.onTouchesDown(
      { changedTouches: [touch(1, 40, 50)], numberOfTouches: 1 },
      m,
    );
    // Lift immediately (same tick → elapsed ~0ms, distance ~1dp).
    handlers.onTouchesUp(
      { changedTouches: [touch(1, 41, 50)], numberOfTouches: 0 },
      m,
    );

    expect(calls.begins).toEqual([[40, 50]]);
    expect(calls.ends).toEqual(['tap']);
    expect(m.end).toHaveBeenCalledTimes(1);
  });

  it('a stationary long press (resting thumb lifting) emits NOTHING (UAT-3 palm case)', async () => {
    const { handlers, calls } = await renderGesture();
    const m = mgr();

    handlers.onTouchesDown(
      { changedTouches: [touch(1, 5, 300)], numberOfTouches: 1 },
      m,
    );
    // Rest longer than the 150ms tap window, without moving.
    await new Promise((resolve) => setTimeout(resolve, 170));
    handlers.onTouchesUp(
      { changedTouches: [touch(1, 6, 300)], numberOfTouches: 0 },
      m,
    );

    expect(calls.begins).toHaveLength(0);
    expect(calls.ends).toHaveLength(0);
    expect(m.end).toHaveBeenCalledTimes(1);
  });

  it('a thumb resting FIRST never owns the stroke: the finger that moves draws, the thumb is ignored (UAT-3 regression)', async () => {
    const { handlers, calls } = await renderGesture();
    const m = mgr();

    // Thumb lands first and stays still.
    handlers.onTouchesDown(
      { changedTouches: [touch(1, 5, 300)], numberOfTouches: 1 },
      m,
    );
    // Drawing finger lands second.
    handlers.onTouchesDown(
      { changedTouches: [touch(2, 100, 100)], numberOfTouches: 2 },
      m,
    );
    // Finger moves past the slop: IT becomes the stroke pointer.
    handlers.onTouchesMove(
      { changedTouches: [touch(2, 115, 100)], numberOfTouches: 2 },
      m,
    );
    expect(calls.begins).toEqual([[100, 100]]);

    // Thumb micro-jitter mid-stroke: ignored entirely.
    handlers.onTouchesMove(
      { changedTouches: [touch(1, 6, 301)], numberOfTouches: 2 },
      m,
    );
    expect(calls.samples).toEqual([[115, 100]]);

    // Thumb lifts while the stroke is in flight: ignored (never a tap).
    handlers.onTouchesUp(
      { changedTouches: [touch(1, 6, 301)], numberOfTouches: 1 },
      m,
    );
    expect(calls.ends).toHaveLength(0);

    // Finger lifts: exactly one stroke ends.
    handlers.onTouchesUp(
      { changedTouches: [touch(2, 130, 100)], numberOfTouches: 0 },
      m,
    );
    expect(calls.ends).toEqual(['stroke']);
  });

  it('a second pointer landing AFTER the stroke started is ignored for the stroke\'s duration (DRAW-05 original wording)', async () => {
    const { handlers, calls } = await renderGesture();
    const m = mgr();

    handlers.onTouchesDown(
      { changedTouches: [touch(1, 0, 0)], numberOfTouches: 1 },
      m,
    );
    handlers.onTouchesMove(
      { changedTouches: [touch(1, 12, 0)], numberOfTouches: 1 },
      m,
    );
    expect(calls.begins).toHaveLength(1);

    // Palm lands mid-stroke and even moves past the slop: still ignored.
    handlers.onTouchesDown(
      { changedTouches: [touch(2, 200, 200)], numberOfTouches: 2 },
      m,
    );
    handlers.onTouchesMove(
      { changedTouches: [touch(2, 220, 220)], numberOfTouches: 2 },
      m,
    );
    expect(calls.begins).toHaveLength(1);
    expect(calls.samples).toEqual([[12, 0]]);

    handlers.onTouchesUp(
      { changedTouches: [touch(1, 12, 0)], numberOfTouches: 1 },
      m,
    );
    expect(calls.ends).toEqual(['stroke']);
  });

  it('cancellation closes an in-flight stroke so the store fade lifecycle still runs', async () => {
    const { handlers, calls } = await renderGesture();
    const m = mgr();

    handlers.onTouchesDown(
      { changedTouches: [touch(1, 0, 0)], numberOfTouches: 1 },
      m,
    );
    handlers.onTouchesMove(
      { changedTouches: [touch(1, 15, 0)], numberOfTouches: 1 },
      m,
    );
    handlers.onTouchesCancelled(
      { changedTouches: [touch(1, 15, 0)], numberOfTouches: 0 },
      m,
    );

    expect(calls.ends).toEqual(['stroke']);
    expect(m.fail).toHaveBeenCalledTimes(1);
  });

  it('the returned gesture object keeps its identity across re-renders when the callback identities are stable (05-REVIEW.md WR-02)', async () => {
    const callbacks = {
      onLocalBegin: () => {},
      onLocalSample: () => {},
      onLocalEnd: () => {},
    };

    const { result, rerender } = await renderHook(
      (props: typeof callbacks) => useLocalStrokeGesture(props),
      { initialProps: callbacks },
    );

    const first = result.current.gesture;
    await rerender(callbacks);
    expect(result.current.gesture).toBe(first);
  });

  it('the returned gesture object is reconstructed when a callback identity changes', async () => {
    const { result, rerender } = await renderHook(
      (props: { onLocalBegin: () => void }) =>
        useLocalStrokeGesture({
          onLocalBegin: props.onLocalBegin,
          onLocalSample: () => {},
          onLocalEnd: () => {},
        }),
      { initialProps: { onLocalBegin: () => {} } },
    );

    const first = result.current.gesture;
    await rerender({ onLocalBegin: () => {} });
    expect(result.current.gesture).not.toBe(first);
  });
});
