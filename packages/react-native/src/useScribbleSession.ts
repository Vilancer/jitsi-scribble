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
// is called UNCONDITIONALLY for every decoded frame, Presence included —
// never gated behind the `t === MSG_PRESENCE` branch. This is a deliberate
// deviation from RESEARCH.md Pattern 7's own sketch (which calls apply()
// only for non-Presence frames): apply()'s internal checkRateLimit(from)
// call runs before its type-switch, so calling apply() unconditionally is
// what makes the per-sender token bucket debit uniformly across every frame
// type, closing the Presence-frame-flooding-bypasses-rate-limit gap. Accept
// the one redundant decode() call per Presence message this causes —
// negligible given Presence's low natural frequency, and strictly safer
// than hand-rolling a second, lighter validator outside protocol/codec.
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

import { useContentRect, type UseContentRectResult } from './contentRect.native.js';
import { fromJitsiConference, type FromJitsiConferenceOptions } from './fromJitsiConference.js';

export interface UseScribbleSessionOptions {
  /** The (real or fake) lib-jitsi-meet JitsiConference this session builds
   * its own adapter over, via fromJitsiConference (Task 2). Ignored if
   * `transport` is supplied directly. */
  conference?: unknown;
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
   * until the host knows it. */
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

export function useScribbleSession(options: UseScribbleSessionOptions): UseScribbleSessionResult {
  const { conference, transportOptions, transport: injectedTransport, frameDims, onRemoteStrokeStart, onRemoteTap } =
    options;

  const sessionRef = useRef<SessionHandles | null>(null);
  const [localId, setLocalId] = useState('');
  const [remotePresenceBySender, setRemotePresenceBySender] = useState<ReadonlyMap<string, boolean>>(new Map());
  // D-04's own "previous store.subscribe() snapshot" bookkeeping — keyed
  // identically to StrokeStore's own internal composite key (`from` and
  // `id` joined by a space).
  const prevStrokeSnapshotRef = useRef<Map<string, Stroke>>(new Map());

  const { contentRect, onLayout } = useContentRect(frameDims);

  useEffect(() => {
    const transport = injectedTransport ?? fromJitsiConference(conference, transportOptions);
    const store = new StrokeStore({ localId: transport.localId() });
    sessionRef.current = { transport, store };
    setLocalId(transport.localId());
    prevStrokeSnapshotRef.current = new Map();
    setRemotePresenceBySender(new Map());

    let destroyed = false;

    const unsubscribeTransport = transport.subscribe((from, payload) => {
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

      // T-05-03: unconditional — see this file's header comment.
      store.apply(payload, from);
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
      transport.send({ v: PROTOCOL_VERSION, t: MSG_PRESENCE, from: transport.localId(), vis });
    };
    // Pitfall 2: send the initial frame BEFORE registering the listener, so
    // a session that starts already backgrounded still announces its true
    // initial visibility rather than waiting for the first transition.
    // 'background' and 'inactive' both map to vis:false; only 'active'
    // maps to vis:true (D-03's literal wording).
    sendPresence(AppState.currentState === 'active');
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      sendPresence(nextState === 'active');
    });

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
        if (stroke.kind === 'tap' && prior?.kind !== 'tap') onRemoteTap?.(stroke.from);
      }
      prevStrokeSnapshotRef.current = next;
    });

    return (): void => {
      destroyed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
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
  }, [conference, injectedTransport, transportOptions]);

  const getStrokesSnapshot = useCallback((): readonly Stroke[] => sessionRef.current?.store.snapshot() ?? [], []);

  const subscribeStrokes = useCallback((fn: (strokes: readonly Stroke[]) => void): (() => void) => {
    const session = sessionRef.current;
    if (!session) return (): void => {};
    return session.store.subscribe(fn);
  }, []);

  const beginLocal = useCallback(
    (id: string): void => {
      const session = sessionRef.current;
      if (!session || !frameDims) return;
      session.store.beginLocal(id, frameDims);
    },
    [frameDims],
  );

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
