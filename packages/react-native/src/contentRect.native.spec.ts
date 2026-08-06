import { act, renderHook } from '@testing-library/react-native';
import type { LayoutChangeEvent } from 'react-native';

import { contentRect } from '@vilancer/protocol/geometry';

import { useContentRect } from './contentRect.native.js';

function layoutEvent(width: number, height: number): LayoutChangeEvent {
  return {
    nativeEvent: { layout: { x: 0, y: 0, width, height } },
  } as unknown as LayoutChangeEvent;
}

describe('useContentRect (GEO-03/GEO-04)', () => {
  it('returns null with no frameDims supplied at all', async () => {
    const { result } = await renderHook(() => useContentRect(undefined));
    expect(result.current.contentRect).toBeNull();
  });

  it('returns null before onLayout has ever fired, even with frameDims known', async () => {
    const { result } = await renderHook(() => useContentRect({ w: 1920, h: 1080 }));
    expect(result.current.contentRect).toBeNull();
  });

  it("with frameDims matching the overlay-measured aspect ratio, the rect equals contentRect()'s own direct output", async () => {
    const surfaceBox = { w: 1600, h: 900 }; // 16:9
    const frameDims = { w: 1920, h: 1080 }; // also 16:9 — aspects agree exactly
    const expected = contentRect(frameDims.w, frameDims.h, surfaceBox.w, surfaceBox.h, 'contain');

    const { result } = await renderHook(() => useContentRect(frameDims));
    await act(() => {
      result.current.onLayout(layoutEvent(surfaceBox.w, surfaceBox.h));
    });

    expect(result.current.contentRect).toEqual(expected);
  });

  it("with frameDims whose aspect is the reciprocal of the measured one, the rect reflects repairAspect's swap", async () => {
    const surfaceBox = { w: 1600, h: 900 }; // 16:9
    const frameDims = { w: 900, h: 1600 }; // 9:16 — reciprocal aspect (rotation transposition)
    // What a naive implementation would produce if it skipped repairAspect
    // entirely and fed the overlay's own (unswapped, aspect-transposed)
    // measured box straight into contentRect() as Fw/Fh — exactly the bug
    // GEO-04/repairAspect exists to prevent. Since Fw:Fh would then equal
    // Bw:Bh exactly, this naive call trivially fills the whole box.
    const naive = contentRect(surfaceBox.w, surfaceBox.h, surfaceBox.w, surfaceBox.h, 'contain');
    // What repairAspect's reciprocal branch actually produces: local (the
    // measured box) swapped to {w: local.h, h: local.w} before contentRect()
    // ever sees it.
    const repaired = contentRect(surfaceBox.h, surfaceBox.w, surfaceBox.w, surfaceBox.h, 'contain');

    const { result } = await renderHook(() => useContentRect(frameDims));
    await act(() => {
      result.current.onLayout(layoutEvent(surfaceBox.w, surfaceBox.h));
    });

    expect(result.current.contentRect).not.toEqual(naive);
    expect(result.current.contentRect).toEqual(repaired);
  });
});

describe('useContentRect — repeated onLayout calls with identical width/height do NOT churn contentRect identity (05-REVIEW.md CR-01, round 3)', () => {
  it('calling onLayout twice with the same width/height returns the SAME contentRect object reference on the second call', async () => {
    const frameDims = { w: 1920, h: 1080 };
    const surfaceBox = { w: 1600, h: 900 };

    const { result } = await renderHook(() => useContentRect(frameDims));

    await act(() => {
      result.current.onLayout(layoutEvent(surfaceBox.w, surfaceBox.h));
    });
    const contentRectAfterFirstLayout = result.current.contentRect;
    expect(contentRectAfterFirstLayout).not.toBeNull();

    // RN is well known to refire onLayout with IDENTICAL width/height (an
    // initial mount pass followed by a second measurement pass,
    // safe-area/keyboard recalculation, an ancestor re-layout, an
    // orientation-change-and-back that settles back to the same absolute
    // box). Each such refire calls `setSurfaceBox({ w, h })` with a
    // brand-new object carrying the SAME numbers as before.
    await act(() => {
      result.current.onLayout(layoutEvent(surfaceBox.w, surfaceBox.h));
    });

    // Pre-fix, the `rect` memo was keyed on `surfaceBox` BY REFERENCE, so
    // this second, value-identical onLayout call produced a brand-new
    // ContentRect object even though nothing had actually changed —
    // cascading into useScribbleSession.ts's `appendLocal` and, from there,
    // into ScribbleOverlay.tsx's `onLocalBegin`/`onLocalSample` and
    // gesture.ts's memoized `Gesture.Pan()`.
    expect(result.current.contentRect).toBe(contentRectAfterFirstLayout);
  });

  it('calling onLayout with genuinely different width/height still produces a new contentRect (the legitimate case the fix above must not break)', async () => {
    const frameDims = { w: 1920, h: 1080 };

    const { result } = await renderHook(() => useContentRect(frameDims));

    await act(() => {
      result.current.onLayout(layoutEvent(1600, 900));
    });
    const contentRectBefore = result.current.contentRect;
    expect(contentRectBefore).not.toBeNull();

    await act(() => {
      result.current.onLayout(layoutEvent(800, 450)); // a real resize
    });

    expect(result.current.contentRect).not.toBe(contentRectBefore);
  });
});
