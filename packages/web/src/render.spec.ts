import { beforeEach, describe, expect, it } from 'vitest';

import { StrokeStore } from '@vilancer/protocol/core';

import { mountRenderer } from './render.js';

// jsdom ships no real ResizeObserver (04-RESEARCH.md Common Pitfalls) —
// mountRenderer now wires observeContentRectChanges (jitsiMeetWeb.ts) at
// mount time, so every render.spec.ts test needs the same stub.
class FakeResizeObserver {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: typeof FakeResizeObserver }).ResizeObserver = FakeResizeObserver;
  document.body.innerHTML = `<div id="largeVideoContainer"></div>`;
});

/** Builds a rect function returning a fixed ContentRect, and stubs
 * #largeVideoContainer's own getBoundingClientRect to a fixed surface box —
 * the exact two inputs computeStrokeWidth's fitRatio math depends on. */
function stubRectAndBox(rect: { w: number; h: number }, box: { w: number; h: number }): () => {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const host = document.getElementById('largeVideoContainer')!;
  host.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: box.w, bottom: box.h, width: box.w, height: box.h, toJSON() {} }) as DOMRect;
  return () => ({ x: 0, y: 0, w: rect.w, h: rect.h });
}

function seedOneStroke(store: StrokeStore): void {
  store.beginLocal('s1', { w: 1920, h: 1080 });
  store.appendLocal('s1', 0.5, 0.5);
}

describe('mountRenderer — casing-wider-than-core render policy at multiple scales (WEB-01, D-01)', () => {
  it('renders a smaller core stroke-width, and a proportionally-scaled casing/core gap, in a heavily letterboxed content rect than in a no-letterbox one', () => {
    // Case A: content rect fills the surface box exactly (fitRatio === 1).
    const storeA = new StrokeStore();
    seedOneStroke(storeA);
    const getRectA = stubRectAndBox({ w: 1280, h: 720 }, { w: 1280, h: 720 });
    const handleA = mountRenderer(storeA, getRectA);

    const svgA = document.querySelector('#largeVideoContainer svg')!;
    const pathsA = svgA.querySelectorAll('path');
    expect(pathsA.length).toBe(2);
    const casingA = pathsA[0];
    const coreA = pathsA[1];
    const coreWidthA = Number(coreA.getAttribute('stroke-width'));
    const casingWidthA = Number(casingA.getAttribute('stroke-width'));

    handleA.destroy();

    // Case B: content rect is ~0.31x the surface box (a portrait share
    // pillarboxed into a fixed recording box, per geometry/index.ts's own
    // computeStrokeWidth doc comment) — kept comfortably above
    // MIN_STROKE_WIDTH_PX's clamp floor so this test measures fitRatio
    // scaling, not clamping.
    document.body.innerHTML = `<div id="largeVideoContainer"></div>`;
    const storeB = new StrokeStore();
    seedOneStroke(storeB);
    const getRectB = stubRectAndBox({ w: 400, h: 225 }, { w: 1280, h: 720 });
    const handleB = mountRenderer(storeB, getRectB);

    const svgB = document.querySelector('#largeVideoContainer svg')!;
    const pathsB = svgB.querySelectorAll('path');
    expect(pathsB.length).toBe(2);
    const casingB = pathsB[0];
    const coreB = pathsB[1];
    const coreWidthB = Number(coreB.getAttribute('stroke-width'));
    const casingWidthB = Number(casingB.getAttribute('stroke-width'));

    handleB.destroy();

    // The scaled-down case's core width is strictly smaller.
    expect(coreWidthB).toBeLessThan(coreWidthA);
    // Casing stays proportionally wider than core at BOTH scales — the gap
    // shrinks along with fitRatio, it does not collapse to zero or stay a
    // fixed constant across scales.
    const gapA = casingWidthA - coreWidthA;
    const gapB = casingWidthB - coreWidthB;
    expect(gapA).toBeGreaterThan(0);
    expect(gapB).toBeGreaterThan(0);
    expect(gapB).toBeLessThan(gapA);
    // The gap shrinks by (approximately) the same fitRatio as the widths
    // themselves — 0.25x rect/box vs 1x — rather than becoming a fixed
    // constant.
    const fitRatioA = 720 / 720; // = 1
    const fitRatioB = 225 / 720; // = 0.3125
    expect(gapB / gapA).toBeCloseTo(fitRatioB / fitRatioA, 5);
  });
});
