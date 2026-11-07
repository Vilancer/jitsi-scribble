// <ScribbleOverlay>: the in-app ink layer. The host places it as an
// absolutely-positioned SIBLING of its video view (never a wrapper), sized to
// the same box, and tells it the video's frame size so strokes land on the
// video content even when it's letterboxed.
//
// Every stroke on screen is a projection of the session store's snapshot:
// remote ink as it arrives, local ink as the user draws. Local freehand ink
// renders from the gesture worklet's UI-thread path for latency; shapes are
// previewed while dragging and sent as one stroke on release.
//
// Inside a <ScribbleProvider> it uses the shared session, draw mode and the
// toolbar's tool state; standalone it needs `transport`/`conference` and
// `drawModeEnabled` props (the original Phase 5 API, still supported).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import {
  createAnimatedComponent,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Circle, G, Path, Svg } from 'react-native-svg';

import type { Stroke, StrokeStyle } from '@vilancer/scribble-protocol/core';
import { LOCAL_SENDER } from '@vilancer/scribble-protocol/core';
import type { ContentRect } from '@vilancer/scribble-protocol/geometry';
import { computeStrokeWidth, denormalize } from '@vilancer/scribble-protocol/geometry';
import {
  CASING_COLOUR,
  CASING_EXTRA_WIDTH_DP,
  CORE_WIDTH_DP,
  colourForParticipant,
  toolRecipe,
} from '@vilancer/scribble-protocol/render';
import { shapePoints, type Point2 } from '@vilancer/scribble-protocol/shapes';

import { useLocalStrokeGesture } from './gesture.js';
import { useOptionalScribble, type ToolState } from './ScribbleProvider.js';
import {
  useScribbleSession,
  type UseScribbleSessionOptions,
} from './useScribbleSession.js';

const AnimatedPath = createAnimatedComponent(Path);
const AnimatedCircle = createAnimatedComponent(Circle);

/** Opacity cap on the local drawer's own ink while the other side's
 * presence says nobody is looking (AWARE-01, UI-SPEC Resolution 1). */
export const PRESENCE_UNAWARE_OPACITY_CAP = 0.4;

const TAP_RING_TARGET_RADIUS_DP = 44;
/** Floor on the tap ring so a letterboxed share doesn't shrink it to an
 * unreadable dot (05-UAT re-test feedback). */
const TAP_RING_MIN_RADIUS_DP = 24;
const TAP_RING_EXPAND_MS = 250;

export interface ScribbleOverlayProps extends UseScribbleSessionOptions {
  /** `false` unmounts the touch catcher and sets pointerEvents 'none', so
   * touches reach the call UI beneath. Inside a provider, defaults to the
   * provider's draw mode. */
  drawModeEnabled?: boolean;
  /** `false` hides remote ink instantly (render-side filter only; the
   * session keeps applying frames). Default true. */
  receiveAnnotations?: boolean;
  /** Tool state override. Inside a provider, defaults to the toolbar's. */
  tools?: Partial<ToolState>;
}

interface Visual {
  color: string;
  coreWidth: number;
  casingWidth: number;
  casing: boolean;
  opacity: number;
  cap: 'round' | 'butt';
}

/** How a stroke looks: its author's style if it carried one, otherwise the
 * Phase 5 default (participant colour, 4dp pen). */
function visualFor(
  stroke: Stroke,
  contentRect: ContentRect,
  surfaceBox: { w: number; h: number },
): Visual {
  const style = stroke.style;
  const recipe = toolRecipe(style?.tool);
  const base = (style?.width ?? CORE_WIDTH_DP) * recipe.widthScale;
  return {
    color: style?.color ?? colourForParticipant(stroke.from),
    coreWidth: computeStrokeWidth(base, contentRect, surfaceBox),
    casingWidth: computeStrokeWidth(base + CASING_EXTRA_WIDTH_DP, contentRect, surfaceBox),
    casing: recipe.casing,
    opacity: recipe.opacity,
    cap: recipe.cap,
  };
}

function pathDataFor(points: readonly (readonly [number, number])[], rect: ContentRect): string {
  return points
    .map(([u, v], index) => {
      const { x, y } = denormalize(u, v, rect);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
}

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

/** The stroke being drawn right now: its path comes straight from the
 * gesture worklet's UI-thread string, not from the store, so ink stays
 * under the finger even when the JS thread is busy. */
function LocalActiveStrokePath({
  pathString,
  contentRect,
  surfaceBox,
  stroke,
  remotePresence,
}: {
  pathString: { value: string };
  contentRect: ContentRect;
  surfaceBox: { w: number; h: number };
  stroke: Stroke;
  remotePresence: boolean;
}) {
  const v = visualFor(stroke, contentRect, surfaceBox);
  const opacity = renderedOpacity(stroke, true, remotePresence) * v.opacity;
  const casingProps = useAnimatedProps(() => ({ d: pathString.value, opacity }));
  const coreProps = useAnimatedProps(() => ({ d: pathString.value, opacity }));
  const testIdBase = `scribble-stroke-${stroke.from}-${stroke.id}`;
  return (
    <G testID={testIdBase}>
      {v.casing && (
        <AnimatedPath
          testID={`${testIdBase}-casing`}
          stroke={CASING_COLOUR}
          strokeWidth={v.casingWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          animatedProps={casingProps}
        />
      )}
      <AnimatedPath
        testID={`${testIdBase}-core`}
        stroke={v.color}
        strokeWidth={v.coreWidth}
        strokeLinecap={v.cap}
        strokeLinejoin="round"
        fill="none"
        animatedProps={coreProps}
      />
    </G>
  );
}

function StrokePath({ stroke, contentRect, surfaceBox, isLocal, remotePresence }: StrokeVisualProps) {
  const v = visualFor(stroke, contentRect, surfaceBox);
  const d = pathDataFor(stroke.points, contentRect);
  const opacity = renderedOpacity(stroke, isLocal, remotePresence) * v.opacity;
  const casingProps = useAnimatedProps(() => ({ opacity }));
  const coreProps = useAnimatedProps(() => ({ opacity }));
  const testIdBase = `scribble-stroke-${stroke.from}-${stroke.id}`;
  return (
    <G testID={testIdBase}>
      {v.casing && (
        <AnimatedPath
          testID={`${testIdBase}-casing`}
          d={d}
          stroke={CASING_COLOUR}
          strokeWidth={v.casingWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          animatedProps={casingProps}
        />
      )}
      <AnimatedPath
        testID={`${testIdBase}-core`}
        d={d}
        stroke={v.color}
        strokeWidth={v.coreWidth}
        strokeLinecap={v.cap}
        strokeLinejoin="round"
        fill="none"
        animatedProps={coreProps}
      />
    </G>
  );
}

/** A tap: an expanding ring at the point (skipped to its final size under
 * Reduce Motion). */
function TapRing({ stroke, contentRect, surfaceBox, isLocal, remotePresence }: StrokeVisualProps) {
  const v = visualFor(stroke, contentRect, surfaceBox);
  const [u, w] = stroke.points[0];
  const { x: cx, y: cy } = denormalize(u, w, contentRect);
  const fitRatio = Math.min(contentRect.w / surfaceBox.w, contentRect.h / surfaceBox.h);
  const targetRadius = Math.max(TAP_RING_TARGET_RADIUS_DP * fitRatio, TAP_RING_MIN_RADIUS_DP);
  const opacity = renderedOpacity(stroke, isLocal, remotePresence);
  const reducedMotion = useReducedMotion();
  const radius = useSharedValue(reducedMotion ? targetRadius : 0);
  useEffect(() => {
    if (!reducedMotion) radius.value = withTiming(targetRadius, { duration: TAP_RING_EXPAND_MS });
    // Mount-only: the ring expands once, from 0 to the size it had then.
  }, []);
  const casingProps = useAnimatedProps(() => ({ r: radius.value, opacity }));
  const coreProps = useAnimatedProps(() => ({ r: radius.value, opacity }));
  const testIdBase = `scribble-stroke-${stroke.from}-${stroke.id}`;
  return (
    <G testID={testIdBase}>
      <AnimatedCircle
        testID={`${testIdBase}-casing`}
        cx={cx}
        cy={cy}
        stroke={CASING_COLOUR}
        strokeWidth={v.casingWidth}
        fill="none"
        animatedProps={casingProps}
      />
      <AnimatedCircle
        testID={`${testIdBase}-core`}
        cx={cx}
        cy={cy}
        stroke={v.color}
        strokeWidth={v.coreWidth}
        fill="none"
        animatedProps={coreProps}
      />
    </G>
  );
}

function StrokeVisual(props: StrokeVisualProps) {
  if (props.stroke.points.length === 0) return null;
  return props.stroke.kind === 'tap' ? <TapRing {...props} /> : <StrokePath {...props} />;
}

export function ScribbleOverlay(props: ScribbleOverlayProps) {
  const ctx = useOptionalScribble();
  const { drawModeEnabled, receiveAnnotations = true, tools: toolsProp, ...sessionOptions } = props;
  const standalone = sessionOptions.transport !== undefined || sessionOptions.conference !== undefined;
  const drawing = drawModeEnabled ?? ctx?.drawing ?? false;
  const tools: Partial<ToolState> = { ...(ctx?.tools ?? {}), ...toolsProp };
  const toolsRef = useRef(tools);
  toolsRef.current = tools;

  const session = useScribbleSession({
    ...sessionOptions,
    client: sessionOptions.client ?? (standalone || !ctx ? undefined : ctx.client),
  });

  const [strokes, setStrokes] = useState<readonly Stroke[]>(() => session.getStrokesSnapshot());
  useEffect(() => {
    setStrokes(session.getStrokesSnapshot());
    return session.subscribeStrokes(setStrokes);
  }, [session.subscribeStrokes, session.getStrokesSnapshot, session.localId]);

  // The overlay's own box, for computeStrokeWidth's letterbox scaling.
  const [surfaceBox, setSurfaceBox] = useState<{ w: number; h: number } | null>(null);
  const handleLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      const { width, height } = event.nativeEvent.layout;
      setSurfaceBox({ w: width, h: height });
      session.onLayout(event);
    },
    [session.onLayout],
  );

  const strokeCounterRef = useRef(0);
  const currentLocalIdRef = useRef<string | null>(null);
  const [activeLocalId, setActiveLocalId] = useState<string | null>(null);

  // Shape mode: remember the drag's start and current point, preview it,
  // and send the outline as one stroke on release.
  const shapeDragRef = useRef<{ shape: NonNullable<ToolState['shape']>; a: Point2; b: Point2 } | null>(null);
  const [shapePreview, setShapePreview] = useState<{ shape: NonNullable<ToolState['shape']>; a: Point2; b: Point2 } | null>(null);

  const currentStyle = (): StrokeStyle | undefined => {
    const t = toolsRef.current;
    if (!t.color && !t.tool && !t.width) return undefined;
    return { color: t.color ?? '#FF453A', width: t.width ?? CORE_WIDTH_DP, tool: t.tool ?? 'pen' };
  };

  const onLocalBegin = useCallback(
    (x: number, y: number): void => {
      const shape = toolsRef.current.shape;
      if (shape) {
        shapeDragRef.current = { shape, a: { x, y }, b: { x, y } };
        setShapePreview(shapeDragRef.current);
        return;
      }
      const id = `local-${strokeCounterRef.current++}`;
      currentLocalIdRef.current = id;
      setActiveLocalId(id);
      session.beginLocal(id, currentStyle());
      session.appendLocal(id, x, y);
    },
    [session.beginLocal, session.appendLocal],
  );

  const onLocalSample = useCallback(
    (x: number, y: number): void => {
      const drag = shapeDragRef.current;
      if (drag) {
        drag.b = { x, y };
        setShapePreview({ ...drag });
        return;
      }
      const id = currentLocalIdRef.current;
      if (id !== null) session.appendLocal(id, x, y);
    },
    [session.appendLocal],
  );

  const onLocalEnd = useCallback(
    (kind: 'tap' | 'stroke'): void => {
      const drag = shapeDragRef.current;
      if (drag) {
        shapeDragRef.current = null;
        setShapePreview(null);
        if (kind === 'stroke' && Math.hypot(drag.b.x - drag.a.x, drag.b.y - drag.a.y) >= 12) {
          const id = `local-${strokeCounterRef.current++}`;
          session.beginLocal(id, currentStyle());
          for (const p of shapePoints(drag.shape, drag.a, drag.b)) session.appendLocal(id, p.x, p.y);
          session.endLocal(id, 'stroke');
        }
        return;
      }
      const id = currentLocalIdRef.current;
      if (id !== null) session.endLocal(id, kind);
      currentLocalIdRef.current = null;
      setActiveLocalId(null);
    },
    [session.beginLocal, session.appendLocal, session.endLocal],
  );

  const { gesture, pathString } = useLocalStrokeGesture({ onLocalBegin, onLocalSample, onLocalEnd });
  const { contentRect, remotePresence } = session;

  return (
    <View
      testID="scribble-overlay-root"
      style={StyleSheet.absoluteFillObject}
      pointerEvents={drawing ? 'auto' : 'none'}
      onLayout={handleLayout}
    >
      <Svg style={StyleSheet.absoluteFillObject} pointerEvents="none">
        {contentRect &&
          surfaceBox &&
          strokes.map((stroke) => {
            const isLocal = stroke.from === LOCAL_SENDER;
            if (!isLocal && !receiveAnnotations) return null;
            if (isLocal && stroke.id === activeLocalId) {
              return (
                <LocalActiveStrokePath
                  key={`${stroke.from} ${stroke.id}`}
                  pathString={pathString}
                  contentRect={contentRect}
                  surfaceBox={surfaceBox}
                  stroke={stroke}
                  remotePresence={remotePresence}
                />
              );
            }
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
        {shapePreview && (
          <Path
            testID="scribble-shape-preview"
            d={shapePoints(shapePreview.shape, shapePreview.a, shapePreview.b)
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
              .join(' ')}
            stroke={tools.color ?? '#FF453A'}
            strokeWidth={(tools.width ?? CORE_WIDTH_DP) * toolRecipe(tools.tool).widthScale}
            strokeOpacity={toolRecipe(tools.tool).opacity}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        )}
      </Svg>
      {drawing && (
        <GestureDetector gesture={gesture}>
          <View testID="scribble-gesture-catcher" style={StyleSheet.absoluteFillObject} />
        </GestureDetector>
      )}
    </View>
  );
}
