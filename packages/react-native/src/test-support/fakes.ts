// Test-only fixture — a configurable fake JitsiConference, so this
// package's tests never need a live lib-jitsi-meet instance. Duplicated from
// packages/web/src/test-support/fakes.ts's createFakeJitsiConference
// (RESEARCH.md Pattern 9 — a parallel test suite, not a shared one,
// matching fromJitsiConference.ts's own parallel-implementation decision).
// `buildFakeWindowApp` is deliberately OMITTED — RN has no `window.APP`
// concept.

export type FakeConferenceMethod = 'sendMessage' | 'broadcastEndpointMessage' | 'sendEndpointMessage';

/** One recorded underlying send call — which method actually fired, and with
 * what payload. Distinguishing the method (not just the payload) is what
 * lets probe-order tests assert *which* candidate won, not merely that *a*
 * send happened (PROTO-05). */
export interface FakeSentCall {
  method: FakeConferenceMethod;
  payload: unknown;
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
   * recorded in `sentPayloads`. */
  throwOnSend?: boolean;
}): FakeJitsiConference {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const sentPayloads: FakeSentCall[] = [];
  const methods = new Set(opts?.methods ?? []);
  let throwOnNextSend = opts?.throwOnSend ?? false;

  function recordOrThrow(method: FakeConferenceMethod, payload: unknown): void {
    if (throwOnNextSend) {
      throwOnNextSend = false;
      throw new Error(`[fakes] simulated ${method} failure`);
    }
    sentPayloads.push({ method, payload });
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
    conference.sendMessage = (payload: unknown, _to: string, _viaBridge: boolean): void => {
      recordOrThrow('sendMessage', payload);
    };
  }
  if (methods.has('broadcastEndpointMessage')) {
    conference.broadcastEndpointMessage = (payload: unknown): void => {
      recordOrThrow('broadcastEndpointMessage', payload);
    };
  }
  if (methods.has('sendEndpointMessage')) {
    conference.sendEndpointMessage = (_to: string, payload: unknown): void => {
      recordOrThrow('sendEndpointMessage', payload);
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
