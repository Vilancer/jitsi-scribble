import { act, fireEvent, render } from '@testing-library/react-native';
import type { LayoutChangeEvent } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { encode } from '@vilancer/protocol/codec';
import { MSG_START, PROTOCOL_VERSION } from '@vilancer/protocol/core';
import type { ScribbleTransport, TransportState } from '@vilancer/protocol/transport';

import { ScribbleOverlay } from './ScribbleOverlay.js';

/** Same hand-built-object mocking seam useScribbleSession.spec.ts already
 * establishes — bypasses fromJitsiConference's own construction entirely. */
function createTestTransport(localId: string): ScribbleTransport & { deliver: (from: string, payload: unknown) => void } {
  const subscribers = new Set<(from: string, payload: unknown) => void>();
  return {
    state: 'ready' as TransportState,
    send(): void {},
    subscribe(fn: (from: string, payload: unknown) => void): () => void {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    localId(): string {
      return localId;
    },
    onStateChange(): () => void {
      return () => {};
    },
    deliver(from: string, payload: unknown): void {
      for (const fn of subscribers) fn(from, payload);
    },
  } as ScribbleTransport & { deliver: (from: string, payload: unknown) => void };
}

/** This RNTL version's `TestInstance` only represents HOST elements
 * (View/Svg/...), not composite components like `GestureDetector` — there is
 * no `UNSAFE_getByType` in this package's API (verified: absent from
 * `render.d.ts`'s return type). `unstable_fiber` exposes the real React
 * Fiber tree underneath, which DOES retain composite-component nodes via its
 * own `.return` parent-chain — walking it up from a host descendant is the
 * supported way to reach an ancestor composite component's own props. */
interface FiberLike {
  type: unknown;
  return: FiberLike | null;
  memoizedProps: Record<string, unknown>;
}

function findAncestorFiber(fiber: FiberLike | null, componentType: unknown): FiberLike | null {
  let current = fiber;
  while (current) {
    if (current.type === componentType) return current;
    current = current.return;
  }
  return null;
}

/** gesture-handler's own gesture objects store configuration/handlers on
 * internal, untyped bags — the same seam gesture.spec.ts already documents
 * and exercises directly. */
interface GestureInternals {
  config: { maxPointers?: number };
}

describe('ScribbleOverlay — draw-mode pointerEvents and gesture-mount (DRAW-04/09)', () => {
  it('pointerEvents reads "none" and no gesture-catching element is mounted when drawModeEnabled is false', async () => {
    const transport = createTestTransport('me');
    const { getByTestId, queryByTestId } = await render(
      <ScribbleOverlay drawModeEnabled={false} receiveAnnotations={true} transport={transport} />,
    );

    expect(getByTestId('scribble-overlay-root').props.pointerEvents).toBe('none');
    expect(queryByTestId('scribble-gesture-catcher')).toBeNull();
  });

  it('pointerEvents reads "auto" and a GestureDetector configured with maxPointers(1) is mounted when drawModeEnabled is true', async () => {
    const transport = createTestTransport('me');
    const { getByTestId } = await render(
      <ScribbleOverlay drawModeEnabled={true} receiveAnnotations={true} transport={transport} />,
    );

    expect(getByTestId('scribble-overlay-root').props.pointerEvents).toBe('auto');

    const gestureCatcher = getByTestId('scribble-gesture-catcher');
    const detectorFiber = findAncestorFiber(gestureCatcher.unstable_fiber as unknown as FiberLike, GestureDetector);
    expect(detectorFiber).not.toBeNull();
    // DRAW-05, restated here for this component's own coverage since this is
    // the actual mount point real code exercises.
    const pan = detectorFiber?.memoizedProps.gesture as unknown as GestureInternals;
    expect(pan.config.maxPointers).toBe(1);
  });
});

describe('ScribbleOverlay — receiveAnnotations render-side filter (AWARE-02/UI-SPEC Resolution 4)', () => {
  function layoutEvent(width: number, height: number): LayoutChangeEvent {
    return { nativeEvent: { layout: { x: 0, y: 0, width, height } } } as unknown as LayoutChangeEvent;
  }

  function deliverRemoteStart(transport: ScribbleTransport & { deliver: (from: string, payload: unknown) => void }): void {
    const payload = encode({
      v: PROTOCOL_VERSION,
      t: MSG_START,
      from: 'bob',
      id: 'stroke-1',
      p: [0, 0],
      frame: { w: 100, h: 100 },
    });
    transport.deliver('bob', payload);
  }

  it('a remote stroke renders when receiveAnnotations is true', async () => {
    const transport = createTestTransport('me');
    const { getByTestId, queryAllByTestId } = await render(
      <ScribbleOverlay drawModeEnabled={false} receiveAnnotations={true} transport={transport} frameDims={{ w: 100, h: 100 }} />,
    );

    await act(async () => {
      fireEvent(getByTestId('scribble-overlay-root'), 'layout', layoutEvent(100, 100));
      deliverRemoteStart(transport);
    });

    expect(queryAllByTestId(/^scribble-stroke-bob-/)).not.toHaveLength(0);
  });

  it('the same remote stroke does not render at all when receiveAnnotations is false', async () => {
    const transport = createTestTransport('me');
    const { getByTestId, queryAllByTestId } = await render(
      <ScribbleOverlay drawModeEnabled={false} receiveAnnotations={false} transport={transport} frameDims={{ w: 100, h: 100 }} />,
    );

    await act(async () => {
      fireEvent(getByTestId('scribble-overlay-root'), 'layout', layoutEvent(100, 100));
      deliverRemoteStart(transport);
    });

    expect(queryAllByTestId(/^scribble-stroke-bob-/)).toHaveLength(0);
  });
});

describe('ScribbleOverlay — the WHOLE memoization chain stays stable under simultaneous, value-equal-but-not-referentially-equal churn (05-REVIEW.md CR-01 rounds 2/3 + WR-02, closing the recurring pan-churn bug class end to end)', () => {
  function layoutEvent(width: number, height: number): LayoutChangeEvent {
    return { nativeEvent: { layout: { x: 0, y: 0, width, height } } } as unknown as LayoutChangeEvent;
  }

  function currentPanIdentity(
    getByTestId: (id: string) => { unstable_fiber: unknown },
  ): unknown {
    const gestureCatcher = getByTestId('scribble-gesture-catcher');
    const detectorFiber = findAncestorFiber(
      gestureCatcher.unstable_fiber as unknown as FiberLike,
      GestureDetector,
    );
    return detectorFiber?.memoizedProps.gesture;
  }

  it('re-rendering with fresh transportOptions/frameDims object literals AND repeated onLayout refires carrying identical width/height never changes the mounted Gesture.Pan() identity', async () => {
    const transport = createTestTransport('me');

    const { getByTestId, rerender } = await render(
      <ScribbleOverlay
        drawModeEnabled={true}
        receiveAnnotations={true}
        transport={transport}
        frameDims={{ w: 100, h: 100 }}
        transportOptions={{}}
      />,
    );

    await act(async () => {
      fireEvent(
        getByTestId('scribble-overlay-root'),
        'layout',
        layoutEvent(100, 100),
      );
    });

    const firstPan = currentPanIdentity(getByTestId);
    expect(firstPan).toBeDefined();

    // Three successive re-renders, each supplying a BRAND-NEW object
    // literal for `transportOptions` AND `frameDims` (exactly what an
    // unmemoized host re-render produces — the natural, idiomatic JSX
    // form) AND re-firing `onLayout` with the SAME width/height (exactly
    // what RN's own well-documented redundant-refire behavior produces) —
    // simultaneously churning every non-primitive value this review series
    // found feeding, directly or transitively, into gesture.ts's `pan`
    // useMemo dependency chain (`transportOptions` -> round 1;
    // `frameDims`/`surfaceBox` -> rounds 2/3). This is the single test that
    // would have caught all three rounds' bugs at once.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        rerender(
          <ScribbleOverlay
            drawModeEnabled={true}
            receiveAnnotations={true}
            transport={transport}
            frameDims={{ w: 100, h: 100 }}
            transportOptions={{}}
          />,
        );
        fireEvent(
          getByTestId('scribble-overlay-root'),
          'layout',
          layoutEvent(100, 100),
        );
      });

      expect(currentPanIdentity(getByTestId)).toBe(firstPan);
    }
  });
});
