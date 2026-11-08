# @vilancer/scribble-overlay

The floating drawing pen for [`@vilancer/scribble`](../react-native) calls. While enabled, a round
button floats on screen; tap it and the drawing tools fan out around it, draw over whatever is on
screen, and the other side of the call sees it. Their ink appears over your screen too. It fades
and tucks into the screen edge when idle.

- **Android:** floats over every app (the "Display over other apps" permission).
- **iOS:** floats over your app's own screens. iOS lets no app draw over other apps, so it hides
  while your app is in the background and comes back with it.

```tsx
const overlay = useOutOfAppOverlay({ enabled: isSharingScreen }); // inside <ScribbleProvider>
if (overlay.supported && !overlay.permitted) overlay.requestPermission(); // Android only
```

To turn it off from the screen itself, drag the bubble onto the ✕ that appears at the bottom; `onDismiss` tells your app so its own switch can follow.

Options: `showWhen: 'background' | 'always'` (iOS shows the pen only with `'always'`), `onDismiss`,
`hideInkFromScreenShare`, `hideControlsFromScreenShare` (Android). Needs a development build (it is
an Expo module). On Android it adds the `SYSTEM_ALERT_WINDOW` permission; iOS needs none.

## iOS: away from the app (optional)

`useAwayInk()` covers a sharer who has left the app, where iOS allows no drawing:

- a picture-in-picture window with their shared screen and the other side's live ink (view only),
- a vibration once per burst of drawing, plus an entry in Notification Center (iOS shows no
  banner while the screen is being shared: "Posting not permitted during screen sharing"),
- a replay of that ink over a snapshot of the screen when they come back.

```tsx
const away = useAwayInk({ enabled: isSharingScreen, shareTrackId }); // MediaStreamTrack id of the share
{away.replaying && (
  <>
    <Image source={{ uri: away.replaying.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
    <ScribbleOverlay frameDims={{ w: away.replaying.width, h: away.replaying.height }} />
  </>
)}
```

It needs the `audio` `UIBackgroundModes` entry. It works with any transport provider; the picture
under the ink comes from `react-native-webrtc`'s local screen-share track, looked up at runtime (no
build-time dependency). On Android and web it is a no-op (`supported: false`).
