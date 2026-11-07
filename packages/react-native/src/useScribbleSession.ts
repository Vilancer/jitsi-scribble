// Orchestrates the RN transport adapter + StrokeStore (unchanged from Phase
// 3) + presence + host callbacks into one hook — the RN analog of
// packages/web/src/mount.ts's mountScribbleOverlay(), adapted from an
// imperative mount/destroy pair to useEffect mount/cleanup (WEB-01/02/03
// pattern, DRAW-01's session-orchestration half).
//
// D-02: presence handling stays OUTSIDE protocol/core's StrokeStore — its
// MSG_PRESENCE branch is a deliberate no-op from Phase 3. This file
// subscribes directly to transport.subscribe() for inbound Presence frames
// and constructs/sends outbound ones by hand via transport.send(), never
// through store.beginLocal/appendLocal/endLocal (those are stroke-authoring
// methods, not session-signal methods).
//
// T-05-03 (RESEARCH.md Security Domain, closed by this file): store.apply()
// is called UNCONDITIONALLY for every INBOUND PAYLOAD — not merely every
// decoded frame — and it is called FIRST, before this listener's own
// decode(). This is a deliberate deviation from RESEARCH.md Pattern 7's own
// sketch (which calls apply() only for non-Presence frames): apply()'s
// internal checkRateLimit(from) call runs before its type-switch and before
// its own internal decode(), so calling apply() first and unconditionally
// (regardless of whether payload is well-formed) is what makes the
// per-sender token bucket debit uniformly across every frame type AND every
// malformed/undecodable payload, closing both the Presence-frame-flooding
// bypass and the malformed-payload rate-limit bypass (05-REVIEW.md CR-01).
// This listener's own decode() below runs solely for Presence-branch
// payload inspection (apply() does not expose its decoded frame back to
// its caller); note this means every message type still pays for one
// redundant decode() call (apply()'s internal one, plus this listener's),
// not just Presence as an earlier version of this comment claimed
// (05-REVIEW.md WR-03) — accepted as a known, documented cost rather than
// widening protocol/core's public apply() signature to accept a
// pre-decoded frame.
//
// T-05-05 (closed by this file): presence tracking keys EXCLUSIVELY off the
// `from` argument transport.subscribe()'s callback supplies (itself sourced
// from participant.getId() at ENDPOINT_MESSAGE_RECEIVED, never from
// network-controlled payload content) — the decoded frame's own `from`
// field is never read for presence purposes anywhere in this file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  LOCAL_SENDER,
  StrokeStore,
  type FrameDims,
  type Stroke,
  type StrokeStyle,
} from '@vilancer/scribble-protocol/core';
import { normalize } from '@vilancer/scribble-protocol/geometry';
import type { ScribbleTransport } from '@vilancer/scribble-protocol/transport';

import {
  useContentRect,
  type UseContentRectResult,
} from './contentRect.native.js';
import { ScribbleClient } from './client.js';
import {
  fromJitsiConference,
  type FromJitsiConferenceOptions,
} from './fromJitsiConference.js';

export interface UseScribbleSessionOptions {
  /** The (real or fake) lib-jitsi-meet JitsiConference this session builds
   * its own adapter over, via fromJitsiConference (Task 2). Ignored if
   * `transport` is supplied directly. */
  conference?: unknown;
  /** Passed straight through to `fromJitsiConference` at session
   * construction only — never read again afterward. 05-REVIEW.md CR-02: this
   * hook does NOT require the caller to memoize this object (it is read via
   * an internal ref, not depended on directly), so passing an inline object
   * literal — `<ScribbleOverlay transportOptions={{ p2pEnabled: false }} />`
   * — is safe and will NOT tear down/rebuild the session on every host
   * re-render. It also means a change to this object's CONTENTS (as opposed
   * to `conference`'s own identity) is never itself a reason to rebuild the
   * session — if a host genuinely needs to apply new `transportOptions` to
   * an existing conference, it must do so by constructing a new
   * `conference`/`transport` (or a future explicit `sessionKey`), not by
   * relying on this object's identity. */
  transportOptions?: FromJitsiConferenceOptions;
  /** Test-only / advanced seam: inject a ScribbleTransport directly,
   * bypassing fromJitsiConference's own construction entirely. This is the
   * mocking seam this hook's own spec uses to exercise the
   * transport-consuming logic against a hand-built object satisfying
   * ScribbleTransport, since MemoryTransport's constructor signature does
   * not match what fromJitsiConference expects. */
  transport?: ScribbleTransport;
  /** A shared, already-started session (what <ScribbleProvider> passes
   * down). Takes precedence over `transport` and `conference`. */
  client?: ScribbleClient | null;
  /** The video content the local drawer is currently looking at — passed
   * straight through to contentRect.native.ts's useContentRect; `undefined`
   * until the host knows it. 05-REVIEW.md CR-01 (re-review): this hook does
   * NOT require the caller to memoize this object (its own contents are read
   * through an internal ref inside `beginLocal`, and `contentRect.native.ts`
   * keys its own memo on `frameDims.w`/`frameDims.h` rather than this
   * object's reference), so passing an inline object literal —
   * `<ScribbleOverlay frameDims={{ w, h }} />` — is safe and will NOT churn
   * `beginLocal`/`appendLocal`/the local-authoring `Gesture.Pan()`'s identity
   * on every render. */
  frameDims?: FrameDims;
  /** D-04: fires optimistically the instant a new remote stroke appears in
   * a store.subscribe() snapshot diff — never for the local author's own
   * strokes. 05-REVIEW.md WR-01: this hook does NOT require this callback to
   * be referentially stable across renders (it is read through an internal
   * ref at call time, never closed over directly by the effect that
   * invokes it), so passing an inline arrow function that closes over the
   * host's own changing render-scope state — `onRemoteStrokeStart={(from) =>
   * log(currentCallId, from)}` — is safe and always uses the latest
   * callback, never a stale one captured at session-construction time. */
  onRemoteStrokeStart?: (from: string) => void;
  /** D-04: fires additionally, once, the instant a remote stroke's kind
   * transitions to 'tap' — never withheld until classification completes,
   * never fired for the local author's own strokes. 05-REVIEW.md WR-01: the
   * same no-stability-required contract as `onRemoteStrokeStart` above. */
  onRemoteTap?: (from: string) => void;
}

export interface UseScribbleSessionResult {
  /** Read the store's current strokes at any time. */
  getStrokesSnapshot: () => readonly Stroke[];
  /** Subscribe to every store state change (tick/apply/local authoring).
   * Returns an unsubscribe function. */
  subscribeStrokes: (fn: (strokes: readonly Stroke[]) => void) => () => void;
  /** AWARE-01's signal, collapsed to a single scalar for this phase's 1:1
   * scope: `true` until at least one known non-local sender is confirmed
   * `vis: false`. See `remotePresenceBySender` for the per-sender detail
   * this is derived from. */
  remotePresence: boolean;
  /** Per-sender presence detail (T-05-05) — keyed by the transport
   * adapter's own `from` argument, never by a decoded payload's own `from`
   * field. */
  remotePresenceBySender: ReadonlyMap<string, boolean>;
  /** Wire this onto the overlay View's own `onLayout` prop — see
   * contentRect.native.ts. */
  onLayout: UseContentRectResult['onLayout'];
  /** The local drawer's own currently-known content rect — `null` until
   * both `frameDims` and this session's own `onLayout` measurement are
   * known. */
  contentRect: UseContentRectResult['contentRect'];
  /** Local-authoring bridge functions — gesture.ts's onLocalBegin/
   * onLocalSample/onLocalEnd call these via runOnJS. `appendLocal` takes
   * raw overlay-view pixel coordinates and normalizes them against this
   * session's own contentRect before calling store.appendLocal. */
  beginLocal: (id: string, style?: StrokeStyle) => void;
  appendLocal: (id: string, x: number, y: number) => void;
  endLocal: (id: string, kind?: 'tap' | 'stroke') => void;
  /** This session's own local participant id, once known (empty string
   * before the transport has been constructed). */
  localId: string;
  /** The session this hook is currently bound to (null before it exists).
   * Its identity changes whenever the session is rebuilt, even when the
   * participant id stays the same; key subscriptions on it. */
  client: ScribbleClient | null;
}

interface SessionHandles {
  transport: ScribbleTransport;
  store: StrokeStore;
  client: ScribbleClient;
}

export function useScribbleSession(
  options: UseScribbleSessionOptions,
): UseScribbleSessionResult {
  const {
    conference,
    transportOptions,
    transport: injectedTransport,
    client: injectedClient,
    frameDims,
    onRemoteStrokeStart,
    onRemoteTap,
  } = options;

  const sessionRef = useRef<SessionHandles | null>(null);
  const [localId, setLocalId] = useState('');
  const [activeClient, setActiveClient] = useState<ScribbleClient | null>(null);
  const [remotePresenceBySender, setRemotePresenceBySender] = useState<
    ReadonlyMap<string, boolean>
  >(new Map());
  // D-04's own "previous store.subscribe() snapshot" bookkeeping — keyed
  // identically to StrokeStore's own internal composite key (`from` and
  // `id` joined by a space).
  const prevStrokeSnapshotRef = useRef<Map<string, Stroke>>(new Map());

  const { contentRect, onLayout } = useContentRect(frameDims);

  // 05-REVIEW.md CR-02: `transportOptions` is a plain options OBJECT
  // (`FromJitsiConferenceOptions | undefined`), and `ScribbleOverlayProps`
  // lets a host pass it as an inline JSX literal
  // (`<ScribbleOverlay transportOptions={{ p2pEnabled: false }} .../>`) — the
  // natural, idiomatic way to pass it, and one that recreates a brand-new
  // object on every render of the HOST's own component. Reading it through a
  // ref updated on every render (instead of depending on it directly below)
  // means that churn no longer tears down and rebuilds this entire session —
  // the effect only re-reads whatever `transportOptions` most recently was,
  // at the moment it actually re-runs for some OTHER reason.
  //
  // `conference`/`injectedTransport` deliberately stay in the effect's own
  // dependency array below, unlike `transportOptions`: unlike an options
  // object, a real `JitsiConference` (or an injected test transport) is a
  // single, stable, session-scoped object a host obtains once and passes
  // down — its identity changing IS the legitimate signal that the host
  // actually swapped to a different conference (e.g. a real reconnection),
  // and that case must still tear down and rebuild the whole session (a new
  // transport, a new StrokeStore, a fresh Presence announce) exactly as
  // before. Only the false-positive churn source (`transportOptions`) is
  // being fixed here — this is deliberately NOT "depend on nothing but
  // injectedTransport," which would also silently stop reacting to a real
  // `conference` swap when no `transport` is injected.
  const transportOptionsRef = useRef(transportOptions);
  transportOptionsRef.current = transportOptions;

  // 05-REVIEW.md CR-01 (re-review): the same ref-based pattern as
  // `transportOptionsRef` above, applied to `frameDims`. `beginLocal` below
  // used to depend on `frameDims` directly, so a host passing an inline,
  // unmemoized `frameDims={{ w, h }}` object literal churned `beginLocal`'s
  // own identity every render even when the numbers never changed — which
  // cascaded into ScribbleOverlay.tsx's `onLocalBegin` (keyed on
  // `[session.beginLocal, session.appendLocal]`) and then gesture.ts's
  // memoized `Gesture.Pan()`, reopening WR-02's `pan`-identity-churn bug via
  // a second, independent path (the other path — `contentRect`'s own
  // reference instability — is fixed in contentRect.native.ts). Reading the
  // latest `frameDims` through a ref means `beginLocal`'s identity no longer
  // depends on `frameDims`'s reference at all.
  const frameDimsRef = useRef(frameDims);
  frameDimsRef.current = frameDims;

  // 05-REVIEW.md WR-01: the same ref-based pattern as `transportOptionsRef`/
  // `frameDimsRef` above, applied to `onRemoteStrokeStart`/`onRemoteTap`.
  // Unlike those two, this is not a rebuild-avoidance concern — it is a
  // stale-closure CORRECTNESS bug. The effect below that actually invokes
  // these callbacks (the `store.subscribe(...)` listener) only (re-)runs on
  // `[conference, injectedTransport]` changes, so closing over the
  // destructured `onRemoteStrokeStart`/`onRemoteTap` directly meant every
  // later render's new callback identity was silently ignored for the rest
  // of the session's lifetime — e.g. a host's idiomatic inline
  // `onRemoteStrokeStart={(from) => log(currentCallId, from)}` would freeze
  // on the FIRST render's `currentCallId` forever. Reading the latest
  // callback through a ref at call time (inside the effect, not in its
  // dependency array) fixes the staleness with no rebuild-avoidance
  // trade-off to weigh: the effect's own dependency array is unchanged.
  const onRemoteStrokeStartRef = useRef(onRemoteStrokeStart);
  onRemoteStrokeStartRef.current = onRemoteStrokeStart;
  const onRemoteTapRef = useRef(onRemoteTap);
  onRemoteTapRef.current = onRemoteTap;

  useEffect(() => {
    // `client: null` means "inside a provider whose call hasn't started":
    // wait for the real client rather than building a throwaway session.
    if (injectedClient === null) return undefined;
    // A client handed in by <ScribbleProvider> is shared with other surfaces
    // (toolbar, out-of-app overlay) and owned by the provider: this hook
    // listens to it but never starts or stops it.
    const owned = !injectedClient;
    const client =
      injectedClient ??
      new ScribbleClient(
        injectedTransport ?? fromJitsiConference(conference, transportOptionsRef.current),
      );
    const { transport, store } = client;
    sessionRef.current = { transport, store, client };
    setLocalId(transport.localId());
    setActiveClient(client);
    prevStrokeSnapshotRef.current = new Map();
    setRemotePresenceBySender(client.getPresence());

    const stopClient = owned ? client.start() : null;
    const unsubscribePresence = client.onPresence((bySender) => setRemotePresenceBySender(bySender));

    // D-04: diff store snapshots to fire onRemoteStrokeStart at a remote
    // stroke's first appearance, and onRemoteTap once its kind becomes
    // 'tap'. Local strokes are tagged LOCAL_SENDER inside the store (never
    // the real participant id), so that is the comparison to skip them.
    // Callbacks are read through refs so an inline host callback is never
    // stale (05-REVIEW WR-01).
    const unsubscribeStore = store.subscribe((strokes) => {
      const prev = prevStrokeSnapshotRef.current;
      const next = new Map<string, Stroke>();
      for (const stroke of strokes) {
        const key = `${stroke.from} ${stroke.id}`;
        next.set(key, stroke);
        if (stroke.from === LOCAL_SENDER) continue;
        const prior = prev.get(key);
        if (!prior) onRemoteStrokeStartRef.current?.(stroke.from);
        if (stroke.kind === 'tap' && prior?.kind !== 'tap')
          onRemoteTapRef.current?.(stroke.from);
      }
      prevStrokeSnapshotRef.current = next;
    });

    return (): void => {
      unsubscribePresence();
      unsubscribeStore();
      stopClient?.();
      sessionRef.current = null;
      setActiveClient(null);
    };
    // conference / transport / client identity changing means the host
    // swapped sessions: rebuild. transportOptions and the callbacks are read
    // through refs on purpose (05-REVIEW CR-02, WR-01).
  }, [conference, injectedTransport, injectedClient]);

  const getStrokesSnapshot = useCallback(
    (): readonly Stroke[] => sessionRef.current?.store.snapshot() ?? [],
    [],
  );

  const subscribeStrokes = useCallback(
    (fn: (strokes: readonly Stroke[]) => void): (() => void) => {
      const session = sessionRef.current;
      if (!session) return (): void => {};
      return session.store.subscribe(fn);
    },
    [],
  );

  const beginLocal = useCallback((id: string, style?: StrokeStyle): void => {
    const session = sessionRef.current;
    const dims = frameDimsRef.current;
    if (!session || !dims) return;
    session.store.beginLocal(id, dims, style);
  }, []); // stable regardless of frameDims identity — see frameDimsRef above

  const appendLocal = useCallback(
    (id: string, x: number, y: number): void => {
      const session = sessionRef.current;
      if (!session || !contentRect) return;
      const { u, v } = normalize(x, y, contentRect);
      session.store.appendLocal(id, u, v);
    },
    [contentRect],
  );

  const endLocal = useCallback((id: string, kind?: 'tap' | 'stroke'): void => {
    sessionRef.current?.store.endLocal(id, kind);
  }, []);

  const remotePresence = useMemo((): boolean => {
    for (const vis of remotePresenceBySender.values()) {
      if (!vis) return false;
    }
    return true;
  }, [remotePresenceBySender]);

  return {
    getStrokesSnapshot,
    subscribeStrokes,
    remotePresence,
    remotePresenceBySender,
    onLayout,
    contentRect,
    beginLocal,
    appendLocal,
    endLocal,
    localId,
    client: activeClient,
  };
}
