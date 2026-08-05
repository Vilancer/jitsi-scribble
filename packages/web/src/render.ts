// The SVG paint layer (WEB-01/02/03, D-01) — a pure consumer of
// StrokeStore.subscribe()/snapshot(), never reimplementing stroke-state
// logic itself. Mounts as a SIBLING of #largeVideo inside
// #largeVideoContainer (ARCHITECTURE.md anti-pattern #10) — never wraps,
// restyles, or re-parents the video element it reads geometry from.
import type { ContentRect } from '@vilancer/protocol/geometry';
import { computeStrokeWidth, denormalize } from '@vilancer/protocol/geometry';
import type { Stroke, StrokeStore } from '@vilancer/protocol/core';
import { CASING_COLOUR, CASING_EXTRA_WIDTH_DP, CORE_WIDTH_DP, colourForParticipant } from '@vilancer/protocol/render';

import { observeContentRectChanges } from './jitsiMeetWeb.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const HOST_ID = 'largeVideoContainer';

function pathDataFor(stroke: Stroke, contentRect: ContentRect): string {
  const commands = stroke.points.map(([u, v], index) => {
    const { x, y } = denormalize(u, v, contentRect);
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  });
  return commands.join(' ');
}

/**
 * Builds a single SVG `<path>` element via `document.createElementNS` +
 * `.setAttribute` — never `innerHTML`/template-string HTML (T-04-01-01:
 * `stroke.from`/`stroke.id` are attacker-influenced strings).
 */
function svgPath(d: string, widthPx: number, colour: string, alpha: number): SVGPathElement {
  const el = document.createElementNS(SVG_NS, 'path');
  el.setAttribute('d', d);
  el.setAttribute('stroke', colour);
  el.setAttribute('stroke-width', String(widthPx));
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('fill', 'none');
  el.style.opacity = String(alpha);
  return el;
}

/**
 * Mounts an `<svg>` overlay as a sibling of `#largeVideo` inside
 * `#largeVideoContainer`, subscribes to `store`, and repaints two `<path>`
 * elements per live stroke (casing behind, core on top — D-01/Pattern 6) on
 * every store change. Returns a `destroy()` that unsubscribes and removes
 * the `<svg>`. Silently mounts nothing (returns a no-op destroy) if
 * `#largeVideoContainer` is absent — never throws (WEB-05's boundary
 * contract extends to this file too).
 */
export function mountRenderer(store: StrokeStore, getRect: () => ContentRect | null): { destroy(): void } {
  const host = document.getElementById(HOST_ID);
  if (!host) {
    return { destroy() {} };
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('style', 'position:absolute;inset:0;pointer-events:none;z-index:1;');
  host.appendChild(svg);

  function repaint(strokes: readonly Stroke[]): void {
    svg.replaceChildren();
    const contentRect = getRect();
    if (!contentRect) return;
    const box = { w: host!.getBoundingClientRect().width, h: host!.getBoundingClientRect().height };

    for (const stroke of strokes) {
      if (stroke.points.length === 0) continue;
      const d = pathDataFor(stroke, contentRect);
      const coreWidth = computeStrokeWidth(CORE_WIDTH_DP, contentRect, box);
      const casingWidth = computeStrokeWidth(CORE_WIDTH_DP + CASING_EXTRA_WIDTH_DP, contentRect, box);

      const casing = svgPath(d, casingWidth, CASING_COLOUR, stroke.alpha);
      const core = svgPath(d, coreWidth, colourForParticipant(stroke.from), stroke.alpha);
      svg.appendChild(casing);
      svg.appendChild(core);
    }
  }

  const unsubscribe = store.subscribe(repaint);
  repaint(store.snapshot());

  // WEB-03: re-read the content rect and repaint whenever #largeVideo /
  // #largeVideoContainer resize (filmstrip toggle, window resize) instead of
  // only once at mount — see jitsiMeetWeb.ts's observeContentRectChanges.
  const unobserveContentRect = observeContentRectChanges(() => repaint(store.snapshot()));

  return {
    destroy(): void {
      unsubscribe();
      unobserveContentRect();
      svg.remove();
    },
  };
}
