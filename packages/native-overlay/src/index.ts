// @vilancer/scribble-overlay — the floating drawing button that works outside
// the app (Android "display over other apps"). Optional companion to
// @vilancer/scribble; on iOS and web every export is a safe no-op
// (`supported: false`).
export { useOutOfAppOverlay } from './useOutOfAppOverlay.js';
export type { OutOfAppOverlayOptions, OutOfAppOverlayState } from './useOutOfAppOverlay.js';
export { OutOfAppBridge } from './bridge.js';
export type { OutOfAppBridgeOptions, OverlayNative } from './bridge.js';
export type { NativeStyle, NativeShowOptions, LocalStrokeEvent } from './native.js';

import { Native } from './native.js';

/** True where the native overlay exists (Android builds that include this
 * package). */
export const isOutOfAppOverlaySupported = (): boolean => Native !== null;

/** "Display over other apps" is granted (always false where unsupported). */
export const canDrawOverlays = (): boolean => Native?.canDrawOverlays() ?? false;

/** Opens the system screen where the user grants "Display over other apps". */
export const requestOverlayPermission = (): void => {
  Native?.requestPermission();
};
