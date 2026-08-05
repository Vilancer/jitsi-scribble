// The web renderer's ScribbleTransport implementation over a real (or
// fake-for-tests) `lib-jitsi-meet` JitsiConference (PROTO-05..08). Per
// ARCHITECTURE.md section 4.2 and this phase's Assumption-Delta Note
// (04-01-PLAN.md), this adapter class is deliberately duplicated per
// renderer package (a future packages/react-native/src/transport/
// fromJitsiConference.ts in Phase 5) rather than living in `protocol`,
// because `protocol` must stay Jitsi-vocabulary-free (PKG-02).
//
// `conference: unknown` is deliberate — lib-jitsi-meet ships no consumable
// types for its GitHub-tarball distribution, so every method is probed via
// `typeof === 'function'`, never assumed.
//
// Event name correction (verified this session against lib-jitsi-meet
// v2154.0.0+a99a68d0's dist/esm/JitsiConferenceEvents.js, read directly from
// Genius_Native's node_modules): DATA_CHANNEL_OPENED/CLOSED are camelCase
// ('conference.dataChannelOpened' / 'conference.dataChannelClosed'), NOT the
// snake_case strings an earlier, less-precise research pass carried into
// 04-RESEARCH.md's Pattern 4 excerpt. Only ENDPOINT_MESSAGE_RECEIVED is
// snake_case ('conference.endpoint_message_received') and was already
// correct there.
import type { ScribbleTransport, TransportState } from '@vilancer/protocol/transport';

/** Real lib-jitsi-meet event-name defaults, overridable via `opts.events` —
 * `mount.ts` passes `window.JitsiMeetJS?.events?.conference` when available so
 * this adapter tracks the host's actual runtime event-name constants instead
 * of a hardcoded string that could drift across lib-jitsi-meet builds. */
const DEFAULT_EVENTS = {
  ENDPOINT_MESSAGE_RECEIVED: 'conference.endpoint_message_received',
  DATA_CHANNEL_OPENED: 'conference.dataChannelOpened',
  DATA_CHANNEL_CLOSED: 'conference.dataChannelClosed',
} as const;

export interface FromJitsiConferenceOptions {
  /** Host-supplied confirmation of whether P2P is disabled for this
   * conference (no public lib-jitsi-meet getter was found in an earlier
   * research pass — superseded below by preferring conference.isP2PEnabled()
   * when it exists, per this plan's own re-verification). Explicit `false`
   * suppresses the PROTO-08 warning outright. */
  p2pEnabled?: boolean;
  /** Overrides for the real lib-jitsi-meet event-name string constants —
   * pass `window.JitsiMeetJS?.events?.conference` so this adapter always
   * subscribes using the host's actual runtime constants. Falls back to
   * DEFAULT_EVENTS for any key not supplied. */
  events?: Partial<{
    ENDPOINT_MESSAGE_RECEIVED: string;
    DATA_CHANNEL_OPENED: string;
    DATA_CHANNEL_CLOSED: string;
  }>;
}

type SendCandidate = { name: string; call: (payload: unknown) => void };

/**
 * Probe-once-cache-the-winner (PROTO-05): tries sendMessage, then
 * broadcastEndpointMessage, then sendEndpointMessage, in that order. The
 * probe order IS the preference order — the first found is cached and used
 * for the adapter's entire lifetime, even if a later-checked method also
 * exists. Throws naming all three method names if none are found.
 *
 * Per D-02, the XMPP degraded-fallback send path
 * (`conference.sendMessage(payload, '', false)`) is NOT implemented here —
 * `degraded` state is drop-only (see send() below). This comment is the
 * documented future extension point D-02 calls for, not code.
 */
function resolveSend(conference: Record<string, unknown>): SendCandidate {
  const candidates: SendCandidate[] = [];
  if (typeof conference.sendMessage === 'function') {
    candidates.push({
      name: 'sendMessage',
      call: (p) => (conference.sendMessage as (m: unknown, to: string, viaBridge: boolean) => void)(p, '', true),
    });
  }
  if (typeof conference.broadcastEndpointMessage === 'function') {
    candidates.push({
      name: 'broadcastEndpointMessage',
      call: (p) => (conference.broadcastEndpointMessage as (m: unknown) => void)(p),
    });
  }
  if (typeof conference.sendEndpointMessage === 'function') {
    candidates.push({
      name: 'sendEndpointMessage',
      call: (p) => (conference.sendEndpointMessage as (to: string, m: unknown) => void)('', p),
    });
  }
  if (candidates.length === 0) {
    throw new Error(
      '[jitsi-scribble] no usable send method found on this conference object ' +
        '(checked: sendMessage, broadcastEndpointMessage, sendEndpointMessage)',
    );
  }
  return candidates[0];
}

/**
 * PROTO-08: warn once, at construction, unless P2P is confirmed disabled.
 * Prefers a real, public, non-deprecated conference.isP2PEnabled() getter
 * (verified this session against lib-jitsi-meet's JitsiConference.js — its
 * own semantics already match PROTO-08's "anything other than false"
 * wording: true if the config's p2p.enabled is truthy OR the p2p config
 * block is absent entirely) over the opts.p2pEnabled-only fallback an
 * earlier research pass recommended when no such getter had been found yet.
 */
function warnIfP2pNotConfirmedDisabled(conference: Record<string, unknown>, opts?: FromJitsiConferenceOptions): void {
  if (opts?.p2pEnabled === false) return;

  if (typeof conference.isP2PEnabled === 'function') {
    const enabled = (conference.isP2PEnabled as () => boolean)();
    if (enabled === false) return;
  }

  console.warn(
    '[jitsi-scribble] this conference does not confirm p2p.enabled: false — ' +
      'annotation may work for the first few seconds of a 1:1 call and then stop ' +
      'once the call switches to peer-to-peer (see PITFALLS.md Pitfall 10)',
  );
}

class JitsiTransportAdapter implements ScribbleTransport {
  private readonly conference: Record<string, unknown>;
  private readonly winner: SendCandidate;
  private _state: TransportState = 'connecting';
  private readonly subscribers = new Set<(from: string, payload: unknown) => void>();
  private readonly stateListeners = new Set<(s: TransportState) => void>();

  constructor(conference: Record<string, unknown>, winner: SendCandidate, opts?: FromJitsiConferenceOptions) {
    this.conference = conference;
    this.winner = winner;

    const events = { ...DEFAULT_EVENTS, ...opts?.events };
    const on = conference.on as ((event: string, cb: (...args: unknown[]) => void) => void) | undefined;

    if (typeof on === 'function') {
      on.call(conference, events.DATA_CHANNEL_OPENED, () => this.setState('ready'));
      on.call(conference, events.DATA_CHANNEL_CLOSED, () => this.setState('degraded'));
      on.call(conference, events.ENDPOINT_MESSAGE_RECEIVED, (...args: unknown[]) => {
        const [participant, payload] = args as [{ getId(): string } | undefined, unknown];
        const from = participant?.getId?.() ?? '';
        for (const fn of this.subscribers) fn(from, payload);
      });
    }
  }

  get state(): TransportState {
    return this._state;
  }

  private setState(state: TransportState): void {
    if (this._state === state) return;
    this._state = state;
    for (const listener of this.stateListeners) listener(state);
  }

  send(payload: unknown): void {
    if (this._state !== 'ready') return; // PROTO-07: never queue, drop instead
    try {
      this.winner.call(payload);
    } catch {
      // PROTO-06: send() never throws. A thrown send is itself evidence the
      // channel just closed — transition to degraded rather than rethrow.
      this.setState('degraded');
    }
  }

  subscribe(fn: (from: string, payload: unknown) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  localId(): string {
    const myUserId = this.conference.myUserId as (() => string | null) | undefined;
    return typeof myUserId === 'function' ? (myUserId.call(this.conference) ?? '') : '';
  }

  onStateChange(fn: (s: TransportState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }
}

/**
 * Builds a ScribbleTransport over a (real or fake) lib-jitsi-meet
 * JitsiConference. `conference: unknown` since no consumable types exist for
 * the pinned tarball build (PKG-02/03 — the library never imports
 * lib-jitsi-meet itself).
 */
export function fromJitsiConference(conference: unknown, opts?: FromJitsiConferenceOptions): ScribbleTransport {
  const c = conference as Record<string, unknown>;
  const winner = resolveSend(c);
  warnIfP2pNotConfirmedDisabled(c, opts);
  return new JitsiTransportAdapter(c, winner, opts);
}
