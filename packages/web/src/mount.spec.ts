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

beforeEach(() => {
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
