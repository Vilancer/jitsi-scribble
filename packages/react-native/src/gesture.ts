// DRAW-01/03/05/08's local-echo touch-capture worklet
// (.planning/phases/05-react-native-overlay/05-RESEARCH.md Patterns 1-3).
// A single `Gesture.Pan().maxPointers(1)` — never a composed `Gesture.Tap()`
// — builds an SVG path `d` string on the UI thread by append-only mutation
// of a `SharedValue<string>`, classifies tap-vs-drag once, at `onEnd`, via
// Plan 05-01's `classifyGesture`, and bridges every sample to the JS thread
// via `runOnJS` without ever blocking the UI thread's own paint (DRAW-01).
//
// DRAW-08's three hot-path anti-patterns this file is provably free of:
//   1. No React state update per sample — the only mutable state below is
//      Reanimated SharedValues (see gesture.spec.ts's static assertion).
//   2. No path-string REBUILD per sample — `onBegin` performs exactly one
//      assignment (`buildInitialPathSegment`); `onUpdate` performs exactly
//      one append (`appendPathSegment`), never re-deriving the whole string
//      from an array of points.
//   3. No growing JS array per sample — raw points are written into a
//      fixed-capacity ring buffer (`pointsRing`, sized to protocol/core's own
//      `MAX_POINTS_PER_STROKE`) that overwrites its oldest entry once full,
//      via `pushRingPoint`'s in-place element mutation, never a
//      spread-and-grow.
//
// `buildInitialPathSegment`/`appendPathSegment`/`pushRingPoint` are pulled
// out as their own zero-import, `'worklet'`-directive pure functions —
// mirroring `gestureClassifier.ts`'s established pattern (05-PATTERNS.md
// "Worklet-safe pure function extraction") — so this file's core hot-path
// logic is unit-testable as plain JS functions without needing
// `react-native-gesture-handler`/`react-native-reanimated`'s native modules
// at all (see gesture.spec.ts).
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import { MAX_POINTS_PER_STROKE } from '@vilancer/protocol/core';

import { classifyGesture } from './gestureClassifier.js';

/** onBegin: ONE assignment, never a concatenation — the "starting from
 * nothing" case is handled distinctly from every subsequent append
 * (DRAW-08). Zero imports, `'worklet'` as this function body's own first
 * statement, so Reanimated's babel plugin can workletize it across the
 * import boundary from gesture.ts's worklet callbacks. */
export function buildInitialPathSegment(x: number, y: number): string {
  'worklet';
  return `M ${x} ${y}`;
}

/** onUpdate: appends exactly one ' L x y' segment per call — an append, not
 * a rebuild. Two consecutive samples at the exact same (x, y) still append a
 * single segment; this function never special-cases duplicate points
 * (DRAW-08 forbids adding per-sample work of any kind, including
 * deduplication). */
export function appendPathSegment(current: string, x: number, y: number): string {
  'worklet';
  return current + ` L ${x} ${y}`;
}

/** Pushes [x, y] into `ring` at `writeIndex % ring.length`, mutating that one
 * element in place — never reassigning/growing `ring` itself — and returns
 * the next write index. Once `writeIndex` wraps past `ring.length`, this
 * overwrites the oldest entry (index 0 of the current lap), which is the
 * fixed-capacity ring-buffer contract DRAW-08 requires in place of a
 * growing JS array. */
export function pushRingPoint(ring: Array<[number, number]>, writeIndex: number, x: number, y: number): number {
  'worklet';
  const capacity = ring.length;
  ring[writeIndex % capacity] = [x, y];
  return (writeIndex + 1) % capacity;
}

export interface LocalStrokeGestureCallbacks {
  /** Called once, from onBegin, with the stroke's first raw (x, y) sample
   * (overlay-view pixel coordinates — normalization against the content
   * rect is the JS-side caller's job, not this file's). */
  onLocalBegin: (x: number, y: number) => void;
  /** Called once per onUpdate, with the same raw (x, y) sample this
   * worklet just appended to `pathString`/`pointsRing`. */
  onLocalSample: (x: number, y: number) => void;
  /** Called once, from onEnd, with DRAW-03's tap/drag classification —
   * D-01's discriminant that later reaches the wire via
   * `StrokeStore.endLocal(id, kind)`. */
  onLocalEnd: (kind: 'tap' | 'stroke') => void;
}

export interface LocalStrokeGestureHandle {
  /** The configured `Gesture.Pan().maxPointers(1)` object — pass this
   * directly to `<GestureDetector gesture={pan}>` (Plan 05-04). */
  pan: ReturnType<typeof Gesture.Pan>;
  /** The append-only SVG path `d` string, painted via `useAnimatedProps` on
   * an `<AnimatedPath d={pathString.value}>` (Plan 05-04) — entirely on the
   * UI thread, never crossing to JS for rendering (DRAW-01). */
  pathString: { value: string };
}

/**
 * DRAW-05's single-pointer discipline (`maxPointers(1)`) plus DRAW-01/03/08's
 * local-echo worklet, composed into one hook. Every worklet callback below
 * delegates its hot-path math to the zero-import pure functions above and to
 * `gestureClassifier.ts`'s `classifyGesture` (Plan 05-01) — this hook's own
 * job is only wiring: capture start position/time at `onBegin`, mutate
 * `pathString`/`pointsRing` at `onUpdate`, classify at `onEnd`, and bridge
 * every one of those moments to the JS thread via `runOnJS` (Pattern 2 —
 * `runOnJS` schedules the JS-thread call without blocking this worklet's own
 * UI-thread paint).
 */
export function useLocalStrokeGesture(callbacks: LocalStrokeGestureCallbacks): LocalStrokeGestureHandle {
  const pathString = useSharedValue('');
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startTimeMs = useSharedValue(0);
  // A pre-allocated, fixed-length array — never grown, only mutated in place
  // by pushRingPoint above.
  const pointsRing = useSharedValue<Array<[number, number]>>(
    Array.from({ length: MAX_POINTS_PER_STROKE }, (): [number, number] => [0, 0]),
  );
  const ringWriteIndex = useSharedValue(0);

  const pan = Gesture.Pan()
    .maxPointers(1) // DRAW-05
    .onBegin((e) => {
      startX.value = e.x;
      startY.value = e.y;
      startTimeMs.value = performance.now(); // worklet-safe per Reanimated's own docs
      ringWriteIndex.value = 0;
      pathString.value = buildInitialPathSegment(e.x, e.y);
      runOnJS(callbacks.onLocalBegin)(e.x, e.y);
    })
    .onUpdate((e) => {
      pathString.value = appendPathSegment(pathString.value, e.x, e.y);
      ringWriteIndex.value = pushRingPoint(pointsRing.value, ringWriteIndex.value, e.x, e.y);
      runOnJS(callbacks.onLocalSample)(e.x, e.y);
    })
    .onEnd((e) => {
      const totalDistance = Math.hypot(e.x - startX.value, e.y - startY.value);
      const elapsed = performance.now() - startTimeMs.value;
      // DRAW-03: classified once, on lift, by calling Plan 05-01's
      // classifyGesture directly inside this worklet — legal only because
      // gestureClassifier.ts's own 'worklet' directive makes it
      // workletizable across this import boundary (if a future edit drops
      // that directive, this call fails at runtime, not at typecheck).
      const kind = classifyGesture(totalDistance, elapsed);
      runOnJS(callbacks.onLocalEnd)(kind);
    });

  return { pan, pathString };
}
