// Orchestrates the real adapter + StrokeStore (unchanged from Phase 3) +
// SVG renderer into one `mountScribbleOverlay()` call (WEB-01/02/03).
import { StrokeStore } from '@vilancer/protocol/core';

import { fromJitsiConference } from './transport/fromJitsiConference.js';
import { mountRenderer } from './render.js';
import { readContentRect, type JitsiMeetStore } from './jitsiMeetWeb.js';

interface WindowWithJitsiMeetJS {
  JitsiMeetJS?: { events?: { conference?: unknown } };
}

/** The handle returned by `mountScribbleOverlay` — call `destroy()` to
 * cancel the rAF loop, unsubscribe from both the transport and the
 * jitsiStore, and remove the mounted SVG overlay. */
export interface ScribbleOverlayHandle {
  destroy(): void;
}

/**
 * Wires the real adapter's incoming messages into a fresh StrokeStore's
 * apply(), drives store.tick(now) off requestAnimationFrame, mounts the SVG
 * renderer over #largeVideo, and invalidates every stroke
 * (`store.clear('all')`) whenever `features/large-video`'s `participantId`
 * changes (a stage swap — ARCHITECTURE.md section 4.3's diagram — means
 * strokes positioned against content no longer shown must vanish, not
 * persist over the wrong tile). Returns a `destroy()` that cancels the rAF
 * loop and unsubscribes both the transport and the jitsiStore.
 */
export function mountScribbleOverlay(conference: unknown, jitsiStore: JitsiMeetStore): ScribbleOverlayHandle {
  const events = (window as unknown as WindowWithJitsiMeetJS).JitsiMeetJS?.events?.conference as
    | Partial<{ ENDPOINT_MESSAGE_RECEIVED: string; DATA_CHANNEL_OPENED: string; DATA_CHANNEL_CLOSED: string }>
    | undefined;

  const transport = fromJitsiConference(conference, { events });
  const store = new StrokeStore({ localId: transport.localId() });

  const unsubscribeTransport = transport.subscribe((from, payload) => store.apply(payload, from));

  let rafId: number | null = null;
  // WR-02 fix (04-REVIEW.md): store.tick() synchronously invokes every
  // store.subscribe/onOutbound listener. If a future subscriber calls
  // destroy() reentrantly from within that synchronous callback chain,
  // cancelAnimationFrame(rafId) below only cancels the currently-executing
  // frame — frame() would otherwise unconditionally reschedule itself
  // immediately afterward, leaving an uncancellable orphaned loop. The
  // `destroyed` flag makes the reschedule itself conditional so the loop
  // actually stops regardless of reentrancy ordering.
  let destroyed = false;
  function frame(): void {
    store.tick(Date.now());
    if (!destroyed) rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  const renderer = mountRenderer(store, readContentRect);

  let lastParticipantId: unknown = (
    jitsiStore.getState()['features/large-video'] as { participantId?: unknown } | undefined
  )?.participantId;
  const unsubscribeStore = jitsiStore.subscribe(() => {
    const nextParticipantId = (
      jitsiStore.getState()['features/large-video'] as { participantId?: unknown } | undefined
    )?.participantId;
    if (nextParticipantId !== lastParticipantId) {
      lastParticipantId = nextParticipantId;
      store.clear('all');
    }
  });

  return {
    destroy(): void {
      destroyed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      unsubscribeTransport();
      unsubscribeStore();
      renderer.destroy();
    },
  };
}
