# @vilancer/scribble-overlay

The floating drawing pen that works outside your app (Android). While enabled, a round button floats
over every app; tap it and the drawing tools fan out around it, draw over whatever is on screen, and
the other side of the call sees it. Their ink appears over your screen too. It fades and tucks into
the screen edge when idle.

```tsx
const overlay = useOutOfAppOverlay({ enabled: isSharingScreen }); // inside <ScribbleProvider>
if (overlay.supported && !overlay.permitted) overlay.requestPermission();
```

To turn it off from the screen itself, drag the bubble onto the ✕ that appears at the bottom; `onDismiss` tells your app so its own switch can follow.

Options: `showWhen: 'background' | 'always'`, `onDismiss`, `hideInkFromScreenShare`,
`hideControlsFromScreenShare`. Needs a development build (it is an Expo module) and adds the
`SYSTEM_ALERT_WINDOW` permission. On iOS and web every export is a no-op (`supported: false`).
