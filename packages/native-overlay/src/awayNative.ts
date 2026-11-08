// Typed handle on the iOS native module (ios/ScribbleAwayModule.swift). `null`
// wherever it isn't there (Android, web, Expo Go, a build without this
// package), so callers degrade to "not supported".
import { Platform } from 'react-native';
import { requireOptionalNativeModule, type NativeModule } from 'expo';

import type { RemoteInkTarget } from './bridge.js';

export interface AwaySnapshot {
  /** file:// URI of a JPEG of this phone's screen. */
  uri: string;
  width: number;
  height: number;
}

export type AwayEvents = {
  onPipChange: (e: { active: boolean; error?: string }) => void;
};

declare class ScribbleAwayNative extends NativeModule<AwayEvents> implements RemoteInkTarget {
  isPipSupported(): boolean;
  isPipActive(): boolean;
  notificationPermission(): Promise<'granted' | 'denied' | 'undetermined'>;
  requestNotificationPermission(): Promise<boolean>;
  notify(title: string, body: string): void;
  pipEnable(options: { holdMs?: number; fadeMs?: number; staleMs?: number }): Promise<boolean>;
  pipDisable(): Promise<void>;
  attachShareTrack(trackId: string | null): Promise<boolean>;
  snapshot(): Promise<AwaySnapshot | null>;
  deleteSnapshots(): void;
  remoteBegin(key: string, u: number, v: number, color: string | null, width: number | null, tool: string | null): void;
  remoteAppend(key: string, points: number[]): void;
  remoteEnd(key: string, kind: string | null): void;
  clear(scope: string): void;
  clearSender(from: string): void;
}

export type AwayNative = ScribbleAwayNative;

export const AwayNativeModule: ScribbleAwayNative | null =
  Platform.OS === 'ios' ? requireOptionalNativeModule<ScribbleAwayNative>('ScribbleAway') : null;
