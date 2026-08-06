// Kept in sync MANUALLY with packages/web/src/transport/fromJitsiConference.ts
// — any future lib-jitsi-meet API change (a new/renamed send method, a
// renamed event constant) must be applied to BOTH copies. This RN copy is a
// deliberate, byte-for-byte-portable duplication, not a shared abstraction,
// per RESEARCH.md Pattern 9: the probe/state-machine logic itself has zero
// DOM dependency, but `protocol` must stay Jitsi-vocabulary-free (PKG-02),
// so no better shared home exists this phase.
//
// The RN renderer's ScribbleTransport implementation over a real (or
// fake-for-tests) `lib-jitsi-meet` JitsiConference (PROTO-05..08). Per
// ARCHITECTURE.md section 4.2 and Phase 4's Assumption-Delta Note
// (04-01-PLAN.md), this adapter class is deliberately duplicated per
// renderer package rather than living in `protocol`.
//
// `conference: unknown` is deliberate — lib-jitsi-meet ships no consumable
// types for its GitHub-tarball distribution, so every method is probed via
// `typeof === 'function'`, never assumed.
//
// Event name correction (verified against lib-jitsi-meet v2154.0.0+a99a68d0's
// dist/esm/JitsiConferenceEvents.js, read directly from Genius_Native's
// node_modules): DATA_CHANNEL_OPENED/CLOSED are camelCase
// ('conference.dataChannelOpened' / 'conference.dataChannelClosed'), NOT
// snake_case. Only ENDPOINT_MESSAGE_RECEIVED is snake_case
// ('conference.endpoint_message_received').
import type { ScribbleTransport, TransportState } from '@vilancer/protocol/transport';

/** Real lib-jitsi-meet event-name defaults, overridable via `opts.events`.
 * On web, `mount.ts` passes `window.JitsiMeetJS?.events?.conference` when
 * available so the adapter tracks the host's actual runtime event-name
 * constants instead of a hardcoded string. RN has no `window` global at
 * all — `opts.events` is therefore either omitted entirely (falling back to
 * DEFAULT_EVENTS below) or supplied by the host app from whatever
 * lib-jitsi-meet re-export its own code already has in scope. This file
 * deliberately adds no window-shaped fallback of any kind. */
const DEFAULT_EVENTS = {
  ENDPOINT_MESSAGE_RECEIVED: 'conference.endpoint_message_received',
  DATA_CHANNEL_OPENED: 'conference.dataChannelOpened',
  DATA_CHANNEL_CLOSED: 'conference.dataChannelClosed',
} as const;

export interface FromJitsiConferenceOptions {
  /** Host-supplied confirmation of whether P2P is disabled for this
   * conference. Explicit `false` suppresses the PROTO-08 warning outright. */
  p2pEnabled?: boolean;
  /** Overrides for the real lib-jitsi-meet event-name string constants —
   * on RN, the host app supplies these from whatever lib-jitsi-meet
   * re-export it already has in scope (no `window` global exists to read
   * them from automatically). Falls back to DEFAULT_EVENTS for any key not
   * supplied. */
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
 * An explicit host-supplied `opts.p2pEnabled` (true or false) is the
 * stronger signal and short-circuits entirely — the host set it
 * deliberately, so it is never second-guessed by a conference getter. Only
 * when `opts.p2pEnabled` is left `undefined` does this fall back to the
 * real, public, non-deprecated conference.isP2PEnabled() getter (its own
 * semantics already match PROTO-08's "anything other than false" wording:
 * true if the config's p2p.enabled is truthy OR the p2p config block is
 * absent entirely).
 */
function warnIfP2pNotConfirmedDisabled(conference: Record<string, unknown>, opts?: FromJitsiConferenceOptions): void {
  if (opts?.p2pEnabled === false) return;

  if (opts?.p2pEnabled === undefined && typeof conference.isP2PEnabled === 'function') {
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
  // CR-01 fix (04-REVIEW.md, ported here for parity with the web adapter):
  // default optimistically to 'ready' rather than 'connecting'.
  // lib-jitsi-meet's DATA_CHANNEL_OPENED is a one-shot event with no
  // replay-to-late-subscribers semantics and no public getter to query
  // current channel state, so if the channel opened before this adapter's
  // constructor ran, a 'connecting' default would leave send() permanently
  // dropping every message with zero diagnostic. Guessing 'ready' and being
  // wrong is already covered by the existing degrade path below
  // (DATA_CHANNEL_CLOSED, or a thrown send) — PROTO-06/07's "send never
  // throws, degrade on failure" contract is the safety net for this
  // optimistic guess.
  private _state: TransportState = 'ready';
  private readonly subscribers = new Set<(from: string, payload: unknown) => void>();
  private readonly stateListeners = new Set<(s: TransportState) => void>();

  // Accepted limitation (05-REVIEW.md WR-01, mirroring packages/web/src/
  // mount.ts's own WR-03 comment for the identical limitation on the web
  // adapter): this constructor registers three `conference.on(...)`
  // listeners below, and nothing in this class — nor in useScribbleSession.ts's
  // effect cleanup, which only unsubscribes this adapter's OWN Sets
  // (subscribers/stateListeners), never the underlying `conference` — ever
  // calls `conference.off(...)` to remove them. `ScribbleTransport`
  // (protocol) exposes no `destroy()`/`off()` hook for a real adapter to
  // implement, so those closures (and the `conference` reference they close
  // over) remain live for as long as the underlying `conference` object
  // exists, even after a session built over this adapter tears down. A
  // `conference` object must therefore NEVER be reused across two
  // `fromJitsiConference`/`useScribbleSession` constructions — doing so
  // would leave the old adapter's listeners firing forever, duplicating
  // every ENDPOINT_MESSAGE_RECEIVED dispatch across both the old and new
  // adapter's `subscribers` sets. Widening `ScribbleTransport` with an
  // optional detach hook is the fix if this proves to matter in practice.
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
    } else {
      // WR-04 fix (04-REVIEW.md), ported here: real lib-jitsi-meet always
      // provides conference.on via Listenable, so this branch is
      // defensive-only — but taking it silently means no
      // DATA_CHANNEL_CLOSED/OPENED and no ENDPOINT_MESSAGE_RECEIVED
      // listener is ever attached: incoming strokes are never received,
      // degrade-on-close never fires, and the optimistic 'ready' default
      // above is never corrected if wrong.
      console.warn('[jitsi-scribble] conference.on is not a function — annotation will never become ready');
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
