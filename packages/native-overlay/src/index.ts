// @vilancer/scribble-overlay — the other side's ink outside the app. Optional
// companion to @vilancer/scribble.
//   useOutOfAppOverlay(): the floating pen (bubble + tool ring + ink layer).
//     Android: over every app. iOS: over this app only (iOS lets no app draw
//     over other apps).
//   useAwayInk() (iOS, optional): picture-in-picture ink, a notification and
//     a replay for a sharer who has left the app.
// Everything is a safe no-op (`supported: false`) where it can't run.
export { useOutOfAppOverlay } from './useOutOfAppOverlay.js';
export type { OutOfAppOverlayOptions, OutOfAppOverlayState } from './useOutOfAppOverlay.js';
export { OutOfAppBridge, forwardRemoteFrame } from './bridge.js';
export type { OutOfAppBridgeOptions, OverlayNative, RemoteInkTarget } from './bridge.js';
export { useAwayInk } from './useAwayInk.js';
export type { AwayInkOptions, AwayInkState } from './useAwayInk.js';
export { AwayInk, DEFAULT_AWAY_CONFIG } from './awayInk.js';
export type { AwayInkConfig, AwayInkNative } from './awayInk.js';
export type { AwaySnapshot } from './awayNative.js';
export type { NativeStyle, NativeShowOptions, LocalStrokeEvent } from './native.js';

import { FLOATS_OVER_OTHER_APPS, Native } from './native.js';

/** True where the floating pen exists (Android and iOS builds that include
 * this package). */
export const isOutOfAppOverlaySupported = (): boolean => Native !== null;

/** True where the floating pen works over other apps (Android). On iOS it
 * floats over this app only. */
export const floatsOverOtherApps = (): boolean => Native !== null && FLOATS_OVER_OTHER_APPS;

/** "Display over other apps" is granted (always false where unsupported). */
export const canDrawOverlays = (): boolean => Native?.canDrawOverlays() ?? false;

/** Opens the system screen where the user grants "Display over other apps". */
export const requestOverlayPermission = (): void => {
  Native?.requestPermission();
};
