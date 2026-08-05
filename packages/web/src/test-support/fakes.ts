// Test-only fixtures — a configurable fake JitsiConference and a fake
// `window.APP` shape, so this package's tests never need a live
// lib-jitsi-meet instance or a real jitsi-meet page.
import type { JitsiMeetStore } from '../jitsiMeetWeb.js';

export type FakeConferenceMethod = 'sendMessage' | 'broadcastEndpointMessage' | 'sendEndpointMessage';

export interface FakeJitsiConference {
  conference: Record<string, unknown>;
  /** Fires every listener registered via conference.on(event, ...) for the
   * given event, with the given args — the test-code hook for simulating
   * conference.dataChannelOpened / conference.dataChannelClosed /
   * conference.endpoint_message_received. */
  emit(event: string, ...args: unknown[]): void;
  /** Every payload passed to whichever send method was actually called. */
  sentPayloads: unknown[];
}

/**
 * A fake `conference` object exposing only the requested send methods (an
 * empty/omitted `methods` list simulates a conference with none of the
 * three usable send methods, for PROTO-05's construction-throw test), an
 * `.on()`/`.off()` registry, and `isP2PEnabled()` present only when
 * `opts.p2pEnabled` is not `undefined` (so PROTO-08's warning-suppression
 * path can be tested independently of the fallback-absent path).
 */
export function createFakeJitsiConference(opts?: {
  methods?: FakeConferenceMethod[];
  p2pEnabled?: boolean;
  myUserId?: string;
}): FakeJitsiConference {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const sentPayloads: unknown[] = [];
  const methods = new Set(opts?.methods ?? []);

  const conference: Record<string, unknown> = {
    on(event: string, cb: (...args: unknown[]) => void): void {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(cb);
    },
    off(event: string, cb: (...args: unknown[]) => void): void {
      listeners.get(event)?.delete(cb);
    },
    myUserId(): string | null {
      return opts?.myUserId ?? null;
    },
  };

  if (methods.has('sendMessage')) {
    conference.sendMessage = (payload: unknown, _to: string, _viaBridge: boolean): void => {
      sentPayloads.push(payload);
    };
  }
  if (methods.has('broadcastEndpointMessage')) {
    conference.broadcastEndpointMessage = (payload: unknown): void => {
      sentPayloads.push(payload);
    };
  }
  if (methods.has('sendEndpointMessage')) {
    conference.sendEndpointMessage = (_to: string, payload: unknown): void => {
      sentPayloads.push(payload);
    };
  }

  if (opts?.p2pEnabled !== undefined) {
    conference.isP2PEnabled = (): boolean => opts.p2pEnabled as boolean;
  }

  function emit(event: string, ...args: unknown[]): void {
    for (const cb of listeners.get(event) ?? new Set()) cb(...args);
  }

  return { conference, emit, sentPayloads };
}

export interface FakeWindowApp {
  win: { APP: { store: JitsiMeetStore } };
  store: JitsiMeetStore;
  setStageParticipant(id: string | undefined): void;
}

/**
 * A fake `window.APP.store` whose `getState()` returns
 * `{ 'features/base/conference': { conference }, 'features/large-video': { participantId, width, height } }`
 * — `store.subscribe(fn)` fires `fn` whenever `setStageParticipant` changes
 * the stage participant id, simulating jitsi-meet's own redux store for
 * `mount.ts`'s stage-swap invalidation wiring.
 */
export function buildFakeWindowApp(conference: unknown): FakeWindowApp {
  let participantId: string | undefined;
  const subscribers = new Set<() => void>();

  const store: JitsiMeetStore = {
    getState(): Record<string, unknown> {
      return {
        'features/base/conference': { conference },
        'features/large-video': { participantId, width: 1280, height: 720 },
      };
    },
    subscribe(fn: () => void): () => void {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };

  function setStageParticipant(id: string | undefined): void {
    participantId = id;
    for (const fn of subscribers) fn();
  }

  return { win: { APP: { store } }, store, setStageParticipant };
}
