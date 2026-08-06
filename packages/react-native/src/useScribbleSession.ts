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
import { AppState } from 'react-native';

import { decode } from '@vilancer/protocol/codec';
import {
  LOCAL_SENDER,
  MSG_PRESENCE,
  PROTOCOL_VERSION,
  StrokeStore,
  type FrameDims,
  type Stroke,
} from '@vilancer/protocol/core';
import { normalize } from '@vilancer/protocol/geometry';
import type { ScribbleTransport } from '@vilancer/protocol/transport';

import {
  useContentRect,
  type UseContentRectResult,
} from './contentRect.native.js';
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
   * strokes. */
  onRemoteStrokeStart?: (from: string) => void;
  /** D-04: fires additionally, once, the instant a remote stroke's kind
   * transitions to 'tap' — never withheld until classification completes,
   * never fired for the local author's own strokes. */
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
  beginLocal: (id: string) => void;
  appendLocal: (id: string, x: number, y: number) => void;
  endLocal: (id: string, kind?: 'tap' | 'stroke') => void;
  /** This session's own local participant id, once known (empty string
   * before the transport has been constructed). */
  localId: string;
}

interface SessionHandles {
  transport: ScribbleTransport;
  store: StrokeStore;
}

export function useScribbleSession(
  options: UseScribbleSessionOptions,
): UseScribbleSessionResult {
  const {
    conference,
    transportOptions,
    transport: injectedTransport,
    frameDims,
    onRemoteStrokeStart,
    onRemoteTap,
  } = options;

  const sessionRef = useRef<SessionHandles | null>(null);
  const [localId, setLocalId] = useState('');
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

  useEffect(() => {
    const transport =
      injectedTransport ??
      fromJitsiConference(conference, transportOptionsRef.current);
    const store = new StrokeStore({ localId: transport.localId() });
    // Plan 05-04 fix (Rule 1 - bug, found integrating ScribbleOverlay):
    // StrokeStore's own lastTickNow defaults to 0 until the first tick(now)
    // call. Without this seed, any stroke inserted (a remote Start, or a
    // local beginLocal) BEFORE the RAF loop below fires its first real
    // callback (~one frame after mount, deferred via requestAnimationFrame)
    // gets createdAt/lastMoveAt stamped at 0 — epoch. The very first REAL
    // tick(Date.now()) that follows then computes `now - lastMoveAt` as
    // Date.now() itself (~10^12 ms), which is always >= STALE_MS, so
    // computePhaseAndAlpha's stale-watchdog branch fires immediately and the
    // stroke fades to 'dead' and is evicted before ever being visibly
    // rendered — even though zero real wall-clock time has actually passed.
    // Seeding the clock synchronously, before wiring transport.subscribe or
    // scheduling the RAF loop, closes this race for both remote (Start
    // frame arriving before the first RAF frame) and local (a touch
    // beginning before the first RAF frame) strokes.
    store.tick(Date.now());
    sessionRef.current = { transport, store };
    setLocalId(transport.localId());
    prevStrokeSnapshotRef.current = new Map();
    setRemotePresenceBySender(new Map());

    let destroyed = false;

    // Plan 05-04 fix (Rule 2 - missing critical functionality, found
    // integrating ScribbleOverlay/the end-to-end MemoryTransport test):
    // PROTO-03's own onOutbound(fn) hook exists precisely so a host glue
    // layer can wire store.onOutbound(frame => transport.send(frame)) — see
    // protocol/core/index.ts's own doc comment naming exactly this call —
    // but this file never called it. Without this wire-up, beginLocal/
    // appendLocal/endLocal's coalesced Start/Move/End WireFrames were
    // computed and handed to emitOutbound(), then dropped: nothing ever
    // reached transport.send(), so a locally-authored stroke NEVER crossed
    // the wire to a remote peer — the single most basic requirement this
    // whole library exists for (PROJECT.md's Core Value). Presence stays
    // hand-built via transport.send() directly (D-02, unchanged) — this
    // hook is for STROKE authoring frames only, never re-emitting anything
    // apply() already ingested (T-03-03-01, StrokeStore's own contract).
    const unsubscribeOutbound = store.onOutbound((frame) =>
      transport.send(frame),
    );

    const unsubscribeTransport = transport.subscribe((from, payload) => {
      // T-05-03 (CR-01 fix, 05-REVIEW.md): call apply() FIRST and
      // unconditionally, before this listener's own decode() below, so
      // checkRateLimit(from) — which runs as apply()'s very first statement,
      // ahead of its own internal decode() — debits the per-sender token
      // bucket for EVERY inbound payload, decodable or not. The original
      // code decoded here first and returned early on decode failure, which
      // meant malformed/undecodable payloads never reached apply() at all
      // and were never rate-limited — the cheapest possible flood a hostile
      // sender could mount. See this file's header comment above.
      store.apply(payload, from);

      const result = decode(payload);
      if (!result.ok) return;

      if (result.frame.t === MSG_PRESENCE) {
        // Extracted into a local `const` before entering the setState
        // updater closure below: TS's discriminated-union narrowing of a
        // PROPERTY access (`result.frame`) does not carry across a nested
        // function boundary, only narrowing of a plain variable does.
        const vis = result.frame.vis;
        // T-05-05: keyed by the trusted `from` ARGUMENT only — the frame's
        // own `from` field is never read here.
        setRemotePresenceBySender((prev) => {
          const next = new Map(prev);
          next.set(from, vis);
          return next;
        });
      }
    });

    // mount.ts's own destroyed-flag reentrancy guard (WR-02's fix,
    // 04-REVIEW.md) — load-bearing, copied verbatim rather than re-derived.
    let rafId: number | null = null;
    function frame(): void {
      store.tick(Date.now());
      if (!destroyed) rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    // D-02/D-03: presence is hand-built and sent via transport.send()
    // directly — never through store.beginLocal/appendLocal/endLocal.
    const sendPresence = (vis: boolean): void => {
      transport.send({
        v: PROTOCOL_VERSION,
        t: MSG_PRESENCE,
        from: transport.localId(),
        vis,
      });
    };
    // Pitfall 2: send the initial frame BEFORE registering the listener, so
    // a session that starts already backgrounded still announces its true
    // initial visibility rather than waiting for the first transition.
    // 'background' and 'inactive' both map to vis:false; only 'active'
    // maps to vis:true (D-03's literal wording).
    sendPresence(AppState.currentState === 'active');
    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState) => {
        sendPresence(nextState === 'active');
      },
    );

    // D-04: diff store.subscribe() snapshots to fire onRemoteStrokeStart
    // optimistically at first appearance, and onRemoteTap additionally
    // once a stroke's kind transitions to 'tap' — never for from === localId.
    const unsubscribeStore = store.subscribe((strokes) => {
      const prev = prevStrokeSnapshotRef.current;
      const next = new Map<string, Stroke>();
      for (const stroke of strokes) {
        const key = `${stroke.from} ${stroke.id}`;
        next.set(key, stroke);
        // A locally-authored stroke is tagged internally with
        // StrokeStore's own LOCAL_SENDER sentinel, NEVER with
        // transport.localId()'s real Jitsi participant id (protocol/core's
        // own documented contract) — this is the correct comparison for
        // "never fire for the local author's own strokes" (D-04).
        if (stroke.from === LOCAL_SENDER) continue;
        const prior = prev.get(key);
        if (!prior) onRemoteStrokeStart?.(stroke.from);
        if (stroke.kind === 'tap' && prior?.kind !== 'tap')
          onRemoteTap?.(stroke.from);
      }
      prevStrokeSnapshotRef.current = next;
    });

    return (): void => {
      destroyed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      unsubscribeOutbound();
      unsubscribeTransport();
      unsubscribeStore();
      appStateSubscription.remove();
      sessionRef.current = null;
    };
    // Deliberately NOT depending on onRemoteStrokeStart/onRemoteTap:
    // constructing a NEW transport/store on every identity change to either
    // callback would tear down and rebuild the entire session (including a
    // fresh transport.subscribe registration on the real conference) far
    // more often than intended. Both are read via closure and are expected
    // to be referentially stable across the session's lifetime — matching
    // mount.ts's own one-time construction.
    //
    // 05-REVIEW.md CR-02: `transportOptions` is deliberately NOT in this
    // list — see `transportOptionsRef`'s own comment above this effect.
    // `conference`/`injectedTransport` stay, since their identity changing
    // is the legitimate "the host swapped sessions" signal this effect must
    // still react to.
  }, [conference, injectedTransport]);

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

  const beginLocal = useCallback((id: string): void => {
    const session = sessionRef.current;
    const dims = frameDimsRef.current;
    if (!session || !dims) return;
    session.store.beginLocal(id, dims);
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
  };
}
