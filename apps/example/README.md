# jitsi-scribble example

An Expo (SDK 55) app wired to the real packages.

- **Solo demo:** no server. A simulated participant draws every 4 s. Try the in-app toolbar
  ("Draw"), and the floating pen ("Floating pen"; on Android, then switch to any other app).
- **Join a Jitsi call:** a small lib-jitsi-meet client (no auth). Join the same room from a browser
  or another phone; share your screen and use the floating pen (Android: over other apps; iOS:
  over the app), or draw on the other side's video in the app.

## Run on an Android phone

```sh
pnpm install                      # from the repo root
cd apps/example
npx expo run:android              # first time: prebuild + build + install
# later:
adb reverse tcp:8081 tcp:8081 && npx expo start --dev-client
```

Allow "Display over other apps" when the banner asks (or
`adb shell appops set com.vilancer.jitsiscribbleexample SYSTEM_ALERT_WINDOW allow`).

## Run on an iPhone

On iOS the floating pen floats over the app itself (iOS lets no app draw over other apps). While
you share your screen and use other apps, the other side's ink shows in a picture-in-picture
window, a notification arrives when they start drawing, and it replays when you come back.

Screen sharing uses a ReplayKit broadcast extension plus an App Group (`plugins/withIosScreenShare.js`),
so it needs a paid Apple developer team. The app commits no team id; pass yours:

```sh
cd apps/example
APPLE_TEAM_ID=<team id> npx expo prebuild --platform ios --clean
npx expo run:ios --device          # or xcodebuild with -allowProvisioningUpdates
```

Share opens the system "Screen Broadcast" sheet; pick "Scribble Screen Share" and start it. The
first launch asks for local network access (the dev build loads JS from Metro on your Mac).

## A Jitsi server to test against

Any docker-jitsi-meet with `ENABLE_AUTH=0` works. The default server field
(`http://192.168.8.157:8000`, or `EXPO_PUBLIC_JITSI_SERVER`) points at a local one on the dev
machine's LAN. The phone connects over plain `ws://` on the LAN for this dev setup only.

`apps/e2e/scripts/peer.mjs` joins the same room as a headless browser participant: it logs every
annotation frame it receives, draws a test shape every few seconds, and saves screenshots.

```sh
cd apps/e2e
PEER_SERVER=https://<host>:8443 PEER_ROOM=scribble-demo node scripts/peer.mjs
```
