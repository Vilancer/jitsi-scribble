// useAwayInk(): the iOS counterpart of the floating pen. iOS lets no app draw
// over other apps, so a sharer who leaves the app gets, instead:
//
//   - a picture-in-picture window: their own screen with the other side's
//     ink on it, live (opens by itself when the app goes to the background);
//   - a vibration (and a Notification Center entry) when someone starts
//     drawing; iOS shows no banner while the screen is being shared;
//   - when they come back, each burst of ink replayed over a snapshot of
//     what their screen showed at that moment.
//
// Use it inside <ScribbleProvider>, on the screen that shares the phone's
// screen, and render the replay:
//
//   const away = useAwayInk({ enabled: sharing, shareTrackId });
//   {away.replaying && (
//     <>
//       <Image source={{ uri: away.replaying.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
//       <ScribbleOverlay frameDims={{ w: away.replaying.width, h: away.replaying.height }} />
//     </>
//   )}
//
// The app needs the "audio" UIBackgroundMode (a call already keeps an audio
// session alive, which is what keeps both the share and this running).
// On Android and web every field is inert (`supported: false`): use
// useOutOfAppOverlay() there.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useScribble } from '@vilancer/scribble';
import { FADE_MS, HOLD_MS, STALE_MS } from '@vilancer/scribble-protocol/core';

import { AwayInk, DEFAULT_AWAY_CONFIG } from './awayInk.js';
import { AwayNativeModule, type AwaySnapshot } from './awayNative.js';

export interface AwayInkOptions {
  /** Master switch, e.g. "while I'm sharing my screen". Default true. */
  enabled?: boolean;
  /** The MediaStreamTrack id of this phone's screen-share track. Gives the
   * PiP window and the replay a picture of the screen under the ink; without
   * it the PiP shows the ink on black and nothing is replayed. */
  shareTrackId?: string | null;
  /** Show the picture-in-picture window while away. Default true. */
  pictureInPicture?: boolean;
  /** Notification when someone starts drawing while away; false for none.
   * Asks for permission the first time `enabled` turns on. */
  notify?: boolean | { title?: string; body?: string };
  /** Replay ink received while away when the user comes back. Default true. */
  replay?: boolean;
}

export interface AwayInkState {
  /** True on iOS builds that include this package. */
  supported: boolean;
  pipSupported: boolean;
  /** The PiP window is on screen. */
  pipActive: boolean;
  /** Why the PiP window couldn't open, if it couldn't. */
  pipError: string | null;
  /** Notifications are allowed (null until known). */
  notificationsAllowed: boolean | null;
  /** While ink is replayed: the snapshot to draw it over. */
  replaying: AwaySnapshot | null;
  /** Stops the replay and drops what was left. */
  skipReplay: () => void;
}

export function useAwayInk(options: AwayInkOptions = {}): AwayInkState {
  const { enabled = true, shareTrackId = null, pictureInPicture = true, notify = true, replay = true } = options;
  const native = AwayNativeModule;
  const { client } = useScribble();
  const supported = native !== null;
  const [pipSupported] = useState(() => native?.isPipSupported() ?? false);
  const [pipActive, setPipActive] = useState(false);
  const [pipError, setPipError] = useState<string | null>(null);
  const [notificationsAllowed, setNotificationsAllowed] = useState<boolean | null>(null);
  const [replaying, setReplaying] = useState<AwaySnapshot | null>(null);
  const awayRef = useRef<AwayInk | null>(null);
  const on = supported && enabled && client !== null;

  const notifyTitle = typeof notify === 'object' ? notify.title : undefined;
  const notifyBody = typeof notify === 'object' ? notify.body : undefined;
  const notifyOn = notify !== false;

  // One AwayInk per session (and per config).
  useEffect(() => {
    if (!on || !native || !client) return undefined;
    const defaults = DEFAULT_AWAY_CONFIG.notify || { title: '', body: '' };
    const away = new AwayInk(
      client,
      native,
      {
        ...DEFAULT_AWAY_CONFIG,
        replay,
        notify: notifyOn ? { title: notifyTitle ?? defaults.title, body: notifyBody ?? defaults.body } : false,
      },
      setReplaying,
    );
    awayRef.current = away;
    // 'inactive' (the broadcast sheet, Control Center) is not away.
    away.setAway(AppState.currentState === 'background');
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') away.setAway(true);
      else if (next === 'active') away.setAway(false);
    });
    return () => {
      sub.remove();
      away.dispose();
      awayRef.current = null;
      setReplaying(null);
    };
  }, [on, native, client, replay, notifyOn, notifyTitle, notifyBody]);

  // Ask for notification permission once the feature is actually in use.
  useEffect(() => {
    if (!on || !native || !notifyOn) return;
    let cancelled = false;
    void native.notificationPermission().then(async (status) => {
      const allowed = status === 'undetermined' ? await native.requestNotificationPermission() : status === 'granted';
      if (!cancelled) setNotificationsAllowed(allowed);
    });
    return () => {
      cancelled = true;
    };
  }, [on, native, notifyOn]);

  // The picture under the ink.
  useEffect(() => {
    if (!on || !native) return undefined;
    void native.attachShareTrack(shareTrackId ?? null);
    return () => {
      void native.attachShareTrack(null);
    };
  }, [on, native, shareTrackId]);

  // Arm the PiP window (it opens by itself in the background).
  useEffect(() => {
    if (!on || !native || !pictureInPicture || !pipSupported) return undefined;
    const sub = native.addListener('onPipChange', (e) => {
      setPipActive(e.active);
      setPipError(e.error ?? null);
      awayRef.current?.setPipActive(e.active);
    });
    void native
      .pipEnable({
        holdMs: client?.options.holdMs ?? HOLD_MS,
        fadeMs: client?.options.fadeMs ?? FADE_MS,
        staleMs: client?.options.staleMs ?? STALE_MS,
      })
      .then((ok) => {
        if (!ok) setPipError('Picture in picture is not available here.');
      });
    return () => {
      sub.remove();
      void native.pipDisable();
      setPipActive(false);
      awayRef.current?.setPipActive(false);
    };
  }, [on, native, pictureInPicture, pipSupported, client]);

  const skipReplay = useCallback(() => awayRef.current?.skipReplay(), []);

  return { supported, pipSupported, pipActive, pipError, notificationsAllowed, replaying, skipReplay };
}
