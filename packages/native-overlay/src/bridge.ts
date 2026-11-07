// OutOfAppBridge: connects one ScribbleClient (the call's annotation
// session) to the native overlay windows.
//
//   remote frames ─▶ native ink layer      (what the other side draws)
//   native touches ─▶ StrokeStore ─▶ wire   (what this user draws over other apps)
//
// Local out-of-app strokes go through their OWN StrokeStore (same participant
// id) rather than the shared one: they are positioned on the whole display,
// not on a video tile, so the in-app overlay must never render them. That
// store is still a real StrokeStore, so they get the same coalescing and
// wire format as in-app strokes. Its clock is ticked on every native event
// rather than by requestAnimationFrame, because RN pauses frame callbacks
// while the app is in the background, which is exactly when this runs.
import { dequantize, MSG_CLEAR, MSG_END, MSG_MOVE, MSG_START, StrokeStore } from '@vilancer/protocol/core';
import type { WireFrame } from '@vilancer/protocol/schema';
import type { ScribbleClient } from '@vilancer/react-native';

import type { LocalStrokeEvent, NativeShowOptions, NativeStyle } from './native.js';

/** The subset of the native module the bridge drives. */
export interface OverlayNative {
  show(options: NativeShowOptions): Promise<boolean>;
  hide(): void;
  setStyle(style: NativeStyle): void;
  remoteBegin(key: string, u: number, v: number, color: string | null, width: number | null, tool: string | null): void;
  remoteAppend(key: string, points: number[]): void;
  remoteEnd(key: string, kind: string | null): void;
  clear(scope: string): void;
  addListener(event: string, fn: (e: never) => void): { remove(): void };
}

export interface OutOfAppBridgeOptions {
  /** Called when the user changes tool/colour/size in the native toolbar. */
  onStyleChange?: (style: NativeStyle) => void;
  /** Called when the native state changes (shown/hidden, draw mode). */
  onStateChange?: (state: { visible: boolean; drawing: boolean }) => void;
}

export class OutOfAppBridge {
  private readonly author: StrokeStore;
  private readonly subs: Array<{ remove(): void }> = [];
  private readonly unsubscribers: Array<() => void> = [];
  private visible = false;

  constructor(
    private readonly client: ScribbleClient,
    private readonly native: OverlayNative,
    private readonly options: OutOfAppBridgeOptions = {},
  ) {
    const { transport } = client;
    this.author = new StrokeStore({
      localId: transport.localId(),
      holdMs: client.options.holdMs,
      fadeMs: client.options.fadeMs,
      staleMs: client.options.staleMs,
    });
    this.author.tick(Date.now());
    this.unsubscribers.push(this.author.onOutbound((frame) => transport.send(frame)));
    this.unsubscribers.push(client.onInbound((from, frame) => this.forward(from, frame)));

    this.subs.push(
      native.addListener('onLocalStroke', ((e: LocalStrokeEvent) => this.onLocalStroke(e)) as (e: never) => void),
      native.addListener('onAction', ((e: { action: string }) => {
        if (e.action === 'clear') this.clearMine();
      }) as (e: never) => void),
      native.addListener('onStyleChange', ((e: NativeStyle) => this.options.onStyleChange?.(e)) as (e: never) => void),
      native.addListener('onStateChange', ((e: { visible: boolean; drawing: boolean }) => {
        this.options.onStateChange?.(e);
      }) as (e: never) => void),
    );
  }

  /** Shows the bubble + ink layer. Resolves false without overlay
   * permission. While shown, this session reports itself as visible so the
   * other side doesn't dim its ink. */
  async show(options: NativeShowOptions): Promise<boolean> {
    const ok = await this.native.show(options);
    this.visible = ok;
    this.client.setPresenceOverride(ok ? true : null);
    return ok;
  }

  hide(): void {
    this.native.hide();
    this.visible = false;
    this.client.setPresenceOverride(null);
  }

  setStyle(style: NativeStyle): void {
    this.native.setStyle(style);
  }

  dispose(): void {
    this.hide();
    for (const s of this.subs) s.remove();
    for (const u of this.unsubscribers) u();
    this.subs.length = 0;
    this.unsubscribers.length = 0;
  }

  /** Remote frame → native ink layer. Keys are "<from> <id>", the same
   * composite key the store uses, so two senders' ids never collide. */
  private forward(from: string, frame: WireFrame): void {
    if (!this.visible) return;
    switch (frame.t) {
      case MSG_START:
        this.native.remoteBegin(
          `${from} ${frame.id}`,
          dequantize(frame.p[0]),
          dequantize(frame.p[1]),
          frame.st?.c ?? null,
          frame.st?.w ?? null,
          frame.st?.k ?? null,
        );
        return;
      case MSG_MOVE: {
        const flat: number[] = [];
        for (const [u, v] of frame.pts) flat.push(dequantize(u), dequantize(v));
        this.native.remoteAppend(`${from} ${frame.id}`, flat);
        return;
      }
      case MSG_END:
        this.native.remoteEnd(`${from} ${frame.id}`, frame.kind ?? null);
        return;
      case MSG_CLEAR:
        this.native.clear(from);
        return;
      default:
        return;
    }
  }

  private onLocalStroke(e: LocalStrokeEvent): void {
    const store = this.author;
    store.tick(Date.now());
    switch (e.phase) {
      case 'begin':
        store.beginLocal(e.id, { w: e.frameW, h: e.frameH }, { color: e.color, width: e.width, tool: e.tool });
        store.appendLocal(e.id, e.points[0], e.points[1]);
        return;
      case 'append':
        for (let i = 0; i + 1 < e.points.length; i += 2) store.appendLocal(e.id, e.points[i], e.points[i + 1]);
        return;
      case 'end':
        store.endLocal(e.id, e.kind);
        return;
      case 'shape':
        store.beginLocal(e.id, { w: e.frameW, h: e.frameH }, { color: e.color, width: e.width, tool: e.tool });
        for (let i = 0; i + 1 < e.points.length; i += 2) store.appendLocal(e.id, e.points[i], e.points[i + 1]);
        store.endLocal(e.id, 'stroke');
        return;
      default:
        return;
    }
  }

  private clearMine(): void {
    this.author.clear('all');
    // Also erases this participant's in-app ink and tells every receiver
    // (one Clear frame clears all of a sender's strokes).
    this.client.clearMine();
  }
}
