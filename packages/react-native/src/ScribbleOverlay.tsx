// DRAW-09: the sibling-view root element. `ScribbleOverlay` is placed by the
// host app (Phase 6's `VideoTile`) as an absolutely-positioned sibling of its
// own video view — never a wrapper, never re-parenting the host's content.
//
// This is Plan 05-04's real implementation, extending Plan 05-01's minimal
// placeholder in place (same file, same DRAW-09 root shape): casing/core
// stroke and tap-ring rendering (Pattern 5), the presence tint (UI-SPEC
// Resolution 1), Reduce Motion's tap-ring final-state rendering (UI-SPEC
// Resolution 2), and the receiver kill switch's render-side filter (UI-SPEC
// Resolution 4) — the four resolutions 05-UI-SPEC.md locks. Composes Plan
// 05-03's `useScribbleSession` (store/session orchestration) and `gesture.ts`
// (local-echo touch capture) into one rendered component; every stroke it
// paints is a pure projection of `useScribbleSession`'s own store snapshot —
// this file introduces zero new stroke-lifecycle logic of its own.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { createAnimatedComponent, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { Circle, G, Path, Svg } from 'react-native-svg';

import type { Stroke } from '@vilancer/protocol/core';
import { LOCAL_SENDER } from '@vilancer/protocol/core';
import type { ContentRect } from '@vilancer/protocol/geometry';
import { computeStrokeWidth, denormalize } from '@vilancer/protocol/geometry';
import { CASING_COLOUR, CASING_EXTRA_WIDTH_DP, CORE_WIDTH_DP, colourForParticipant } from '@vilancer/protocol/render';

import { useLocalStrokeGesture } from './gesture.js';
import { useScribbleSession, type UseScribbleSessionOptions } from './useScribbleSession.js';

const AnimatedPath = createAnimatedComponent(Path);
const AnimatedCircle = createAnimatedComponent(Circle);

/**
 * AWARE-01 / UI-SPEC Resolution 1's presence-unaware opacity multiplier.
 * Deliberately declared HERE, not re-exported from `@vilancer/protocol/render`
 * — presence is an RN-session-only concern (D-02), not shared cross-renderer
 * render policy, so this constant does not belong in the module every
 * renderer imports unchanged.
 */
export const PRESENCE_UNAWARE_OPACITY_CAP = 0.4;

/** FEATURES.md "Stroke geometry" table, UI-SPEC Resolution 2: the tap-ring's
 * fully-expanded radius, in device-independent pixels, before fit-ratio
 * scaling (mirrors CORE_WIDTH_DP's own dp-then-scale convention). */
const TAP_RING_TARGET_RADIUS_DP = 44;

/** FEATURES.md "Stroke geometry" table: the tap-ring's expand animation
 * duration — skipped entirely (Reduce Motion) per UI-SPEC Resolution 2B, but
 * never affecting the hold/fade timing that follows. */
const TAP_RING_EXPAND_MS = 250;

export interface ScribbleOverlayProps extends UseScribbleSessionOptions {
  /** DRAW-04: host-controlled. `false` unmounts the gesture-catching element
   * entirely (never merely disables it) and sets the root's `pointerEvents`
   * to `'none'`, so touches pass through untouched to whatever the host
   * rendered beneath. */
  drawModeEnabled: boolean;
  /** AWARE-02 / UI-SPEC Resolution 4: host-controlled kill switch. `false`
   * hides remote strokes/tap-rings instantly, with no fade transition — a
   * render-side filter only. `useScribbleSession` keeps applying every
   * inbound frame to the store regardless of this prop's value, so
   * lifecycle/caps/rate-limiting never depend on it. */
  receiveAnnotations: boolean;
}

function pathDataFor(stroke: Stroke, rect: ContentRect): string {
  return stroke.points
    .map(([u, v], index) => {
      const { x, y } = denormalize(u, v, rect);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
}

/** Shared width computation for both the `<AnimatedPath>` and
 * `<AnimatedCircle>` branches (UI-SPEC Resolution 2A) — one call site each,
 * no conditional, both reading the exact same `CORE_WIDTH_DP`/
 * `CASING_EXTRA_WIDTH_DP` pair already locked for strokes. */
function casingCoreWidths(contentRect: ContentRect, surfaceBox: { w: number; h: number }): { coreWidth: number; casingWidth: number } {
  return {
    coreWidth: computeStrokeWidth(CORE_WIDTH_DP, contentRect, surfaceBox),
    casingWidth: computeStrokeWidth(CORE_WIDTH_DP + CASING_EXTRA_WIDTH_DP, contentRect, surfaceBox),
  };
}

/** UI-SPEC Resolution 1's exact formula: `stroke.alpha * (isLocal &&
 * !remotePresence ? PRESENCE_UNAWARE_OPACITY_CAP : 1.0)`. Applied to both
 * freehand strokes and tap-rings alike — never to a remote stroke. */
function renderedOpacity(stroke: Stroke, isLocal: boolean, remotePresence: boolean): number {
  return stroke.alpha * (isLocal && !remotePresence ? PRESENCE_UNAWARE_OPACITY_CAP : 1);
}

interface StrokeVisualProps {
  stroke: Stroke;
  contentRect: ContentRect;
  surfaceBox: { w: number; h: number };
  isLocal: boolean;
  remotePresence: boolean;
}

/**
 * Two `<AnimatedPath>`s with the same `d` — casing (CASING_COLOUR) behind,
 * `colourForParticipant()`'s core on top — mirroring
 * `packages/web/src/render.ts`'s `svgPath()` two-call pattern (DRAW-07).
 */
function StrokePath({ stroke, contentRect, surfaceBox, isLocal, remotePresence }: StrokeVisualProps) {
  const colour = colourForParticipant(stroke.from);
  const { coreWidth, casingWidth } = casingCoreWidths(contentRect, surfaceBox);
  const d = pathDataFor(stroke, contentRect);
  const opacity = renderedOpacity(stroke, isLocal, remotePresence);

  // Pattern 4: read fresh on every store.subscribe() notification — never a
  // second, independent withTiming-driven fade. The store's own tick(now) is
  // the sole source of truth for `alpha`.
  const casingAnimatedProps = useAnimatedProps(() => ({ opacity }));
  const coreAnimatedProps = useAnimatedProps(() => ({ opacity }));

  const testIdBase = `scribble-stroke-${stroke.from}-${stroke.id}`;
  return (
    <G testID={testIdBase}>
      <AnimatedPath
        testID={`${testIdBase}-casing`}
        d={d}
        stroke={CASING_COLOUR}
        strokeWidth={casingWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        animatedProps={casingAnimatedProps}
      />
      <AnimatedPath
        testID={`${testIdBase}-core`}
        d={d}
        stroke={colour}
        strokeWidth={coreWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        animatedProps={coreAnimatedProps}
      />
    </G>
  );
}

/**
 * Two `<AnimatedCircle>`s (casing behind, core on top — same width pair as
 * `StrokePath`, UI-SPEC Resolution 2A) at the tap's single point, `r`
 * animating 0->44dp (scaled by the content-rect fit ratio) over
 * TAP_RING_EXPAND_MS UNLESS `useReducedMotion()` is `true`, in which case `r`
 * is set directly to its final value with no animation (UI-SPEC Resolution
 * 2B) — the hold/fade that follows reads `stroke.alpha` exactly like a
 * normal stroke, unaffected either way.
 */
function TapRing({ stroke, contentRect, surfaceBox, isLocal, remotePresence }: StrokeVisualProps) {
  const colour = colourForParticipant(stroke.from);
  const { coreWidth, casingWidth } = casingCoreWidths(contentRect, surfaceBox);
  const [u, v] = stroke.points[0];
  const { x: cx, y: cy } = denormalize(u, v, contentRect);
  const fitRatio = Math.min(contentRect.w / surfaceBox.w, contentRect.h / surfaceBox.h);
  const targetRadius = TAP_RING_TARGET_RADIUS_DP * fitRatio;
  const opacity = renderedOpacity(stroke, isLocal, remotePresence);

  const reducedMotion = useReducedMotion();
  const radius = useSharedValue(reducedMotion ? targetRadius : 0);

  useEffect(() => {
    // Runs once per stroke's lifetime (this component mounts fresh per
    // stroke id, keyed by the caller) — UI-SPEC Resolution 2B: reduced
    // motion skips ONLY this expand animation, never the hold/fade.
    if (!reducedMotion) {
      radius.value = withTiming(targetRadius, { duration: TAP_RING_EXPAND_MS });
    }
    // Deliberately empty deps: this effect must run exactly once, at this
    // tap-ring instance's own mount (per-stroke, since a new stroke id
    // mounts a fresh TapRing) — not on every reducedMotion/targetRadius
    // identity change. This project's eslint config does not enable
    // react-hooks/exhaustive-deps (verified: not a defined rule here), so no
    // suppression comment is needed or valid.
  }, []);

  const casingAnimatedProps = useAnimatedProps(() => ({ r: radius.value, opacity }));
  const coreAnimatedProps = useAnimatedProps(() => ({ r: radius.value, opacity }));

  const testIdBase = `scribble-stroke-${stroke.from}-${stroke.id}`;
  return (
    <G testID={testIdBase}>
      <AnimatedCircle
        testID={`${testIdBase}-casing`}
        cx={cx}
        cy={cy}
        stroke={CASING_COLOUR}
        strokeWidth={casingWidth}
        fill="none"
        animatedProps={casingAnimatedProps}
      />
      <AnimatedCircle
        testID={`${testIdBase}-core`}
        cx={cx}
        cy={cy}
        stroke={colour}
        strokeWidth={coreWidth}
        fill="none"
        animatedProps={coreAnimatedProps}
      />
    </G>
  );
}

/**
 * Pattern 5's element-choice dispatch: a stroke whose `kind === 'tap'` swaps
 * to `TapRing`; every other stroke renders as `StrokePath`. A non-tap stroke
 * with zero points is skipped entirely (matching `render.ts`'s own `if
 * (stroke.points.length === 0) continue`) — a tap stroke with zero points
 * (never expected in practice; defensive only) is skipped identically, since
 * there is no point to centre the ring on.
 */
function StrokeVisual(props: StrokeVisualProps) {
  if (props.stroke.points.length === 0) return null;
  return props.stroke.kind === 'tap' ? <TapRing {...props} /> : <StrokePath {...props} />;
}

/**
 * DRAW-09's sibling-view root: an absolutely-filled `View` whose
 * `pointerEvents` reflects `drawModeEnabled`, containing an always-rendered
 * `Svg` (so remote strokes stay visible while local draw mode is off) and,
 * only when `drawModeEnabled` is `true`, a `GestureDetector`-wrapped sibling
 * hosting `gesture.ts`'s `pan` object — never a permanently-mounted
 * `GestureDetector` with a conditional `pointerEvents` flip (Pattern 6,
 * ARCHITECTURE.md anti-pattern #14, DRAW-04's own contract).
 */
export function ScribbleOverlay(props: ScribbleOverlayProps) {
  const { drawModeEnabled, receiveAnnotations, ...sessionOptions } = props;
  const session = useScribbleSession(sessionOptions);

  const [strokes, setStrokes] = useState<readonly Stroke[]>(() => session.getStrokesSnapshot());
  useEffect(() => {
    setStrokes(session.getStrokesSnapshot());
    return session.subscribeStrokes(setStrokes);
  }, [session.subscribeStrokes, session.getStrokesSnapshot]);

  // computeStrokeWidth needs the overlay's own raw surface box, not just the
  // fitted content rect — useContentRect (inside useScribbleSession) keeps
  // that measurement internal, so this component tracks its own copy from
  // the same onLayout event it must forward to session.onLayout anyway.
  const [surfaceBox, setSurfaceBox] = useState<{ w: number; h: number } | null>(null);
  const handleLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      const { width, height } = event.nativeEvent.layout;
      setSurfaceBox({ w: width, h: height });
      session.onLayout(event);
    },
    [session.onLayout],
  );

  // Local-authoring bridge: gesture.ts's three callbacks call these
  // (D-01/03/08's classification already happened inside gesture.ts's own
  // worklet) — this component's only job is generating a fresh per-gesture
  // stroke id and forwarding to useScribbleSession's bridge functions.
  const strokeCounterRef = useRef(0);
  const currentLocalIdRef = useRef<string | null>(null);

  const onLocalBegin = useCallback(
    (x: number, y: number): void => {
      const id = `local-${strokeCounterRef.current++}`;
      currentLocalIdRef.current = id;
      session.beginLocal(id);
      session.appendLocal(id, x, y);
    },
    [session.beginLocal, session.appendLocal],
  );

  const onLocalSample = useCallback(
    (x: number, y: number): void => {
      const id = currentLocalIdRef.current;
      if (id !== null) session.appendLocal(id, x, y);
    },
    [session.appendLocal],
  );

  const onLocalEnd = useCallback(
    (kind: 'tap' | 'stroke'): void => {
      const id = currentLocalIdRef.current;
      if (id !== null) session.endLocal(id, kind);
      currentLocalIdRef.current = null;
    },
    [session.endLocal],
  );

  const { pan } = useLocalStrokeGesture({ onLocalBegin, onLocalSample, onLocalEnd });

  const { contentRect, remotePresence } = session;

  return (
    <View
      testID="scribble-overlay-root"
      style={StyleSheet.absoluteFillObject}
      pointerEvents={drawModeEnabled ? 'auto' : 'none'}
      onLayout={handleLayout}
    >
      <Svg style={StyleSheet.absoluteFillObject} pointerEvents="none">
        {contentRect &&
          surfaceBox &&
          strokes.map((stroke) => {
            // T-05-06: colourForParticipant()'s output already discloses
            // nothing about stroke.from itself; nothing here re-derives or
            // logs it.
            const isLocal = stroke.from === LOCAL_SENDER;
            // AWARE-02 / UI-SPEC Resolution 4: a render-side filter only —
            // useScribbleSession keeps calling store.apply() on every
            // inbound frame regardless of receiveAnnotations.
            if (!isLocal && !receiveAnnotations) return null;
            return (
              <StrokeVisual
                key={`${stroke.from} ${stroke.id}`}
                stroke={stroke}
                contentRect={contentRect}
                surfaceBox={surfaceBox}
                isLocal={isLocal}
                remotePresence={remotePresence}
              />
            );
          })}
      </Svg>
      {drawModeEnabled && (
        <GestureDetector gesture={pan}>
          <View testID="scribble-gesture-catcher" style={StyleSheet.absoluteFillObject} />
        </GestureDetector>
      )}
    </View>
  );
}
