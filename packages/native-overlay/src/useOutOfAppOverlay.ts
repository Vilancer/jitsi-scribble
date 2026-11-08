// useOutOfAppOverlay(): the floating pen. On Android it works OUTSIDE the
// app, over every other app; on iOS (which lets no app draw over other apps)
// it floats over this app's own screens and hides while the app is in the
// background. Use it inside <ScribbleProvider>, typically on the screen that
// shares the phone's screen:
//
//   const overlay = useOutOfAppOverlay({ enabled: isSharingScreen });
//   if (overlay.supported && !overlay.permitted) <Button onPress={overlay.requestPermission} />
//
// While enabled (and, by default, while the app is in the background), a
// bubble floats over every app. Tapping it opens the drawing tools; the user
// draws over whatever is on screen, and the other side's ink appears there
// too. The toolbar and the in-app <ScribbleToolbar> share one tool state.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useScribble } from '@vilancer/scribble';
import { COLOUR_GRID, SCRIBBLE_COLOURS, SCRIBBLE_WIDTHS } from '@vilancer/scribble-protocol/render';
import { FADE_MS, HOLD_MS, STALE_MS } from '@vilancer/scribble-protocol/core';

import { OutOfAppBridge } from './bridge.js';
import { FLOATS_OVER_OTHER_APPS, Native, type NativeStyle } from './native.js';

export interface OutOfAppOverlayOptions {
  /** Master switch, e.g. "while I'm sharing my screen". Default true. */
  enabled?: boolean;
  /** 'background' (default): the bubble appears only while the app is in
   * the background and the in-app UI takes over when the user comes back.
   * 'always': also over this app. On iOS the pen can only float over this
   * app, so it shows only with 'always' (use useAwayInk() for the
   * background there). */
  showWhen?: 'background' | 'always';
  /** Keep the ink layer out of screenshots and screen recordings, so the
   * remote side doesn't see its own ink echoed back in the shared screen.
   * Uses FLAG_SECURE: on some devices that blacks out the WHOLE capture
   * while the ink layer is up, so test on your target devices. Default
   * false. */
  hideInkFromScreenShare?: boolean;
  /** Same for the bubble and toolbar. Default false. */
  hideControlsFromScreenShare?: boolean;
  /** The user dragged the bubble onto the ✕ at the bottom of the screen.
   * The pen is already gone; set your `enabled` switch to false here. It
   * stays hidden until `enabled` goes false and back to true. */
  onDismiss?: () => void;
}

export interface OutOfAppOverlayState {
  /** False on web, or if the native module isn't in this build. */
  supported: boolean;
  /** True where the pen floats over other apps (Android); false where it
   * floats over this app only (iOS). */
  overOtherApps: boolean;
  /** "Display over other apps" is granted. */
  permitted: boolean;
  /** Opens the system settings screen to grant the permission. */
  requestPermission: () => void;
  /** The bubble is on screen. */
  visible: boolean;
  /** The drawing tools are open (touches draw instead of reaching apps). */
  drawing: boolean;
  /** Open/close the tools programmatically. */
  setDrawing: (on: boolean) => void;
}

function toNativeStyle(t: { tool: string; color: string; width: number; shape: string | null }): NativeStyle {
  return { tool: t.tool, color: t.color, width: t.width, shape: t.shape };
}

export function useOutOfAppOverlay(options: OutOfAppOverlayOptions = {}): OutOfAppOverlayState {
  const {
    enabled = true,
    showWhen = 'background',
    hideInkFromScreenShare = false,
    hideControlsFromScreenShare = false,
  } = options;
  const onDismissRef = useRef(options.onDismiss);
  onDismissRef.current = options.onDismiss;
  const [dismissed, setDismissed] = useState(false);
  // Turning `enabled` off clears a dismissal, so the next "on" shows it.
  useEffect(() => {
    if (!enabled) setDismissed(false);
  }, [enabled]);
  const { client, tools, setTools } = useScribble();
  const supported = Native !== null;
  const [permitted, setPermitted] = useState(() => Native?.canDrawOverlays() ?? false);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [visible, setVisible] = useState(false);
  const [drawing, setDrawingState] = useState(false);
  const bridgeRef = useRef<OutOfAppBridge | null>(null);
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const setToolsRef = useRef(setTools);
  setToolsRef.current = setTools;

  // Re-check the permission whenever the user comes back (e.g. from the
  // settings screen requestPermission opened).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      setAppState(next);
      if (next === 'active' && Native) setPermitted(Native.canDrawOverlays());
    });
    return () => sub.remove();
  }, []);

  // One bridge per session.
  useEffect(() => {
    if (!Native || !client) return undefined;
    const bridge = new OutOfAppBridge(client, Native, {
      onStyleChange: (s) => {
        setToolsRef.current({
          tool: s.tool as never,
          color: s.color,
          width: s.width,
          shape: (s.shape ?? null) as never,
        });
      },
      onDismiss: () => {
        setDismissed(true);
        setVisible(false);
        setDrawingState(false);
        onDismissRef.current?.();
      },
      onStateChange: (s) => {
        setVisible(s.visible);
        setDrawingState(s.drawing);
      },
    });
    bridgeRef.current = bridge;
    return () => {
      bridge.dispose();
      bridgeRef.current = null;
    };
  }, [client]);

  // iOS: only over this app, so only while it is in the foreground.
  const placement = FLOATS_OVER_OTHER_APPS
    ? showWhen === 'always' || appState !== 'active'
    : showWhen === 'always' && appState === 'active';
  const wantVisible = supported && permitted && enabled && !dismissed && client !== null && placement;

  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    if (!wantVisible) {
      bridge.hide();
      setVisible(false);
      return;
    }
    void bridge
      .show({
      hideInkFromCapture: hideInkFromScreenShare,
      hideControlsFromCapture: hideControlsFromScreenShare,
      holdMs: client?.options.holdMs ?? HOLD_MS,
      fadeMs: client?.options.fadeMs ?? FADE_MS,
      staleMs: client?.options.staleMs ?? STALE_MS,
      swatches: [...SCRIBBLE_COLOURS],
      widths: [...SCRIBBLE_WIDTHS],
      grid: COLOUR_GRID.map((row) => [...row]),
      style: toNativeStyle(toolsRef.current),
      })
      .then((ok) => setVisible(ok));
  }, [wantVisible, hideInkFromScreenShare, hideControlsFromScreenShare, client]);

  // Keep the native toolbar in step with in-app tool changes.
  useEffect(() => {
    if (visible) bridgeRef.current?.setStyle(toNativeStyle(tools));
  }, [visible, tools]);

  const requestPermission = useCallback(() => {
    Native?.requestPermission();
  }, []);

  const setDrawing = useCallback((on: boolean) => {
    Native?.setDrawing(on);
  }, []);

  return { supported, overOtherApps: FLOATS_OVER_OTHER_APPS, permitted, requestPermission, visible, drawing, setDrawing };
}
