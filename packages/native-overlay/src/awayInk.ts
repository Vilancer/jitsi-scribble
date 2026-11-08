// AwayInk: what a sharer gets from the other side's ink while they are OUT of
// the app (iOS, where no app may draw over other apps). Plain TypeScript, no
// React; useAwayInk() wires it to AppState and the native module.
//
//   remote frames ─▶ PiP ink layer         (live, while away)
//   first stroke of a burst ─▶ notification + snapshot of the shared screen
//   back in the app ─▶ each burst replayed over its snapshot, in real time
//
// A "burst" is ink with no gap longer than `burstGapMs`: one "look here". The
// notification fires once per burst, so a long explanation is one buzz.
import { MSG_CLEAR, MSG_END, MSG_MOVE, MSG_START } from '@vilancer/scribble-protocol/core';
import type { WireFrame } from '@vilancer/scribble-protocol/schema';
import type { ScribbleClient } from '@vilancer/scribble';

import { forwardRemoteFrame, type RemoteInkTarget } from './bridge.js';
import type { AwaySnapshot } from './awayNative.js';

/** What AwayInk needs from the native side; the iOS module implements it. */
export interface AwayInkNative extends RemoteInkTarget {
  clear(scope: string): void;
  notify(title: string, body: string): void;
  snapshot(): Promise<AwaySnapshot | null>;
  deleteSnapshots(): void;
}

export interface AwayInkConfig {
  /** Notification text, or false for none. */
  notify: { title: string; body: string } | false;
  replay: boolean;
  /** Quiet time that ends a burst. Default 8000 ms. */
  burstGapMs: number;
  /** Ink held after the last replayed frame before the next burst. */
  replayTailMs: number;
  /** Bursts kept for replay (oldest dropped). */
  maxBursts: number;
  /** Frames kept per burst. */
  maxFramesPerBurst: number;
}

export const DEFAULT_AWAY_CONFIG: AwayInkConfig = {
  notify: { title: 'Drawing on your screen', body: "Open the app to see where they're pointing." },
  replay: true,
  burstGapMs: 8000,
  replayTailMs: 2600,
  maxBursts: 5,
  maxFramesPerBurst: 600,
};

interface Burst {
  snapshot: Promise<AwaySnapshot | null>;
  frames: Array<{ from: string; frame: WireFrame; at: number }>;
}

export interface AwayInkDeps {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const defaultDeps: AwayInkDeps = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class AwayInk {
  private away = false;
  private pipActive = false;
  private lastRemoteInkAt = -Infinity;
  private bursts: Burst[] = [];
  private timers = new Set<unknown>();
  private replaying = false;
  private replayRun = 0;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly client: ScribbleClient,
    private readonly native: AwayInkNative,
    private readonly config: AwayInkConfig = DEFAULT_AWAY_CONFIG,
    /** The snapshot strokes are being replayed over, or null when done. */
    private readonly onReplay: (snapshot: AwaySnapshot | null) => void = () => undefined,
    private readonly deps: AwayInkDeps = defaultDeps,
  ) {
    const localId = client.transport.localId();
    this.unsubscribe = client.onInbound((from, frame) => {
      if (from === localId) return;
      this.onRemote(from, frame);
    });
  }

  /** The app went to the background (true) or came back (false). */
  setAway(away: boolean): void {
    if (away === this.away) return;
    this.away = away;
    if (away) {
      this.cancelReplay();
      return;
    }
    // Back in the app: the PiP closes and the in-app overlay draws live ink
    // again. A stroke still in progress keeps going there.
    this.native.clear('all');
    this.lastRemoteInkAt = -Infinity;
    if (this.config.replay && this.bursts.length > 0) this.startReplay();
  }

  setPipActive(active: boolean): void {
    this.pipActive = active;
    // While the PiP shows the ink, the sharer IS looking at it: say so, so
    // the other side doesn't dim its strokes as "nobody's watching".
    this.client.setPresenceOverride(active ? true : null);
  }

  get isReplaying(): boolean {
    return this.replaying;
  }

  /** Stops a replay in progress and forgets what was left. */
  skipReplay(): void {
    this.cancelReplay();
    this.bursts = [];
    this.native.deleteSnapshots();
  }

  dispose(): void {
    this.unsubscribe();
    this.cancelReplay();
    this.bursts = [];
    this.native.clear('all');
    this.native.deleteSnapshots();
    if (this.pipActive) this.client.setPresenceOverride(null);
  }

  private onRemote(from: string, frame: WireFrame): void {
    if (!this.away) return;
    forwardRemoteFrame(this.native, from, frame);
    if (frame.t !== MSG_START && frame.t !== MSG_MOVE && frame.t !== MSG_END && frame.t !== MSG_CLEAR) return;

    const now = this.deps.now();
    if (frame.t === MSG_START && now - this.lastRemoteInkAt > this.config.burstGapMs) {
      if (this.config.notify) this.native.notify(this.config.notify.title, this.config.notify.body);
      if (this.config.replay) {
        this.bursts.push({ snapshot: this.native.snapshot().catch(() => null), frames: [] });
        if (this.bursts.length > this.config.maxBursts) this.bursts.shift();
      }
    }
    if (frame.t === MSG_START || frame.t === MSG_MOVE) this.lastRemoteInkAt = now;

    const burst = this.bursts[this.bursts.length - 1];
    if (this.config.replay && burst && burst.frames.length < this.config.maxFramesPerBurst) {
      burst.frames.push({ from, frame, at: now });
    }
  }

  private startReplay(): void {
    const run = ++this.replayRun;
    const bursts = this.bursts;
    this.bursts = [];
    this.replaying = true;
    const next = async (i: number): Promise<void> => {
      if (run !== this.replayRun) return;
      if (i >= bursts.length) {
        this.finishReplay();
        return;
      }
      const burst = bursts[i];
      const snapshot = await burst.snapshot;
      if (run !== this.replayRun) return;
      // Without a picture of the screen the ink has nothing to point at.
      if (!snapshot || burst.frames.length === 0) {
        void next(i + 1);
        return;
      }
      this.onReplay(snapshot);
      const t0 = burst.frames[0].at;
      for (const { from, frame, at } of burst.frames) {
        this.later(() => {
          if (run === this.replayRun) this.client.store.apply(replayFrame(frame, i), from);
        }, at - t0);
      }
      const last = burst.frames[burst.frames.length - 1].at - t0;
      this.later(() => void next(i + 1), last + this.config.replayTailMs);
    };
    // Let the app's UI settle first.
    this.later(() => void next(0), 400);
  }

  private finishReplay(): void {
    this.replaying = false;
    this.onReplay(null);
    this.native.deleteSnapshots();
  }

  private cancelReplay(): void {
    this.replayRun++;
    for (const t of this.timers) this.deps.clearTimeout(t);
    this.timers.clear();
    if (this.replaying) {
      this.replaying = false;
      this.onReplay(null);
    }
  }

  private later(fn: () => void, ms: number): void {
    const handle = this.deps.setTimeout(() => {
      this.timers.delete(handle);
      fn();
    }, Math.max(0, ms));
    this.timers.add(handle);
  }
}

/** The same frame under a fresh id, so the store treats the replay as a new
 * stroke (it ignores a Start for an id it has seen). */
function replayFrame(frame: WireFrame, burst: number): WireFrame {
  if (frame.t !== MSG_START && frame.t !== MSG_MOVE && frame.t !== MSG_END) return frame;
  const suffix = `~r${burst}`;
  return { ...frame, id: `${frame.id.slice(0, 128 - suffix.length)}${suffix}` };
}
