// Shape outlines as point lists. A shape is sent and stored as an ordinary
// stroke, so this is the only place shapes exist: the author's toolbar turns
// a drag into points here, and every receiver just draws a polyline.
//
// Works in the author's PIXEL space (not normalized u/v) so circles stay
// round and arrowheads keep their angle on any aspect ratio; the caller
// normalizes the result like any other touch point.
import type { ScribbleShape } from '../render/index.js';

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

/** Points on an ellipse outline (closed: first point repeated last). */
export const ELLIPSE_SEGMENTS = 36 as const;

/** Arrowhead barb angle from the shaft, in radians (~28 degrees). */
const ARROW_BARB_ANGLE = (28 * Math.PI) / 180;

/**
 * The outline of `shape` dragged from `a` to `b`. `rect` and `ellipse` use
 * the drag as the bounding box's diagonal; `line` and `arrow` run from `a`
 * to `b` (the arrowhead sits at `b`). Always returns at least two points and
 * at most ELLIPSE_SEGMENTS + 1, so one shape fits a couple of Move frames.
 */
export function shapePoints(shape: ScribbleShape, a: Point2, b: Point2): Point2[] {
  switch (shape) {
    case 'arrow': {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) return [a, b];
      const head = Math.min(Math.max(len * 0.25, 14), 44);
      const angle = Math.atan2(dy, dx);
      const barb = (sign: 1 | -1): Point2 => ({
        x: b.x - head * Math.cos(angle - sign * ARROW_BARB_ANGLE),
        y: b.y - head * Math.sin(angle - sign * ARROW_BARB_ANGLE),
      });
      return [a, b, barb(1), b, barb(-1)];
    }
    case 'rect':
      return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a];
    case 'ellipse': {
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const rx = Math.abs(b.x - a.x) / 2;
      const ry = Math.abs(b.y - a.y) / 2;
      const pts: Point2[] = [];
      for (let i = 0; i <= ELLIPSE_SEGMENTS; i++) {
        const t = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
        pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
      }
      return pts;
    }
    case 'line':
    default:
      return [a, b];
  }
}
