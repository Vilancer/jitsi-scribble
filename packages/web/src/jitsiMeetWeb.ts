// The web renderer's seam onto jitsi-meet's own page (ARCHITECTURE.md
// section 4.3): locating the real JitsiConference via window.APP.store, and
// reading #largeVideo's content rect without recomputing jitsi-meet's own
// letterbox math (Pattern 5 — "the content rect, read rather than
// computed").
import type { ContentRect } from '@vilancer/protocol/geometry';

/** Minimal shape of jitsi-meet's redux store this library depends on —
 * intentionally narrow, not the real jitsi-meet redux store's full type. */
export interface JitsiMeetStore {
  getState(): Record<string, unknown>;
  subscribe(fn: () => void): () => void;
}

interface WindowWithApp {
  APP?: { store?: JitsiMeetStore };
}

/**
 * Polls `window.APP.store` every 250ms, up to a 60s give-up, then invokes
 * `cb` exactly once with the real conference and store the moment
 * `features/base/conference`'s `conference` field is populated (WEB-01's
 * jitsiStore.getState()['features/base/conference'].conference locator,
 * called exactly once). Never throws — a give-up after 60s logs a single
 * [jitsi-scribble]-prefixed warning instead.
 */
export function whenConference(cb: (conference: unknown, store: JitsiMeetStore) => void): void {
  const t0 = Date.now();
  (function poll() {
    const w = window as unknown as WindowWithApp;
    const store = w.APP?.store;
    const conference = store
      ? (store.getState()['features/base/conference'] as { conference?: unknown } | undefined)?.conference
      : undefined;
    if (store && conference) {
      cb(conference, store);
      return;
    }
    if (Date.now() - t0 > 60_000) {
      console.warn('[jitsi-scribble] gave up waiting for window.APP.store');
      return;
    }
    setTimeout(poll, 250);
  })();
}

/**
 * `#largeVideo`'s content rect, relative to `#largeVideoContainer` — this IS
 * the content rect (Pattern 5); never recompute jitsi-meet's own
 * `computeDesktopVideoSize` letterbox math here. Returns null if either
 * element is absent — never throws.
 */
export function readContentRect(): ContentRect | null {
  const vid = document.getElementById('largeVideo');
  const host = document.getElementById('largeVideoContainer');
  if (!vid || !host) return null;
  const vr = vid.getBoundingClientRect();
  const hr = host.getBoundingClientRect();
  return { x: vr.left - hr.left, y: vr.top - hr.top, w: vr.width, h: vr.height };
}

/**
 * WEB-03's resize-reactive half of Pattern 5: jitsi jQuery-animates
 * `#largeVideoWrapper` over ~500ms on filmstrip toggles (ARCHITECTURE.md
 * section 4.3 Open Question 4), so a content rect read once at mount goes
 * stale the moment the filmstrip opens/closes or the window resizes. A
 * single `ResizeObserver` watches both `#largeVideo` and
 * `#largeVideoContainer` and invokes `onChange` once per observer batch
 * (native ResizeObserver batching already coalesces the two elements'
 * entries into one callback firing — this never fires `onChange` twice for
 * one physical resize). Never recomputes letterbox math itself — `onChange`
 * is expected to re-call `readContentRect()`, not receive geometry directly.
 * If neither element exists yet at call time, returns a callable no-op
 * unsubscribe rather than throwing (WEB-05's boundary contract).
 */
export function observeContentRectChanges(onChange: () => void): () => void {
  const vid = document.getElementById('largeVideo');
  const host = document.getElementById('largeVideoContainer');
  if (!vid || !host) return () => {};

  const observer = new ResizeObserver(() => onChange());
  observer.observe(vid);
  observer.observe(host);

  return () => observer.disconnect();
}
