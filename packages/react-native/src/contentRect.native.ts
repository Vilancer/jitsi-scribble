// The RN equivalent of packages/web/src/jitsiMeetWeb.ts's
// readContentRect/observeContentRectChanges CONTRACT (a ContentRect-or-null
// getter, reactive to a surface-box size change) — NOT its DOM measurement
// mechanics, which do not port. On RN, the surface box is measured via the
// overlay View's own `onLayout` event rather than `getBoundingClientRect()`.
//
// Every actual transform (contentRect/repairAspect) is imported from
// @vilancer/protocol/geometry, never re-derived here (RESEARCH.md Pitfall 7
// — Android/iOS report video dimensions differently, and Android drops
// rotation, which is exactly what repairAspect exists to patch, per GEO-04).
import { useMemo, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

import { contentRect, repairAspect, type ContentRect } from '@vilancer/protocol/geometry';
import type { FrameDims } from '@vilancer/protocol/core';

export interface UseContentRectResult {
  /** `null` until `frameDims` is known — never a zero-rect placeholder, so a
   * caller can distinguish "no video yet" from "video at the origin". */
  contentRect: ContentRect | null;
  /** Wire this onto the overlay View's own `onLayout` prop — this hook
   * cannot measure the surface box any other way. */
  onLayout: (event: LayoutChangeEvent) => void;
}

/**
 * `frameDims` is the SENDER's own reported frame dimensions (the video
 * track's display-oriented size, carried on the wire per PROTO-01/GEO-03 —
 * host-supplied, not measured by this hook) — `repairAspect`'s `sent`
 * argument. `Bw`/`Bh` (the surface box) come from this hook's own
 * `onLayout` measurement of the overlay View placed over that video, and
 * double as `repairAspect`'s `local` argument — on RN, the overlay's own
 * measured box IS the locally-observed aspect that Android's rotation-
 * reporting gap (GEO-04) can transpose relative to what the sender declared
 * (`onDimensionsChange` reports raw, unrotated dimensions, with no rotation
 * forwarded to JS). Until BOTH are known, returns `null` (never a zero-rect
 * placeholder).
 *
 * Feeding `repairAspect`'s corrected `{w, h}` into `contentRect(Fw, Fh, Bw,
 * Bh, 'contain')` as `Fw`/`Fh` is safe even though it substitutes the
 * surface box's own magnitude for the video's real resolution:
 * `contentRect`'s letterbox math depends only on the Fw:Fh ASPECT RATIO
 * (`sx = Bw/Fw`, `sy = Bh/Fh`), so when `local`'s aspect agrees with
 * `sent`'s, the result is numerically identical to calling `contentRect`
 * with `frameDims`'s own real magnitude directly — and when `repairAspect`
 * swaps (the rotation-transposition case), the corrected result reflects
 * the actual on-screen orientation rather than the sender's un-rotated one.
 */
export function useContentRect(frameDims: FrameDims | undefined): UseContentRectResult {
  const [surfaceBox, setSurfaceBox] = useState<{ w: number; h: number } | undefined>(undefined);

  const onLayout = useMemo(
    () =>
      (event: LayoutChangeEvent): void => {
        const { width, height } = event.nativeEvent.layout;
        setSurfaceBox({ w: width, h: height });
      },
    [],
  );

  // 05-REVIEW.md CR-01 (re-review): keyed on frameDims's PRIMITIVE w/h
  // values, not the object reference. A host passing an inline, unmemoized
  // `frameDims={{ w, h }}` object literal — the natural, undocumented way to
  // pass live video dimensions — produced a brand-new reference every render
  // even when the underlying numbers never changed, which churned this
  // memo's own identity and cascaded into useScribbleSession.ts's
  // `appendLocal` (keyed on `[contentRect]`), then ScribbleOverlay.tsx's
  // `onLocalBegin`/`onLocalSample`, then gesture.ts's memoized `Gesture.Pan()`
  // — reopening WR-02's `pan`-identity-churn bug via a second, independent
  // path. Depending on `frameDims?.w`/`frameDims?.h` directly means an
  // unstable `frameDims` reference with the same numbers no longer changes
  // this memo's result identity.
  const rect = useMemo((): ContentRect | null => {
    if (!frameDims || !surfaceBox) return null;
    const repaired = repairAspect(surfaceBox, frameDims);
    return contentRect(repaired.w, repaired.h, surfaceBox.w, surfaceBox.h, 'contain');
  }, [frameDims?.w, frameDims?.h, surfaceBox]);

  return { contentRect: rect, onLayout };
}
