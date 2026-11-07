// ScribbleClient: one annotation session over one ScribbleTransport. Owns the
// StrokeStore, wires it to the transport in both directions, drives the fade
// clock, and handles presence. Plain TypeScript, no React, so every surface
// (the in-app overlay, the toolbar, the out-of-app overlay in
// @vilancer/native-overlay) can share the same session.
//
// Security notes carried over from the original hook (useScribbleSession):
// - store.apply() runs FIRST and for EVERY inbound payload, decodable or not,
//   so the per-sender rate limit debits uniformly (05-REVIEW CR-01).
// - Presence is keyed by the transport's own `from` argument, never by the
//   payload's `from` field (T-05-05).
import { AppState } from 'react-native';

import { decode } from '@vilancer/protocol/codec';
import {
  MSG_CLEAR,
  MSG_PRESENCE,
  PROTOCOL_VERSION,
  StrokeStore,
} from '@vilancer/protocol/core';
import type { WireFrame } from '@vilancer/protocol/schema';
import type { ScribbleTransport } from '@vilancer/protocol/transport';

export type InboundListener = (from: string, frame: WireFrame) => void;
export type PresenceListener = (bySender: ReadonlyMap<string, boolean>) => void;

export interface ScribbleClientOptions {
  /** Passed to the StrokeStore (fade timing, caps). */
  holdMs?: number;
  fadeMs?: number;
  staleMs?: number;
}

export class ScribbleClient {
  readonly transport: ScribbleTransport;
  readonly store: StrokeStore;
  readonly options: ScribbleClientOptions;

  private readonly inbound = new Set<InboundListener>();
  private readonly presenceListeners = new Set<PresenceListener>();
  private presence: ReadonlyMap<string, boolean> = new Map();
  private presenceOverride: boolean | null = null;
  private lastSentPresence: boolean | null = null;
  private started = false;
  private teardown: (() => void) | null = null;

  constructor(transport: ScribbleTransport, options: ScribbleClientOptions = {}) {
    this.transport = transport;
    this.options = options;
    this.store = new StrokeStore({
      localId: transport.localId(),
      holdMs: options.holdMs,
      fadeMs: options.fadeMs,
      staleMs: options.staleMs,
    });
    // Seed the clock before anything can insert a stroke: with lastTickNow
    // still 0, the first real tick would see every stroke as ~10^12 ms
    // stale and evict it before it ever rendered (Plan 05-04 fix).
    this.store.tick(Date.now());
  }

  /** Wires transport ↔ store, starts the fade clock and presence. Returns a
   * stop function. Calling start() twice is a no-op. */
  start(): () => void {
    if (this.started) return () => this.stop();
    this.started = true;
    const { transport, store } = this;
    let destroyed = false;

    // Local strokes → wire. Remote strokes are never re-broadcast (the store
    // only emits outbound frames for local authoring).
    const unsubscribeOutbound = store.onOutbound((frame) => transport.send(frame));

    const unsubscribeTransport = transport.subscribe((from, payload) => {
      store.apply(payload, from);
      const result = decode(payload);
      if (!result.ok) return;
      const frame = result.frame;
      if (frame.t === MSG_PRESENCE) {
        const next = new Map(this.presence);
        next.set(from, frame.vis);
        this.presence = next;
        for (const fn of this.presenceListeners) fn(next);
      }
      for (const fn of this.inbound) fn(from, frame);
    });

    let rafId: number | null = null;
    const frame = (): void => {
      store.tick(Date.now());
      if (!destroyed) rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);

    // Announce the initial visibility before listening for changes, so a
    // session that starts in the background still says so.
    this.sendPresence(true);
    const appStateSubscription = AppState.addEventListener('change', () => this.sendPresence(true));
    // A presence frame sent before the call's data channel opened was
    // dropped; announce again once the transport becomes ready.
    const unsubscribeState = transport.onStateChange((state) => {
      if (state === 'ready') this.sendPresence(true);
    });

    this.teardown = (): void => {
      destroyed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      unsubscribeOutbound();
      unsubscribeTransport();
      appStateSubscription.remove();
      unsubscribeState();
    };
    return () => this.stop();
  }

  stop(): void {
    this.teardown?.();
    this.teardown = null;
    this.started = false;
  }

  /** Decoded inbound frames (after the store has applied them). */
  onInbound(fn: InboundListener): () => void {
    this.inbound.add(fn);
    return () => this.inbound.delete(fn);
  }

  /** Per-sender presence, keyed by the transport's own `from`. */
  getPresence(): ReadonlyMap<string, boolean> {
    return this.presence;
  }

  onPresence(fn: PresenceListener): () => void {
    this.presenceListeners.add(fn);
    return () => this.presenceListeners.delete(fn);
  }

  /** Overrides what this session announces as its own visibility. The
   * out-of-app overlay sets `true` while it shows ink over other apps, so
   * the other side doesn't dim its strokes as "nobody's looking". `null`
   * goes back to following AppState. */
  setPresenceOverride(visible: boolean | null): void {
    this.presenceOverride = visible;
    if (this.started) this.sendPresence(false);
  }

  /** Removes this participant's own strokes here and on every receiver. */
  clearMine(): void {
    this.store.clear('mine');
    this.transport.send({ v: PROTOCOL_VERSION, t: MSG_CLEAR, from: this.transport.localId() });
  }

  private sendPresence(force: boolean): void {
    const vis = this.presenceOverride ?? AppState.currentState === 'active';
    if (!force && vis === this.lastSentPresence) return;
    this.lastSentPresence = vis;
    this.transport.send({ v: PROTOCOL_VERSION, t: MSG_PRESENCE, from: this.transport.localId(), vis });
  }
}
