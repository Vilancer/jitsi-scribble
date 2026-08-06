import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { appendPathSegment, buildInitialPathSegment, pushRingPoint, useLocalStrokeGesture } from './gesture.js';

/** gesture-handler's own gesture objects store their configuration and
 * worklet callbacks on internal, untyped `config`/`handlers` bags
 * (RESEARCH.md Pattern 3's own documented seam — `pan.handlers.onX` is
 * directly callable under test). This narrow local shape avoids reaching
 * for `any` to access them. */
interface GestureInternals {
  config: { maxPointers?: number };
  handlers: {
    onBegin: (e: { x: number; y: number }) => void;
    onUpdate: (e: { x: number; y: number }) => void;
    onEnd: (e: { x: number; y: number }) => void;
  };
}

// DRAW-08's own static assertion: this file's only mutable state is
// Reanimated SharedValues — never a React `useState`/`useReducer` call of
// any kind. Read the raw source rather than importing React internals,
// since the thing under test is "this file never calls the hook", not any
// runtime behavior a mounted component could exhibit.
describe('gesture.ts — no React component-state hook (DRAW-08)', () => {
  it('contains zero calls to useState or useReducer', () => {
    const source = readFileSync(join(__dirname, 'gesture.ts'), 'utf8');
    expect(source).not.toMatch(/\buseState\s*\(/);
    expect(source).not.toMatch(/\buseReducer\s*\(/);
  });
});

// The hot-path worklet logic (DRAW-01/03/08) extracted into zero-import,
// 'worklet'-directive pure functions (mirroring gestureClassifier.ts's own
// established pattern) — exercised directly as plain JS functions, with no
// react-native-gesture-handler/react-native-reanimated native module needed
// at all. This is the "exercise the worklet functions as plain JS
// functions" case this task's own plan text anticipates, resolved without
// needing to defer anything to Plan 05-04.
describe('gesture.ts — path-string append-only construction (DRAW-01/08)', () => {
  it('onBegin is a single assignment: "M x y", not a concatenation', () => {
    expect(buildInitialPathSegment(10, 20)).toBe('M 10 20');
  });

  it('a sequence of three onUpdate-equivalent appends produces exactly three " L" segments plus the initial "M"', () => {
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

describe('gesture.ts — fixed-capacity point ring buffer (DRAW-08)', () => {
  it('writes points in place without growing the array, in temporal order', () => {
    const ring: Array<[number, number]> = [
      [0, 0],
      [0, 0],
      [0, 0],
    ];
    let writeIndex = 0;
    writeIndex = pushRingPoint(ring, writeIndex, 1, 1);
    writeIndex = pushRingPoint(ring, writeIndex, 2, 2);

    expect(ring).toEqual([
      [1, 1],
      [2, 2],
      [0, 0],
    ]);
    expect(ring).toHaveLength(3); // never grew past its original capacity
    expect(writeIndex).toBe(2);
  });

  it('overwrites the oldest entry once full, rather than growing', () => {
    const ring: Array<[number, number]> = [
      [0, 0],
      [0, 0],
    ];
    let writeIndex = 0;
    writeIndex = pushRingPoint(ring, writeIndex, 1, 1); // index 0
    writeIndex = pushRingPoint(ring, writeIndex, 2, 2); // index 1, buffer now full
    writeIndex = pushRingPoint(ring, writeIndex, 3, 3); // wraps: overwrites index 0's [1,1]

    expect(ring).toEqual([
      [3, 3],
      [2, 2],
    ]);
    expect(ring).toHaveLength(2);
    expect(writeIndex).toBe(1);
  });

  it('a duplicate identical (x, y) sample appends a second zero-length-equivalent entry, never deduplicated', () => {
    const ring: Array<[number, number]> = [
      [0, 0],
      [0, 0],
    ];
    let writeIndex = 0;
    writeIndex = pushRingPoint(ring, writeIndex, 4, 4);
    writeIndex = pushRingPoint(ring, writeIndex, 4, 4);

    expect(ring).toEqual([
      [4, 4],
      [4, 4],
    ]);
    expect(writeIndex).toBe(0);
  });
});

// The composed hook itself — proven callable end to end (onBegin -> onUpdate
// x3 -> onEnd) via the package's manual react-native-reanimated Jest mock
// (__mocks__/react-native-reanimated.js), which sidesteps the real
// package's native-module-eager-init throw under Jest without needing to
// defer this assertion to Plan 05-04.
describe('useLocalStrokeGesture — composed worklet callbacks (DRAW-01/03/05/08)', () => {
  it('maxPointers(1) is configured on the returned pan gesture (DRAW-05)', () => {
    const { pan } = useLocalStrokeGesture({
      onLocalBegin: () => {},
      onLocalSample: () => {},
      onLocalEnd: () => {},
    });

    expect((pan as unknown as GestureInternals).config.maxPointers).toBe(1);
  });

  it('onBegin -> three onUpdate -> onEnd drives pathString append-only and classifies via classifyGesture', () => {
    const samples: Array<[number, number]> = [];
    let began: [number, number] | undefined;
    let endedKind: 'tap' | 'stroke' | undefined;

    const { pan, pathString } = useLocalStrokeGesture({
      onLocalBegin: (x, y) => {
        began = [x, y];
      },
      onLocalSample: (x, y) => {
        samples.push([x, y]);
      },
      onLocalEnd: (kind) => {
        endedKind = kind;
      },
    });

    const handlers = (pan as unknown as GestureInternals).handlers;
    handlers.onBegin({ x: 0, y: 0 });
    handlers.onUpdate({ x: 1, y: 1 });
    handlers.onUpdate({ x: 2, y: 2 });
    handlers.onUpdate({ x: 50, y: 50 }); // far enough + (via the real clock) slow enough to classify as a stroke
    handlers.onEnd({ x: 50, y: 50 });

    expect(began).toEqual([0, 0]);
    expect(samples).toEqual([
      [1, 1],
      [2, 2],
      [50, 50],
    ]);
    expect(pathString.value).toBe('M 0 0 L 1 1 L 2 2 L 50 50');
    expect(endedKind).toBe('stroke'); // totalDistance (~70.7) >= 8dp threshold
  });
});
