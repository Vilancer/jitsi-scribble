// The first implementation of ARCHITECTURE.md section 6's `ScribbleSurface`
// interface — no shipped code exists yet for that interface itself, so this
// file defines it too (structurally mirroring how `protocol/transport`'s
// `ScribbleTransport` port has multiple implementations: the port interface
// lives beside its first real consumer, small and single-purpose, no Jitsi
// vocabulary — `InAppSurface` carries none either).
//
// `jitsi-scribble` ships exactly this one implementation: it always works,
// on every platform, with no native code, in Expo Go (ARCHITECTURE.md
// section 6). `@jitsi-scribble/native-overlay` (Phase 7, gated on Phase 1's
// spike verdict) will ship `AndroidOverlaySurface`/`IosPipSurface` as
// siblings of this same interface — discovered at runtime via
// `useScribbleSession({ surfaces })`, never imported from this package.
import type { StrokeStore } from '@vilancer/protocol/core';
import type { ContentRect } from '@vilancer/protocol/geometry';

/** The handle `present()` resolves with — call `dispose()` to tear down
 * whatever `present()` set up. */
export interface Disposable {
  dispose(): void;
}

export interface ScribbleSurface {
  /** 'in-app' | 'android-overlay' | 'ios-pip' — a stable identifier a host
   * app can use to distinguish which surface `useScribbleSession` selected,
   * without importing this file's own class. */
  readonly id: string;
  /** Resolves to whether this surface can currently render at all.
   * `'unsupported'` is a first-class outcome, not an error path — it is
   * exactly what lets a failed out-of-app spike (Phase 1/7) remove one
   * array element with no type change and no release blocker. */
  capability(): Promise<'ready' | 'needs-permission' | 'unsupported'>;
  /** Requests whatever permission `capability()` reported as missing (e.g.
   * Android's `ACTION_MANAGE_OVERLAY_PERMISSION`). Optional: a surface that
   * never needs a permission grant (this one) omits it entirely, rather
   * than implementing a method that always resolves `true`. */
  request?(): Promise<boolean>;
  /** Starts rendering `store`'s strokes against `geom()`'s current content
   * rect, resolving once presentation has begun. */
  present(store: StrokeStore, geom: () => ContentRect): Promise<Disposable>;
}

/**
 * The always-available in-app surface — this phase's `<ScribbleOverlay>`
 * (Plan 05-04) IS the rendering; `present()` exists only so this surface can
 * be selected interchangeably with a future out-of-app surface through the
 * same `ScribbleSurface` interface, and does no imperative work of its own:
 * `<ScribbleOverlay>` mounts/unmounts via React's own render tree, not via
 * this method. `capability()` is unconditionally `'ready'` — pure JS, no
 * permission, works in Expo Go — matching ARCHITECTURE.md section 6's "it
 * always works, on every platform, with no native code" description.
 */
export class InAppSurface implements ScribbleSurface {
  readonly id = 'in-app';

  async capability(): Promise<'ready' | 'needs-permission' | 'unsupported'> {
    return 'ready';
  }

  // No `request()` — this surface never needs a permission grant; the
  // interface's own `request?` optionality exists for exactly this case.

  async present(_store: StrokeStore, _geom: () => ContentRect): Promise<Disposable> {
    return { dispose: (): void => {} };
  }
}

export const inAppSurface = new InAppSurface();
