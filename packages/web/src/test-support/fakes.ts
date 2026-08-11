// Test-only fixtures — a configurable fake JitsiConference and a fake
// `window.APP` shape, so this package's tests never need a live
// lib-jitsi-meet instance or a real jitsi-meet page.
import type { JitsiMeetStore } from '../jitsiMeetWeb.js';

export type FakeConferenceMethod = 'sendMessage' | 'broadcastEndpointMessage' | 'sendEndpointMessage';

/** One recorded underlying send call — which method actually fired, and with
 * what payload. Distinguishing the method (not just the payload) is what
 * lets 04-02's probe-order tests assert *which* candidate won, not merely
 * that *a* send happened (PROTO-05). */
export interface FakeSentCall {
  method: FakeConferenceMethod;
  payload: unknown;
  /** Every positional argument the underlying method was invoked with —
   * PROTO-10's tests assert sendMessage's third argument (viaBridge) is
   * strictly `true`, never the XMPP-fallback `false`. */
  args: unknown[];
}

export interface FakeJitsiConference {
  conference: Record<string, unknown>;
  /** Fires every listener registered via conference.on(event, ...) for the
   * given event, with the given args — the test-code hook for simulating
   * conference.dataChannelOpened / conference.dataChannelClosed /
   * conference.endpoint_message_received. */
  emit(event: string, ...args: unknown[]): void;
  /** Every underlying send call that actually completed (i.e. did not throw),
   * paired with the method name that fired it. */
  sentPayloads: FakeSentCall[];
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
  /** When true, the very first call to whichever send method wins throws
   * once (simulating a transient underlying failure, e.g. a just-closed
   * data channel); every call after that first one succeeds normally and is
   * recorded in `sentPayloads`. Lets 04-02's Task 2 exercise PROTO-06/07's
   * throw-absorption and degraded-then-re-latch paths without
   * special-casing fromJitsiConference.ts's production code. */
  throwOnSend?: boolean;
}): FakeJitsiConference {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const sentPayloads: FakeSentCall[] = [];
  const methods = new Set(opts?.methods ?? []);
  let throwOnNextSend = opts?.throwOnSend ?? false;

  function recordOrThrow(method: FakeConferenceMethod, payload: unknown, args: unknown[]): void {
    if (throwOnNextSend) {
      throwOnNextSend = false;
      throw new Error(`[fakes] simulated ${method} failure`);
    }
    sentPayloads.push({ method, payload, args });
  }

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
    conference.sendMessage = (payload: unknown, to: string, viaBridge: boolean): void => {
      recordOrThrow('sendMessage', payload, [payload, to, viaBridge]);
    };
  }
  if (methods.has('broadcastEndpointMessage')) {
    conference.broadcastEndpointMessage = (payload: unknown): void => {
      recordOrThrow('broadcastEndpointMessage', payload, [payload]);
    };
  }
  if (methods.has('sendEndpointMessage')) {
    conference.sendEndpointMessage = (to: string, payload: unknown): void => {
      recordOrThrow('sendEndpointMessage', payload, [to, payload]);
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
