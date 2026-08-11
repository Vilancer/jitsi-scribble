# example

A minimal Expo app that runs the real `@vilancer/react-native` package
(`ScribbleOverlay` + `useScribbleSession`) on a device, for the on-device
verification items Phase 5 couldn't automate — see the phase's `05-UAT.md`.

## What this is

- `ScribbleOverlay` wired with a **single, unwired `MemoryTransport`**
  (`@vilancer/protocol/transport`). `send()` on an unwired transport is a
  documented no-op — it never reaches a peer. There is **no second
  participant** in this build.
- Every stroke you see is your own touch, rendered through the real
  gesture worklet (`gesture.ts`), the real `StrokeStore` fade timing, and
  the real SVG rendering — exactly what Phase 5 shipped. Nothing here is a
  simplified stand-in for that part.
- A fake "call screen" (colored background + Mute/Hang up buttons) sits
  underneath the overlay, so you can check whether draw mode swallows taps
  meant for call controls.

## What this is NOT

- **Not a cross-device test.** There's no relay, no second phone, no real
  Jitsi conference. Anything about stroke delivery *between* participants
  is untested by this app.
- **Not a full close of the mute/hang-up-through-overlay item.** The fake
  call screen only proves the touch-pass-through mechanic (`pointerEvents`
  flipping with `drawModeEnabled`). It doesn't exercise a real Jitsi
  `JitsiMeeting`/`lib-jitsi-meet` call — that needs Phase 6's Genius_Native
  integration.

## Running it

```bash
# from the workspace root, once (already done if you're reading this after setup)
pnpm install

cd apps/example
npx expo run:android      # first run: prebuilds ./android, builds, installs, launches
```

Daily loop after the first native build:

```bash
adb reverse tcp:8081 tcp:8081
npx expo start --dev-client
```

Then reopen the app on the device (not Expo Go — this app has native modules
via `expo run:android`'s dev client).

## UAT checklist

Use this to work through Phase 5's `05-UAT.md` pending items:

1. **Latency** — tap the pencil FAB to enter draw mode, drag a finger across
   the screen, watch for lag between finger and stroke.
2. **Tap/drag feel** — try both a quick tap (should render as a tap ring,
   not a line) and a slow drag.
3. **Palm rejection** — rest a palm/second finger while drawing with another.
4. **Fade smoothness** — lift your finger after a stroke and watch it fade.
5. **Mute/hang-up pass-through** (partial, see above) — with draw mode OFF,
   confirm Mute/Hang up respond normally; with draw mode ON, confirm the
   overlay captures the touch instead (expected — that's `drawModeEnabled`
   working as designed, not a bug to fix).
