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
