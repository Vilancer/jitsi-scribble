// DRAW-01/03/05/08's local-echo touch-capture worklet
// (.planning/phases/05-react-native-overlay/05-RESEARCH.md Patterns 1-3).
//
// REWRITTEN after Phase 5's on-device UAT (05-UAT.md tests 2 and 3 FAILED on
// the original single `Gesture.Pan().maxPointers(1)` implementation) — two
// real-device findings the synthetic gesture-event tests could not surface:
//
//   UAT-2 (taps): `Gesture.Pan()`'s default activation distance (~10dp) sits
//   ABOVE classifyGesture's 8dp tap threshold, so the `'tap'` branch was
//   unreachable on hardware: a clean tap never activated the pan (no onEnd —
//   no ring, no anything), while any gesture that DID activate had already
//   travelled >=10dp and always classified 'stroke' (taps with finger jitter
//   became tiny lines).
//
//   UAT-3 (palm): `maxPointers(1)` hands the gesture to whichever pointer
//   lands FIRST. DRAW-05's wording only covered a thumb arriving AFTER the
//   drawing finger — but a phone held naturally has the thumb resting on the
//   screen edge BEFORE drawing starts, so the thumb owned the gesture and
//   the drawing finger was ignored entirely.
//
// The fix is a single `Gesture.Manual()` with explicit per-pointer tracking:
//
//   - Every pointer that lands becomes a CANDIDATE (its down position/time
//     recorded). Nothing is drawn on touch-down.
//   - The first candidate to travel >= ACTIVATION_SLOP_DP (8dp — deliberately
//     the same figure as classifyGesture's tap threshold, so "activated" and
//     "classifies as stroke" are the same predicate) becomes THE stroke
//     pointer; the stroke begins at its ORIGINAL down position so no ink is
//     lost. A resting thumb never moves that far, so it can never win —
//     regardless of landing order. This is DRAW-05's palm rejection,
//     implemented by movement rather than by arrival order.
//   - A candidate that lifts without activating classifies via
//     classifyGesture: 'tap' (quick, still) emits a begin+end('tap') pair at
//     its down position; 'stroke' here can only mean the stationary-long-
//     press case (distance <8dp by construction, elapsed >=150ms) — i.e. a
//     resting thumb lifting — and is SUPPRESSED entirely (deliberate
//     deviation: emitting an invisible one-point stroke would also cross the
//     wire for no reason; a palm's lift must produce nothing).
//   - A candidate lifting while another pointer's stroke is in flight is
//     ignored (DRAW-05: extra pointers are ignored for the stroke's
//     duration) — this also protects ScribbleOverlay's single
//     currentLocalIdRef from being clobbered mid-drag by a tap emission.
//
// DRAW-08's hot-path anti-patterns this file remains provably free of:
//   1. No React state update per sample — the only mutable state below is
//      Reanimated SharedValues (see gesture.spec.ts's static assertion).
//   2. No path-string REBUILD per sample — stroke selection performs exactly
//      one assignment (`buildInitialPathSegment` + one append); each
//      subsequent move performs exactly one append (`appendPathSegment`),
//      never re-deriving the whole string.
//   3. No per-sample allocation: the candidates record is REASSIGNED only on
//      touch-down/up/cancel (per-gesture-lifecycle events, not per sample);
//      onTouchesMove only READS it until the one-time stroke selection.
//
// 05-REVIEW.md CR-03 (unchanged): `ScribbleOverlay.tsx` renders the actively-
// dragging local stroke's `d` by reading `pathString.value` directly via
// `useAnimatedProps` — see `LocalActiveStrokePath`.
//
// 05-REVIEW.md WR-02 (unchanged): the gesture object is memoized on the three
// callback identities so `<GestureDetector gesture={...}>` receives a
// referentially stable object across re-renders.
import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import { classifyGesture } from './gestureClassifier.js';

/** DRAW-03's locked 8dp figure, reused as the stroke-activation slop so
 * "moved enough to activate" and "classifies as a stroke" are one predicate
 * (see the header comment). Duplicated from classifyGesture's own literal on
 * purpose — that function is a zero-import worklet by design, and importing
 * a shared constant across the worklet boundary is exactly the kind of
 * babel-plugin-dependent subtlety this file avoids. */
const ACTIVATION_SLOP_DP = 8;

/** onBegin-equivalent: ONE assignment, never a concatenation (DRAW-08).
 * Zero imports, `'worklet'` first statement — workletizable across the
 * import boundary. */
export function buildInitialPathSegment(x: number, y: number): string {
  'worklet';
  return `M ${x} ${y}`;
}

/** Appends exactly one ' L x y' segment per call — an append, not a rebuild.
 * Never special-cases duplicate points (DRAW-08). */
export function appendPathSegment(
  current: string,
  x: number,
  y: number,
): string {
  'worklet';
  return current + ` L ${x} ${y}`;
}

interface CandidateRecord {
  x: number;
  y: number;
  t: number;
}

export interface LocalStrokeGestureCallbacks {
  /** Called once per stroke/tap, with the pointer's DOWN-position sample
   * (overlay-view pixel coordinates — normalization against the content
   * rect is the JS-side caller's job, not this file's). */
  onLocalBegin: (x: number, y: number) => void;
  /** Called once per movement sample of the active stroke pointer. */
  onLocalSample: (x: number, y: number) => void;
  /** Called once per stroke/tap, with DRAW-03's classification — D-01's
   * discriminant that later reaches the wire via
   * `StrokeStore.endLocal(id, kind)`. */
  onLocalEnd: (kind: 'tap' | 'stroke') => void;
}

export interface LocalStrokeGestureHandle {
  /** The configured `Gesture.Manual()` object, memoized (05-REVIEW.md WR-02)
   * so its identity stays stable across re-renders as long as `callbacks`'
   * three function identities do — pass directly to
   * `<GestureDetector gesture={gesture}>`. */
  gesture: ReturnType<typeof Gesture.Manual>;
  /** The append-only SVG path `d` string, read directly via
   * `useAnimatedProps` by `ScribbleOverlay.tsx`'s `LocalActiveStrokePath`
   * (05-REVIEW.md CR-03) for the actively-dragging local stroke only. A
   * Reanimated `SharedValue<string>`; `{ value: string }` is its
   * externally-visible read shape. */
  pathString: { value: string };
}

/** The minimal slice of gesture-handler's touch payload this file reads —
 * kept structural so the worklets below never depend on fields the Jest
 * fakes would have to reproduce. */
interface TouchPoint {
  id: number;
  x: number;
  y: number;
}
interface TouchEventPayload {
  changedTouches: TouchPoint[];
  numberOfTouches: number;
}
interface ManualStateManager {
  begin: () => void;
  activate: () => void;
  end: () => void;
  fail: () => void;
}

/**
 * DRAW-05's palm rejection (movement-based pointer selection, not
 * arrival-order) plus DRAW-01/03/08's local-echo worklet, composed into one
 * hook — see the header comment for the full event model and the on-device
 * UAT failures that shaped it.
 */
export function useLocalStrokeGesture(
  callbacks: LocalStrokeGestureCallbacks,
): LocalStrokeGestureHandle {
  const pathString = useSharedValue('');
  /** Pointer id of the active stroke pointer; -1 when none. */
  const activePointerId = useSharedValue(-1);
  /** Down position/time per still-candidate pointer id. Reassigned (never
   * mutated in place) on down/up/cancel only. */
  const candidates = useSharedValue<Record<number, CandidateRecord>>({});

  const gesture = useMemo(
    () =>
      Gesture.Manual()
        .onTouchesDown((e: TouchEventPayload, mgr: ManualStateManager) => {
          'worklet';
          if (e.numberOfTouches === e.changedTouches.length) {
            // First contact of this gesture — enter BEGAN so the handler
            // owns the interaction until every pointer lifts.
            mgr.begin();
          }
          const next: Record<number, CandidateRecord> = {
            ...candidates.value,
          };
          for (const touch of e.changedTouches) {
            next[touch.id] = { x: touch.x, y: touch.y, t: performance.now() };
          }
          candidates.value = next;
        })
        .onTouchesMove((e: TouchEventPayload, mgr: ManualStateManager) => {
          'worklet';
          if (activePointerId.value !== -1) {
            // A stroke is in flight: append samples from ITS moves only;
            // every other pointer's movement is ignored (DRAW-05).
            for (const touch of e.changedTouches) {
              if (touch.id === activePointerId.value) {
                pathString.value = appendPathSegment(
                  pathString.value,
                  touch.x,
                  touch.y,
                );
                runOnJS(callbacks.onLocalSample)(touch.x, touch.y);
              }
            }
            return;
          }
          // No stroke in flight: the first candidate to travel >=
          // ACTIVATION_SLOP_DP from its own down position becomes the
          // stroke pointer. A resting thumb never gets here.
          for (const touch of e.changedTouches) {
            const start = candidates.value[touch.id];
            if (start === undefined) continue;
            const moved = Math.hypot(touch.x - start.x, touch.y - start.y);
            if (moved >= ACTIVATION_SLOP_DP) {
              activePointerId.value = touch.id;
              // Begin at the ORIGINAL down position so the stroke's first
              // 8dp are not lost, then append the current sample.
              pathString.value = appendPathSegment(
                buildInitialPathSegment(start.x, start.y),
                touch.x,
                touch.y,
              );
              mgr.activate();
              runOnJS(callbacks.onLocalBegin)(start.x, start.y);
              runOnJS(callbacks.onLocalSample)(touch.x, touch.y);
              break;
            }
          }
        })
        .onTouchesUp((e: TouchEventPayload, mgr: ManualStateManager) => {
          'worklet';
          const next: Record<number, CandidateRecord> = {
            ...candidates.value,
          };
          for (const touch of e.changedTouches) {
            const start = next[touch.id];
            delete next[touch.id];
            if (touch.id === activePointerId.value) {
              // The active stroke pointer lifted: an activated pointer moved
              // >= 8dp by construction, so this is always a stroke.
              activePointerId.value = -1;
              runOnJS(callbacks.onLocalEnd)('stroke');
              continue;
            }
            if (start === undefined) continue;
            if (activePointerId.value !== -1) {
              // Extra pointer lifting while a stroke is in flight — ignored
              // for the stroke's duration (DRAW-05), and never allowed to
              // clobber ScribbleOverlay's single in-flight local stroke id.
              continue;
            }
            const moved = Math.hypot(touch.x - start.x, touch.y - start.y);
            const elapsed = performance.now() - start.t;
            // DRAW-03: classified once, on lift. 'tap' emits a begin+end
            // pair at the down position. 'stroke' here can only be the
            // stationary-long-press (resting thumb/palm) case — suppressed
            // entirely, see the header comment.
            if (classifyGesture(moved, elapsed) === 'tap') {
              // Reset pathString first so any interim render of the
              // one-frame activeLocalId window shows a single point, never
              // the PREVIOUS stroke's stale path.
              pathString.value = buildInitialPathSegment(start.x, start.y);
              runOnJS(callbacks.onLocalBegin)(start.x, start.y);
              runOnJS(callbacks.onLocalEnd)('tap');
            }
          }
          candidates.value = next;
          if (e.numberOfTouches === 0) {
            mgr.end();
          }
        })
        .onTouchesCancelled(
          (e: TouchEventPayload, mgr: ManualStateManager) => {
            'worklet';
            if (activePointerId.value !== -1) {
              // Close the in-flight stroke so the store's normal
              // hold-then-fade lifecycle runs rather than leaving an
              // un-ended stroke to the stale watchdog.
              activePointerId.value = -1;
              runOnJS(callbacks.onLocalEnd)('stroke');
            }
            candidates.value = {};
            mgr.fail();
          },
        ),
    [callbacks.onLocalBegin, callbacks.onLocalSample, callbacks.onLocalEnd],
  );

  return { gesture, pathString };
}
