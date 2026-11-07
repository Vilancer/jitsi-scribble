// Typed handle on the Android native module. `null` wherever the native code
// isn't there (iOS, web, Expo Go, or an app built before this package was
// added), so every caller degrades to "not supported" instead of crashing.
import { Platform } from 'react-native';
import { requireOptionalNativeModule, type NativeModule } from 'expo';

export interface NativeStyle {
  tool: string;
  color: string;
  width: number;
  shape?: string | null;
}

export interface NativeShowOptions {
  hideInkFromCapture: boolean;
  hideControlsFromCapture: boolean;
  holdMs: number;
  fadeMs: number;
  staleMs: number;
  swatches?: string[];
  widths?: number[];
  grid?: string[][];
  style?: NativeStyle;
}

export type LocalStrokeEvent =
  | ({ phase: 'begin'; id: string; points: number[]; frameW: number; frameH: number } & NativeStyle)
  | { phase: 'append'; id: string; points: number[] }
  | { phase: 'end'; id: string; kind: 'tap' | 'stroke' }
  | ({ phase: 'shape'; id: string; points: number[]; frameW: number; frameH: number } & NativeStyle);

export type OverlayEvents = {
  onLocalStroke: (e: LocalStrokeEvent) => void;
  onStyleChange: (e: NativeStyle) => void;
  onAction: (e: { action: 'clear' }) => void;
  onStateChange: (e: { visible: boolean; drawing: boolean }) => void;
};

declare class ScribbleOverlayNative extends NativeModule<OverlayEvents> {
  canDrawOverlays(): boolean;
  requestPermission(): boolean;
  show(options: NativeShowOptions): Promise<boolean>;
  hide(): void;
  isShowing(): boolean;
  setDrawing(on: boolean): void;
  setStyle(style: NativeStyle): void;
  remoteBegin(key: string, u: number, v: number, color: string | null, width: number | null, tool: string | null): void;
  remoteAppend(key: string, points: number[]): void;
  remoteEnd(key: string, kind: string | null): void;
  clear(scope: string): void;
}

export const Native: ScribbleOverlayNative | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<ScribbleOverlayNative>('ScribbleOverlay') : null;
