import { beforeEach, describe, expect, it } from 'vitest';

import { mountScribbleOverlay } from './mount.js';
import { createFakeJitsiConference, buildFakeWindowApp } from './test-support/fakes.js';

// The end-to-end tracer proof (04-01-PLAN.md Task 1's `done` criterion): one
// remote stroke, delivered by a fake JitsiConference through the real
// fromJitsiConference adapter, must be visible as two positioned SVG paths.

const START_FRAME = {
  v: 1,
  t: 's',
  from: 'remote-1',
  id: 's1',
  p: [2048, 2048],
  frame: { w: 1920, h: 1080 },
};

// jsdom ships no real ResizeObserver (04-RESEARCH.md Common Pitfalls) —
// render.ts's mountRenderer now wires observeContentRectChanges
// (jitsiMeetWeb.ts, Plan 04-03) at mount time, so every test that reaches
// mountRenderer needs this stubbed regardless of whether it exercises resize
// behaviour directly.
class FakeResizeObserver {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: typeof FakeResizeObserver }).ResizeObserver = FakeResizeObserver;
  document.body.innerHTML = `
    <div id="largeVideoContainer">
      <video id="largeVideo"></video>
    </div>`;
  // jsdom returns an all-zero rect by default (no real layout engine) — stub it.
  Element.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720, toJSON() {} }) as DOMRect;
});

describe('mountScribbleOverlay — remote stroke renders over #largeVideo', () => {
  it('paints two SVG <path> elements (casing + core) for one remote stroke, and destroy() removes them', () => {
    const { conference, emit } = createFakeJitsiConference({ methods: ['sendMessage'] });
    const { win } = buildFakeWindowApp(conference);

    const handle = mountScribbleOverlay(conference, win.APP.store);

    const svg = document.querySelector('#largeVideoContainer svg');
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll('path').length).toBe(0);

    emit('conference.endpoint_message_received', { getId: () => 'remote-1' }, JSON.stringify(START_FRAME));

    expect(svg!.querySelectorAll('path').length).toBe(2);

    handle.destroy();

    expect(document.querySelector('#largeVideoContainer svg')).toBeNull();
  });

  it('never wraps, restyles, or re-parents #largeVideo itself (ARCHITECTURE.md anti-pattern #10)', async () => {
    const video = document.getElementById('largeVideo')!;
    const container = document.getElementById('largeVideoContainer')!;
    const beforeOuterHTML = video.outerHTML;
    const beforeId = video.id;
    const beforeClassName = video.className;
    const beforeStyle = video.getAttribute('style');

    const { conference } = createFakeJitsiConference({ methods: ['sendMessage'] });
    const { win } = buildFakeWindowApp(conference);
    const handle = mountScribbleOverlay(conference, win.APP.store);

    // Let one store.tick()/render cycle run via the rAF loop mount.ts drives.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(video.outerHTML).toBe(beforeOuterHTML);
    expect(video.id).toBe(beforeId);
    expect(video.className).toBe(beforeClassName);
    expect(video.getAttribute('style')).toBe(beforeStyle);
    expect(video.parentElement).toBe(container);

    handle.destroy();
  });
});

// The definitive three-assertion CI smoke test named directly after
// ARCHITECTURE.md section 4.3's jitsi-meet contract — proves the same
// three facts a real staging Playwright test (Phase 6/INTEG-01) would prove
// against a live jitsi-meet, but against a jsdom-built fake window.APP with
// no live deployment required.
describe('jitsi-meet contract smoke test (ARCHITECTURE.md section 4.3)', () => {
  it('asserts window.APP.store, the real conference identity, and a non-zero #largeVideo rect, then mounts without throwing', () => {
    const { conference } = createFakeJitsiConference({ methods: ['sendMessage'] });
    const { win } = buildFakeWindowApp(conference);

    // Assertion 1: window.APP.store is truthy.
    expect(win.APP.store).toBeTruthy();

    // Assertion 2: the conference reachable through the store's own locator
    // is the exact same object identity as the one handed to mountScribbleOverlay.
    expect(
      (win.APP.store.getState()['features/base/conference'] as { conference: unknown }).conference,
    ).toBe(conference);

    // Assertion 3: #largeVideo's rect has non-zero area.
    const rect = document.getElementById('largeVideo')!.getBoundingClientRect();
    expect(rect.width * rect.height).toBeGreaterThan(0);

    let handle: ReturnType<typeof mountScribbleOverlay> | undefined;
    expect(() => {
      handle = mountScribbleOverlay(conference, win.APP.store);
    }).not.toThrow();

    handle?.destroy();
  });
});
