import { describe, expect, it } from 'vitest';

import { contentRect, denormalize, mapTouchToContent, normalize, repairAspect } from './index.js';

// See .planning/research/ARCHITECTURE.md section 3.7 for the off-target vector
// this file's 'INTEG-04 regression matrix' block (added in Task 3) reproduces
// verbatim, and section 3.6 for the "never clamp" / "reject an out-of-bounds
// start" policies mapTouchToContent implements.

describe('contentRect', () => {
  it('fits the off-target vector sender tile (1920x1080 into 390x600, contain)', () => {
    expect(contentRect(1920, 1080, 390, 600, 'contain')).toEqual({
      x: 0,
      y: 190.3125,
      w: 390,
      h: 219.375,
    });
  });

  it('fits the off-target vector receiver tile (1920x1080 into 1024x768, contain)', () => {
    expect(contentRect(1920, 1080, 1024, 768, 'contain')).toEqual({
      x: 0,
      y: 96,
      w: 1024,
      h: 576,
    });
  });

  it('returns the zero rect when the frame width is zero', () => {
    expect(contentRect(0, 1080, 390, 600, 'contain')).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('returns the zero rect when the frame height is zero', () => {
    expect(contentRect(1920, 0, 390, 600, 'contain')).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('returns the zero rect when the frame width is negative', () => {
    expect(contentRect(-1, 1080, 390, 600, 'contain')).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('returns the zero rect when the frame width is NaN', () => {
    expect(contentRect(NaN, 1080, 390, 600, 'contain')).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('normalize/denormalize', () => {
  const senderTile = { x: 0, y: 190.3125, w: 390, h: 219.375 };
  const receiverTile = { x: 0, y: 96, w: 1024, h: 576 };

  it('normalizes the centre of the content rect to (0.5, 0.5)', () => {
    expect(normalize(195, 300, senderTile)).toEqual({ u: 0.5, v: 0.5 });
  });

  it('reproduces the 134.6px off-target bug fix end to end', () => {
    const { u, v } = normalize(195, 200, senderTile);
    expect(u).toBe(0.5);
    // Exact value is 9.6875/219.375 = 31/702 ≈ 0.0441596 (ARCHITECTURE.md's
    // "approximately 0.044170" rounds slightly loosely, but both agree once
    // denormalized to receiver pixels below).
    expect(v).toBeCloseTo(0.04416, 4);

    const receiverPoint = denormalize(u, v, receiverTile);
    expect(receiverPoint.x).toBeCloseTo(512, 5);
    // The prototype's wrong normalization (against the overlay, not the
    // content rect) would have produced y=256 here. Correct is ~121.4 — a
    // 134.6px / 17.5%-of-tile-height difference.
    expect(receiverPoint.y).toBeCloseTo(121.4, 1);
    expect(256 - receiverPoint.y).toBeCloseTo(134.6, 1);
  });
});

describe('mapTouchToContent', () => {
  const senderTile = { x: 0, y: 190.3125, w: 390, h: 219.375 };

  it('accepts a start touch inside the content rect', () => {
    expect(mapTouchToContent(195, 300, senderTile, { isStart: true })).toEqual({
      ok: true,
      point: { u: 0.5, v: 0.5 },
    });
  });

  it('rejects a start touch in the letterbox bar with a tagged out-of-bounds result, never clamped', () => {
    const result = mapTouchToContent(10, 10, senderTile, { isStart: true });
    expect(result).toEqual({ ok: false, reason: 'out-of-bounds' });
  });

  it('accepts the identical off-bar point as an unclamped move, not a start', () => {
    const result = mapTouchToContent(10, 10, senderTile, { isStart: false });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.point.u).toBeCloseTo(0.025641, 5);
      expect(result.point.v).toBeLessThan(0);
      expect(result.point.v).toBeCloseTo(-0.8222, 3);
    }
  });

  it('rejects any touch against a degenerate content rect with no-video-yet, regardless of coordinates', () => {
    const degenerate = { x: 0, y: 0, w: 0, h: 0 };
    expect(mapTouchToContent(9999, -9999, degenerate, { isStart: true })).toEqual({
      ok: false,
      reason: 'no-video-yet',
    });
  });
});

describe('repairAspect', () => {
  it('treats an exactly-equal local/sent aspect as agree and returns local unchanged', () => {
    expect(repairAspect({ w: 1920, h: 1080 }, { w: 1920, h: 1080 })).toEqual({ w: 1920, h: 1080 });
  });

  it('treats a near-equal aspect (within the 0.02 log-ratio tolerance) as agree and returns local unchanged', () => {
    expect(repairAspect({ w: 1920, h: 1080 }, { w: 1921, h: 1081 })).toEqual({ w: 1920, h: 1080 });
  });

  it('detects a rotation-transposed mismatch and swaps local.{w,h} to match the reciprocal of sent', () => {
    // Android's onDimensionsChange reports raw unrotated dims (1920x1080)
    // while the sender's display-oriented frame is portrait (1080x1920).
    expect(repairAspect({ w: 1920, h: 1080 }, { w: 1080, h: 1920 })).toEqual({ w: 1080, h: 1920 });
  });

  it('trusts the sender verbatim on a genuinely different, non-reciprocal aspect pair', () => {
    expect(repairAspect({ w: 100, h: 100 }, { w: 400, h: 300 })).toEqual({ w: 400, h: 300 });
  });
});
