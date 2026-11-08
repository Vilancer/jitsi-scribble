# jitsi-scribble

[![CI](https://github.com/Vilancer/jitsi-scribble/actions/workflows/ci.yml/badge.svg)](https://github.com/Vilancer/jitsi-scribble/actions/workflows/ci.yml)

FaceTime-style drawing for video calls in React Native and Expo apps. During a call, one person
draws on what they see (usually the other person's **screen share**). The stroke shows up on the
other person's screen in real time and fades a few seconds later. It is a way to point at things,
not a whiteboard.

- **In the app:** an ink layer over the call video and a drawing toolbar with pen, marker, pencil
  and crayon, plus line, arrow, rectangle and ellipse, colours and sizes.
- **The floating pen:** a round button that stays on screen while you share your screen. Tap it
  and the tools fan out around it; draw anywhere, and whatever the other side draws shows up there
  too. When you're not using it, it fades and tucks into the screen edge. On **Android** it floats
  over every app; on **iOS** over your app's own screens (iOS lets no app draw over other apps).
- **Away from the app (iOS, optional):** a picture-in-picture window showing your shared screen
  with the other side's ink on it, a notification when they start drawing, and a replay of what
  they drew when you come back.
- **Call SDKs plug in as transport providers.** Jitsi (`lib-jitsi-meet`) is the first: strokes
  ride the conference's own bridge data channel, so there's no extra server.

## Packages

| Package | What it is | Status |
|---|---|---|
| [`@vilancer/scribble`](packages/react-native) | `ScribbleProvider`, `ScribbleOverlay`, `ScribbleToolbar`, the `jitsi()` provider. Pure JS. | [![npm](https://img.shields.io/npm/v/@vilancer/scribble)](https://www.npmjs.com/package/@vilancer/scribble) |
| [`@vilancer/scribble-overlay`](packages/native-overlay) | The floating pen (Android: over every app; iOS: over your app) and iOS away-from-app ink (PiP, notification, replay). Expo module. Optional. | [![npm](https://img.shields.io/npm/v/@vilancer/scribble-overlay)](https://www.npmjs.com/package/@vilancer/scribble-overlay) |
| [`@vilancer/scribble-protocol`](packages/protocol) | Wire format, stroke store, geometry, shapes. Used by the other packages. | [![npm](https://img.shields.io/npm/v/@vilancer/scribble-protocol)](https://www.npmjs.com/package/@vilancer/scribble-protocol) |
| [`@vilancer/scribble-web`](packages/web) | Renders the ink on jitsi-meet web (and so in Jibri recordings). | private |

> **Renamed in 0.2.0.** `@vilancer/react-native` → `@vilancer/scribble`,
> `@vilancer/native-overlay` → `@vilancer/scribble-overlay`, `@vilancer/protocol` →
> `@vilancer/scribble-protocol`. The old names stay at 0.1.0 and are deprecated.

## Install (Expo)

```sh
npx expo install react-native-svg react-native-gesture-handler react-native-reanimated react-native-worklets
npm install @vilancer/scribble @vilancer/scribble-protocol
# optional: the floating pen (Android: over every app, iOS: over your app)
npm install @vilancer/scribble-overlay
```

`@vilancer/scribble-overlay` contains native code, so it needs a development build
(`npx expo run:android` / `npx expo run:ios` or EAS), not Expo Go. On Android it adds the
`SYSTEM_ALERT_WINDOW` ("Display over other apps") permission to your app; the user grants it from
system settings, which `requestPermission()` opens. iOS needs no permission for the pen. For
`useAwayInk()` on iOS, the app needs the `audio` `UIBackgroundModes` entry (a call already keeps an
audio session alive) and a ReplayKit broadcast extension for screen sharing, which
`react-native-webrtc` requires anyway.

## Use

```tsx
import { useMemo, useState } from 'react';
import { ScribbleOverlay, ScribbleProvider, ScribbleToolbar, jitsi, useScribble } from '@vilancer/scribble';
import { useOutOfAppOverlay } from '@vilancer/scribble-overlay';

function CallScreen({ conference }) {
  // conference: the lib-jitsi-meet JitsiConference you joined
  const transport = useMemo(() => (conference ? jitsi(conference) : undefined), [conference]);
  return (
    <ScribbleProvider transport={transport}>
      <Stage />
    </ScribbleProvider>
  );
}

function Stage() {
  const { drawing, setDrawing } = useScribble();
  const [frameDims, setFrameDims] = useState();
  // The floating pen while this phone shares its screen and the app is in the background.
  const overlay = useOutOfAppOverlay({ enabled: isSharingScreen });

  return (
    <>
      <View style={{ flex: 1 }}>
        <RTCView
          streamURL={remoteVideoURL}
          objectFit="contain"
          style={{ flex: 1 }}
          onDimensionsChange={(e) => setFrameDims({ w: e.nativeEvent.width, h: e.nativeEvent.height })}
        />
        {/* a sibling of the video, same box; frameDims maps ink onto the letterboxed video */}
        <ScribbleOverlay frameDims={frameDims} />
      </View>
      {drawing && <ScribbleToolbar />}
      <Button title="Draw" onPress={() => setDrawing(!drawing)} />
      {overlay.supported && !overlay.permitted && <Button title="Allow drawing over other apps" onPress={overlay.requestPermission} />}
    </>
  );
}
```

Pass `p2p: { enabled: false }` when you create the Jitsi conference. Annotation travels on the
bridge's data channel, which a peer-to-peer call doesn't have.

### Other call SDKs

A transport provider is any object implementing `ScribbleTransport` (`send`, `subscribe`,
`localId`, `state`, `onStateChange`). Write one for your SDK's data channel and pass it to
`<ScribbleProvider transport={...}>`; nothing else changes. `MemoryTransport` /
`createMemoryTransportPair` are built in for tests and demos.

## Platform notes

- **Android** gets the in-app layer and the floating pen over other apps.
- **iOS** gets the in-app layer and the same floating pen, over the app's own screens only:
  iOS lets no app draw over other apps, so the pen hides while the app is in the background
  (`useOutOfAppOverlay().overOtherApps` is `false`, and it shows only with `showWhen: 'always'`).
  This is a deliberate, documented difference, not a gap that will be closed. For a sharer who
  has left the app, `useAwayInk()` shows the other side's ink in a picture-in-picture window
  (view only: iOS passes no touches into PiP), sends a notification when they start drawing, and
  replays it over a snapshot of the screen when the user comes back. The PiP window is part of
  the screen, so the broadcast captures it too.
- Some Android skins keep invisible system overlays above every app overlay. On ColorOS
  (Oppo/Realme/OnePlus), the floating assistant reserves a small area near the top-left; that
  patch can't be drawn on. System bars can't be drawn on either.
- The floating layer is captured in the screen share by default, so the other side also sees ink
  in the video. `hideInkFromScreenShare` / `hideControlsFromScreenShare` use `FLAG_SECURE`, which
  on some devices blacks out the whole capture; test on your target devices before turning it on.

## Privacy

Strokes are never stored on any server. They travel over the call's own data channel while the
call lasts and disappear after a few seconds.

## Try it

`apps/example` is an Expo app with a solo demo (a simulated participant draws with you) and a real
Jitsi call with screen sharing. See [apps/example/README.md](apps/example/README.md).

## Development

```sh
pnpm install
pnpm nx run-many -t typecheck lint test
```

## License

MIT
