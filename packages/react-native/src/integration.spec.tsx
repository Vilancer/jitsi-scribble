// The phase's own capstone proof (05-04-PLAN.md Task 3): a real
// createMemoryTransportPair (from @vilancer/protocol/transport, unchanged
// since Phase 3) wired to a real "drawer" session and a real, MOUNTED
// "viewer" <ScribbleOverlay> — no real device, no real lib-jitsi-meet, no
// host app. This is the last consumer in the phase's own dependency chain
// (gesture.ts -> useScribbleSession -> store.subscribe() -> denormalize())
// actually rendering something; every prior plan's work is unverified at
// the composed level until this test passes.
//
// The drawer side drives useScribbleSession's own local-authoring bridge
// functions directly (beginLocal/appendLocal/endLocal) rather than mounting
// a full gesture-handler tree on that side — Task 3's own documented
// discretion, since the classification these calls skip (gesture.ts's
// classifyGesture) is already independently unit-tested by
// gesture.spec.ts, and endLocal's own `kind` parameter lets this test
// choose the drag vs. tap outcome directly and deterministically.
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import type { LayoutChangeEvent } from 'react-native';
import { processColor } from 'react-native';

import { colourForParticipant } from '@vilancer/protocol/render';
import { createMemoryTransportPair } from '@vilancer/protocol/transport';

import { ScribbleOverlay } from './ScribbleOverlay.js';
import { useScribbleSession } from './useScribbleSession.js';

function layoutEvent(width: number, height: number): LayoutChangeEvent {
  return { nativeEvent: { layout: { x: 0, y: 0, width, height } } } as unknown as LayoutChangeEvent;
}

/** react-native-svg's native `stroke` prop is colour-processed by RN's own
 * native-component prop pipeline before it reaches a rendered TestInstance
 * — under this RN/react-native-svg version pairing that arrives as a tagged
 * `{ type, payload }` object, not the raw hex string this file passes in.
 * Comparing the RAW string colourForParticipant() itself returns (never a
 * hardcoded hex re-derived in this test) against whichever representation
 * `core.props.stroke` actually holds this call the same colour-processing
 * RN itself applies (`processColor`), on both sides. */
function colourPayload(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && 'payload' in value) {
    return (value as { payload: unknown }).payload;
  }
  return processColor(value as never);
}

describe('End-to-end MemoryTransport integration (phase capstone)', () => {
  it('a two-point drag on the drawer renders as a StrokePath, in colourForParticipant("drawer"), on the viewer', async () => {
    const [drawerTransport, viewerTransport] = createMemoryTransportPair('drawer', 'viewer');
    const frameDims = { w: 100, h: 100 };

    const { result: drawer } = await renderHook(() => useScribbleSession({ transport: drawerTransport, frameDims }));

    const onRemoteStrokeStart = jest.fn();
    const onRemoteTap = jest.fn();
    const { getByTestId } = await render(
      <ScribbleOverlay
        drawModeEnabled={false}
        receiveAnnotations={true}
        transport={viewerTransport}
        frameDims={frameDims}
        onRemoteStrokeStart={onRemoteStrokeStart}
        onRemoteTap={onRemoteTap}
      />,
    );

    await act(async () => {
      fireEvent(getByTestId('scribble-overlay-root'), 'layout', layoutEvent(100, 100));
    });

    await act(async () => {
      drawer.current.onLayout(layoutEvent(100, 100));
    });

    await act(async () => {
      drawer.current.beginLocal('stroke-1');
      drawer.current.appendLocal('stroke-1', 10, 10);
      drawer.current.appendLocal('stroke-1', 60, 60);
      drawer.current.endLocal('stroke-1', 'stroke');
    });

    // D-04: onRemoteStrokeStart fires optimistically at Start; onRemoteTap
    // never fires for a plain drag.
    expect(onRemoteStrokeStart).toHaveBeenCalledTimes(1);
    expect(onRemoteStrokeStart).toHaveBeenCalledWith('drawer');
    expect(onRemoteTap).not.toHaveBeenCalled();

    const core = getByTestId('scribble-stroke-drawer-stroke-1-core');
    // Not a hardcoded hex string re-derived in the test — the same function
    // ScribbleOverlay itself calls, compared via colourPayload() since
    // react-native-svg's own colour-prop processing (see helper above)
    // means the rendered prop is no longer a plain hex string.
    expect(colourPayload(core.props.stroke)).toEqual(colourPayload(colourForParticipant('drawer')));
    // 10,10 -> 60,60 crossed the wire through quantize/dequantize
    // (12-bit ints, GEO/PROTO's documented lossy-but-bounded round-trip) —
    // assert the rendered path's endpoints are close, not bit-exact.
    const [, mx, my, lx, ly] = (core.props.d as string).match(/M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)/) ?? [];
    expect(Number(mx)).toBeCloseTo(10, 0);
    expect(Number(my)).toBeCloseTo(10, 0);
    expect(Number(lx)).toBeCloseTo(60, 0);
    expect(Number(ly)).toBeCloseTo(60, 0);

    const casing = getByTestId('scribble-stroke-drawer-stroke-1-casing');
    expect(colourPayload(casing.props.stroke)).toEqual(colourPayload('rgba(0, 0, 0, 0.55)'));
  });

  it('a tap-shaped gesture renders a tap-ring (kind === "tap") on the viewer, and fires onRemoteTap additionally', async () => {
    const [drawerTransport, viewerTransport] = createMemoryTransportPair('drawer', 'viewer');
    const frameDims = { w: 100, h: 100 };

    const { result: drawer } = await renderHook(() => useScribbleSession({ transport: drawerTransport, frameDims }));

    const onRemoteStrokeStart = jest.fn();
    const onRemoteTap = jest.fn();
    const { getByTestId } = await render(
      <ScribbleOverlay
        drawModeEnabled={false}
        receiveAnnotations={true}
        transport={viewerTransport}
        frameDims={frameDims}
        onRemoteStrokeStart={onRemoteStrokeStart}
        onRemoteTap={onRemoteTap}
      />,
    );

    await act(async () => {
      fireEvent(getByTestId('scribble-overlay-root'), 'layout', layoutEvent(100, 100));
    });

    await act(async () => {
      drawer.current.onLayout(layoutEvent(100, 100));
    });

    await act(async () => {
      // Near-zero movement, single point — the tap-shaped gesture case.
      drawer.current.beginLocal('tap-1');
      drawer.current.appendLocal('tap-1', 20, 20);
      drawer.current.endLocal('tap-1', 'tap');
    });

    // D-04: onRemoteStrokeStart still fires once at Start; onRemoteTap fires
    // additionally, once, for the tap case.
    expect(onRemoteStrokeStart).toHaveBeenCalledTimes(1);
    expect(onRemoteStrokeStart).toHaveBeenCalledWith('drawer');
    expect(onRemoteTap).toHaveBeenCalledTimes(1);
    expect(onRemoteTap).toHaveBeenCalledWith('drawer');

    // A tap renders as a Circle (cx/cy props), never a Path (d prop) — the
    // TapRing branch of StrokeVisual's dispatch, not StrokePath.
    const core = getByTestId('scribble-stroke-drawer-tap-1-core');
    // Also crossed the wire's quantize/dequantize round-trip.
    expect(core.props.cx).toBeCloseTo(20, 0);
    expect(core.props.cy).toBeCloseTo(20, 0);
    expect(core.props.d).toBeUndefined();
    expect(colourPayload(core.props.stroke)).toEqual(colourPayload(colourForParticipant('drawer')));
  });
});
