// 05-REVIEW.md CR-03's own regression coverage: this DEDICATED spec file
// mocks `./gesture.js`'s `useLocalStrokeGesture` entirely (the real hook is
// unit-tested in full by gesture.spec.ts; ScribbleOverlay.spec.tsx's other
// tests need the REAL hook, so this concern is deliberately isolated into
// its own file rather than sharing jest.mock() scope with them) so it can
// assert something no other spec in this package can: that the
// actively-dragging local stroke's rendered `d` is SOURCED FROM
// gesture.ts's `pathString` SharedValue, never rebuilt from `stroke.points`
// via `pathDataFor` — by making the two deliberately DISAGREE and asserting
// which one wins. Asserting only that the final rendered `d` value is
// numerically correct (as every prior spec in this package does) cannot
// distinguish "read from pathString" from "read from stroke.points,
// which happens to be numerically identical for a purely local stroke with
// no letterboxing" — this file closes that gap.
import { act, fireEvent, render } from '@testing-library/react-native';
import type { LayoutChangeEvent } from 'react-native';

import type {
  ScribbleTransport,
  TransportState,
} from '@vilancer/protocol/transport';

import type {
  LocalStrokeGestureCallbacks,
  LocalStrokeGestureHandle,
} from './gesture.js';
import { ScribbleOverlay } from './ScribbleOverlay.js';

let capturedCallbacks: LocalStrokeGestureCallbacks | null = null;
const mockPathString: { value: string } = { value: '' };

// `drawModeEnabled={false}` throughout this file means `<GestureDetector
// gesture={gesture}>` is never actually mounted (ScribbleOverlay.tsx renders
// it conditionally), so `gesture`'s exact shape is irrelevant here — only
// `pathString` and the three callbacks matter for what this file asserts.
// `useLocalStrokeGesture` itself IS still called unconditionally by
// ScribbleOverlay (drawModeEnabled only gates the JSX, not the hook call),
// which is exactly why the callbacks below are reachable without ever
// touching a real gesture-handler recognizer.
jest.mock('./gesture.js', () => ({
  useLocalStrokeGesture: (
    callbacks: LocalStrokeGestureCallbacks,
  ): LocalStrokeGestureHandle => {
    capturedCallbacks = callbacks;
    return {
      gesture: {} as LocalStrokeGestureHandle['gesture'],
      pathString: mockPathString,
    };
  },
}));

function createTestTransport(localId: string): ScribbleTransport {
  return {
    state: 'ready' as TransportState,
    send(): void {},
    subscribe(): () => void {
      return () => {};
    },
    localId(): string {
      return localId;
    },
    onStateChange(): () => void {
      return () => {};
    },
  } as ScribbleTransport;
}

function layoutEvent(width: number, height: number): LayoutChangeEvent {
  return {
    nativeEvent: { layout: { x: 0, y: 0, width, height } },
  } as unknown as LayoutChangeEvent;
}

beforeEach(() => {
  capturedCallbacks = null;
  mockPathString.value = '';
});

describe("ScribbleOverlay — the actively-dragging local stroke's d is sourced from gesture.ts's pathString, never from stroke.points (05-REVIEW.md CR-03)", () => {
  it("renders pathString.value verbatim as the local stroke's d, even when it disagrees with what pathDataFor(stroke.points) would compute", async () => {
    const transport = createTestTransport('me');
    const { getByTestId } = await render(
      <ScribbleOverlay
        drawModeEnabled={false}
        receiveAnnotations={true}
        transport={transport}
        frameDims={{ w: 100, h: 100 }}
      />,
    );

    await act(async () => {
      fireEvent(
        getByTestId('scribble-overlay-root'),
        'layout',
        layoutEvent(100, 100),
      );
    });

    expect(capturedCallbacks).not.toBeNull();

    // Deliberately disagrees with the (x, y) samples about to be fed to the
    // JS-side bridge below. A real drag keeps these in lockstep (both
    // written by the SAME gesture.ts onUpdate call); a REGRESSION that
    // reverts to rendering via stroke.points/pathDataFor instead of
    // pathString would still pass a test that only checked the two agree.
    mockPathString.value = 'M 1 1 L 2 2 L 3 3';

    await act(async () => {
      capturedCallbacks!.onLocalBegin(10, 10);
      capturedCallbacks!.onLocalSample(60, 60);
    });

    const core = getByTestId('scribble-stroke-__local__-local-0-core');
    expect(core.props.d).toBe('M 1 1 L 2 2 L 3 3'); // pathString's sentinel — proves the UI-thread source is used
    // What pathDataFor(stroke, contentRect) would have produced from the
    // (10,10)->(60,60) samples actually recorded in the store, for contrast:
    expect(core.props.d).not.toBe('M 10 10 L 60 60');
  });

  it('falls back to the store-driven StrokePath (stroke.points, not pathString) the instant the drag ends', async () => {
    const transport = createTestTransport('me');
    const { getByTestId } = await render(
      <ScribbleOverlay
        drawModeEnabled={false}
        receiveAnnotations={true}
        transport={transport}
        frameDims={{ w: 100, h: 100 }}
      />,
    );

    await act(async () => {
      fireEvent(
        getByTestId('scribble-overlay-root'),
        'layout',
        layoutEvent(100, 100),
      );
    });

    mockPathString.value = 'M 1 1 L 2 2 L 3 3'; // still deliberately stale/disagreeing

    await act(async () => {
      capturedCallbacks!.onLocalBegin(10, 10);
      capturedCallbacks!.onLocalSample(60, 60);
      capturedCallbacks!.onLocalEnd('stroke');
    });

    const core = getByTestId('scribble-stroke-__local__-local-0-core');
    // Post-end, StrokeVisual/StrokePath's store-driven pathDataFor wins —
    // pathString's now-stale sentinel value must NOT still be showing.
    expect(core.props.d).not.toBe('M 1 1 L 2 2 L 3 3');
    expect(core.props.d).toBe('M 10 10 L 60 60');
  });
});
