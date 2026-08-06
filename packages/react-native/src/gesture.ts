// DRAW-01/03/05/08's local-echo touch-capture worklet
// (.planning/phases/05-react-native-overlay/05-RESEARCH.md Patterns 1-3).
// A single `Gesture.Pan().maxPointers(1)` — never a composed `Gesture.Tap()`
// — builds an SVG path `d` string on the UI thread by append-only mutation
// of a `SharedValue<string>`, classifies tap-vs-drag once, at `onEnd`, via
// Plan 05-01's `classifyGesture`, and bridges every sample to the JS thread
// via `runOnJS` without ever blocking the UI thread's own paint (DRAW-01).
//
// DRAW-08's hot-path anti-patterns this file is provably free of:
//   1. No React state update per sample — the only mutable state below is
//      Reanimated SharedValues (see gesture.spec.ts's static assertion).
//   2. No path-string REBUILD per sample — `onBegin` performs exactly one
//      assignment (`buildInitialPathSegment`); `onUpdate` performs exactly
//      one append (`appendPathSegment`), never re-deriving the whole string
//      from an array of points.
//   3. No per-sample points array of ANY kind (growing or fixed-capacity) —
//      this file used to also maintain a `pointsRing`/`ringWriteIndex`
//      fixed-capacity ring buffer here, written on every sample; 05-REVIEW.md
//      WR-01 found it had no consumer anywhere in the package (dead
//      per-sample UI-thread work) and it was removed outright rather than
//      wired up, once 05-REVIEW.md CR-03's fix confirmed `pathString` alone
//      is sufficient for rendering the in-progress local stroke.
//      `protocol/core`'s `StrokeStore` keeps the canonical, capped points
//      array on the JS thread (its own `MAX_POINTS_PER_STROKE`, Phase 3) —
//      unrelated to and unaffected by this file.
//
// 05-REVIEW.md CR-03 (this file's own `pathString` is now actually consumed):
// `ScribbleOverlay.tsx` renders the actively-dragging local stroke's `d` by
// reading `pathString.value` directly via `useAnimatedProps`, never by
// rebuilding it from `stroke.points` the way every other (remote, or
// already-ended local) stroke's `d` is computed — see
// `ScribbleOverlay.tsx`'s `LocalActiveStrokePath`. This is what makes the
// UI-thread work this file does non-redundant.
//
// 05-REVIEW.md WR-02: `pan` is memoized via `useMemo`, keyed on the three
// callback identities, so `<GestureDetector gesture={pan}>` receives a
// referentially stable gesture object across re-renders — including the
// touch-sample-driven re-renders of `ScribbleOverlay` that CR-03's fix does
// NOT eliminate (those are driven by `protocol/core`'s own
// `StrokeStore.appendLocal()` calling `notify()` unconditionally on every
// sample, a Phase 3 behavior out of this file's/this phase's scope to
// change). `useSharedValue`'s own contract already guarantees the
// SharedValues closed over below (`pathString`/`startX`/`startY`/
// `startTimeMs`) stay the SAME objects across renders, so memoizing only the
// `Gesture.Pan()` construction is sufficient and correct.
//
// `buildInitialPathSegment`/`appendPathSegment` are pulled out as their own
// zero-import, `'worklet'`-directive pure functions — mirroring
// `gestureClassifier.ts`'s established pattern (05-PATTERNS.md
// "Worklet-safe pure function extraction") — so this file's core hot-path
// logic is unit-testable as plain JS functions without needing
// `react-native-gesture-handler`/`react-native-reanimated`'s native modules
// at all (see gesture.spec.ts).
import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

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
export function appendPathSegment(
  current: string,
  x: number,
  y: number,
): string {
  'worklet';
  return current + ` L ${x} ${y}`;
}

export interface LocalStrokeGestureCallbacks {
  /** Called once, from onBegin, with the stroke's first raw (x, y) sample
   * (overlay-view pixel coordinates — normalization against the content
   * rect is the JS-side caller's job, not this file's). */
  onLocalBegin: (x: number, y: number) => void;
  /** Called once per onUpdate, with the same raw (x, y) sample this
   * worklet just appended to `pathString`. */
  onLocalSample: (x: number, y: number) => void;
  /** Called once, from onEnd, with DRAW-03's tap/drag classification —
   * D-01's discriminant that later reaches the wire via
   * `StrokeStore.endLocal(id, kind)`. */
  onLocalEnd: (kind: 'tap' | 'stroke') => void;
}

export interface LocalStrokeGestureHandle {
  /** The configured `Gesture.Pan().maxPointers(1)` object, memoized (05-
   * REVIEW.md WR-02) so its identity stays stable across re-renders as long
   * as `callbacks`' own three function identities do — pass this directly to
   * `<GestureDetector gesture={pan}>` (Plan 05-04). */
  pan: ReturnType<typeof Gesture.Pan>;
  /** The append-only SVG path `d` string, read directly via
   * `useAnimatedProps` by `ScribbleOverlay.tsx`'s `LocalActiveStrokePath`
   * (05-REVIEW.md CR-03) for the actively-dragging local stroke only —
   * entirely on the UI thread, never crossing to JS for rendering (DRAW-01).
   * This is a Reanimated `SharedValue<string>`; `{ value: string }` is its
   * externally-visible read shape. */
  pathString: { value: string };
}

/**
 * DRAW-05's single-pointer discipline (`maxPointers(1)`) plus DRAW-01/03/08's
 * local-echo worklet, composed into one hook. Every worklet callback below
 * delegates its hot-path math to the zero-import pure functions above and to
 * `gestureClassifier.ts`'s `classifyGesture` (Plan 05-01) — this hook's own
 * job is only wiring: capture start position/time at `onBegin`, mutate
 * `pathString` at `onUpdate`, classify at `onEnd`, and bridge every one of
 * those moments to the JS thread via `runOnJS` (Pattern 2 — `runOnJS`
 * schedules the JS-thread call without blocking this worklet's own UI-thread
 * paint).
 */
export function useLocalStrokeGesture(
  callbacks: LocalStrokeGestureCallbacks,
): LocalStrokeGestureHandle {
  const pathString = useSharedValue('');
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startTimeMs = useSharedValue(0);

  // 05-REVIEW.md WR-02: memoized on the three callback identities, not
  // reconstructed every render. `useSharedValue`'s own contract keeps
  // pathString/startX/startY/startTimeMs referentially stable across
  // renders regardless of whether this memo re-runs, so capturing them in a
  // closure that is itself created only once (per stable callback identity)
  // is safe.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1) // DRAW-05
        .onBegin((e) => {
          startX.value = e.x;
          startY.value = e.y;
          startTimeMs.value = performance.now(); // worklet-safe per Reanimated's own docs
          pathString.value = buildInitialPathSegment(e.x, e.y);
          runOnJS(callbacks.onLocalBegin)(e.x, e.y);
        })
        .onUpdate((e) => {
          pathString.value = appendPathSegment(pathString.value, e.x, e.y);
          runOnJS(callbacks.onLocalSample)(e.x, e.y);
        })
        .onEnd((e) => {
          const totalDistance = Math.hypot(
            e.x - startX.value,
            e.y - startY.value,
          );
          const elapsed = performance.now() - startTimeMs.value;
          // DRAW-03: classified once, on lift, by calling Plan 05-01's
          // classifyGesture directly inside this worklet — legal only because
          // gestureClassifier.ts's own 'worklet' directive makes it
          // workletizable across this import boundary (if a future edit drops
          // that directive, this call fails at runtime, not at typecheck).
          const kind = classifyGesture(totalDistance, elapsed);
          runOnJS(callbacks.onLocalEnd)(kind);
        }),
    [callbacks.onLocalBegin, callbacks.onLocalSample, callbacks.onLocalEnd],
  );

  return { pan, pathString };
}
