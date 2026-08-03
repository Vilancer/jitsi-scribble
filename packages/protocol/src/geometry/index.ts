// The coordinate transform — the correctness core of this project and the
// exact place the throwaway prototype (test-jitsi-scribble/rn-lib/ScribbleOverlay.tsx)
// is provably wrong: it normalizes touches against the overlay's own onLayout
// size, not the actual video content rect, which is silently wrong the moment
// a share is letterboxed. See .planning/research/ARCHITECTURE.md section 3 for
// the full derivation and .planning/research/PITFALLS.md Pitfall 7 for the
// Android rotation gap `repairAspect` exists to patch.
//
// Pure functions, zero platform dependency — runs under plain node, no
// device/browser/Jitsi conference required to test.

export type Fit = 'contain' | 'cover';

export interface ContentRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where a source frame (Fw, Fh), display-oriented, actually appears inside a
 * surface box (Bw, Bh) under the given fit mode. Returns the zero rect for
 * any non-positive-finite input (degenerate-input guard, T-02-02-01) rather
 * than propagating NaN/Infinity into normalize/denormalize.
 */
export function contentRect(Fw: number, Fh: number, Bw: number, Bh: number, fit: Fit): ContentRect {
  if (!(Fw > 0 && Fh > 0 && Bw > 0 && Bh > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const sx = Bw / Fw;
  const sy = Bh / Fh;
  const s = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const w = Fw * s;
  const h = Fh * s;
  return { x: (Bw - w) / 2, y: (Bh - h) / 2, w, h };
}

/** Maps a surface-box pixel to a point normalized against the content rect. */
export const normalize = (x: number, y: number, C: ContentRect): { u: number; v: number } => ({
  u: (x - C.x) / C.w,
  v: (y - C.y) / C.h,
});

/** Inverse of normalize — maps a normalized point back to surface-box pixels. */
export const denormalize = (u: number, v: number, C: ContentRect): { x: number; y: number } => ({
  x: C.x + u * C.w,
  y: C.y + v * C.h,
});

/**
 * The D-02 tagged rejection contract: distinguishes an expected letterbox
 * miss ('out-of-bounds') from a video-not-loaded-yet degenerate case
 * ('no-video-yet'), rather than a flat null/boolean.
 */
export type TransformResult =
  | { ok: true; point: { u: number; v: number } }
  | { ok: false; reason: 'out-of-bounds' | 'no-video-yet' };

/**
 * Maps a touch to the content rect. Per ARCHITECTURE.md section 3.6:
 * - never clamps (u, v) — a rejected point is dropped entirely, not
 *   coerced to an edge value;
 * - only rejects a stroke *start* that lands outside [0,1]^2 (a mis-tap on
 *   a letterbox bar); an in-flight move may legitimately carry an
 *   unclamped, out-of-range point.
 */
export function mapTouchToContent(
  x: number,
  y: number,
  C: ContentRect,
  opts: { isStart: boolean },
): TransformResult {
  if (C.w <= 0 || C.h <= 0) return { ok: false, reason: 'no-video-yet' };
  const { u, v } = normalize(x, y, C);
  if (opts.isStart && (u < 0 || u > 1 || v < 0 || v > 1)) {
    return { ok: false, reason: 'out-of-bounds' };
  }
  return { ok: true, point: { u, v } };
}
