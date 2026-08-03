import { describe, expect, it } from 'vitest';

import {
  computeStrokeWidth,
  contentRect,
  denormalize,
  mapTouchToContent,
  MIN_STROKE_WIDTH_PX,
  normalize,
  repairAspect,
} from './index.js';

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

describe('computeStrokeWidth', () => {
  it('scales a 4dp stroke down to ~1.038 for a portrait share pillarboxed into Jibri\'s 1280x720 box', () => {
    const C = contentRect(1080, 2340, 1280, 720, 'contain');
    expect(C.x).toBeCloseTo(473.846, 3);
    expect(C.y).toBe(0);
    expect(C.w).toBeCloseTo(332.308, 3);
    expect(C.h).toBe(720);
    expect(computeStrokeWidth(4, C, { w: 1280, h: 720 })).toBeCloseTo(1.038, 3);
  });

  it('leaves a 4dp stroke unchanged (fitRatio=1) when the content rect fills the surface box exactly', () => {
    const C = contentRect(1920, 1080, 1280, 720, 'contain');
    expect(C).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    expect(computeStrokeWidth(4, C, { w: 1280, h: 720 })).toBe(4);
  });

  it('floors at MIN_STROKE_WIDTH_PX against a degenerate content rect, never 0 or NaN', () => {
    expect(computeStrokeWidth(4, { x: 0, y: 0, w: 0, h: 0 }, { w: 1280, h: 720 })).toBe(
      MIN_STROKE_WIDTH_PX,
    );
    expect(MIN_STROKE_WIDTH_PX).toBe(1);
  });
});

describe('INTEG-04 regression matrix', () => {
  it('the 134.6px off-target vector, end to end (mapTouchToContent composed with denormalize)', () => {
    const senderTile = contentRect(1920, 1080, 390, 600, 'contain');
    const receiverTile = contentRect(1920, 1080, 1024, 768, 'contain');

    const result = mapTouchToContent(195, 200, senderTile, { isStart: true });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');

    const receiverPoint = denormalize(result.point.u, result.point.v, receiverTile);
    const prototypeWrongY = 200 / 600 /* the prototype's overlay-relative normalization */ * 768;
    expect(prototypeWrongY).toBe(256);
    expect(receiverPoint.y).toBeCloseTo(121.4, 1);
    expect(prototypeWrongY - receiverPoint.y).toBeCloseTo(134.6, 1);
  });

  it('portrait-in-landscape: source 1080x1920 into box 800x450', () => {
    expect(contentRect(1080, 1920, 800, 450, 'contain')).toEqual({
      x: 273.4375,
      y: 0,
      w: 253.125,
      h: 450,
    });
  });

  it('landscape-in-portrait: source 1920x1080 into box 400x800', () => {
    expect(contentRect(1920, 1080, 400, 800, 'contain')).toEqual({
      x: 0,
      y: 287.5,
      w: 400,
      h: 225,
    });
  });

  it('equal-aspect: source 1920x1080 into box 800x450 fills the box exactly', () => {
    expect(contentRect(1920, 1080, 800, 450, 'contain')).toEqual({
      x: 0,
      y: 0,
      w: 800,
      h: 450,
    });
  });

  it('the four degenerate contentRect() inputs (zero/negative/NaN Fw or Fh)', () => {
    expect(contentRect(0, 1080, 390, 600, 'contain')).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(contentRect(1920, 0, 390, 600, 'contain')).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(contentRect(-1, 1080, 390, 600, 'contain')).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(contentRect(NaN, 1080, 390, 600, 'contain')).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
