import { describe, expect, it } from 'vitest';

import { ELLIPSE_SEGMENTS, shapePoints } from './index.js';

const a = { x: 100, y: 100 };
const b = { x: 300, y: 200 };

describe('shapePoints', () => {
  it('line is just its two ends', () => {
    expect(shapePoints('line', a, b)).toEqual([a, b]);
  });

  it('rect is a closed box on the drag diagonal', () => {
    const pts = shapePoints('rect', a, b);
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual(pts[4]);
    expect(pts.map((p) => p.x).sort()).toEqual([100, 100, 100, 300, 300]);
  });

  it('ellipse is closed, inside the box and touches all four sides', () => {
    const pts = shapePoints('ellipse', a, b);
    expect(pts).toHaveLength(ELLIPSE_SEGMENTS + 1);
    expect(pts[0].x).toBeCloseTo(pts[pts.length - 1].x);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(100);
    expect(Math.max(...xs)).toBeCloseTo(300);
    expect(Math.min(...ys)).toBeCloseTo(100, 0);
    expect(Math.max(...ys)).toBeCloseTo(200, 0);
  });

  it('arrow ends in a symmetric head at b', () => {
    const pts = shapePoints('arrow', { x: 0, y: 0 }, { x: 200, y: 0 });
    expect(pts).toHaveLength(5);
    expect(pts[1]).toEqual({ x: 200, y: 0 });
    expect(pts[3]).toEqual({ x: 200, y: 0 });
    // barbs point back toward a, one above and one below the shaft
    expect(pts[2].x).toBeLessThan(200);
    expect(pts[4].x).toBeLessThan(200);
    expect(pts[2].y).toBeCloseTo(-pts[4].y);
  });

  it('a zero-length arrow does not produce NaN', () => {
    const pts = shapePoints('arrow', a, a);
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});
