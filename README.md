# jitsi-scribble

[![CI](https://github.com/Vilancer/jitsi-scribble/actions/workflows/ci.yml/badge.svg)](https://github.com/Vilancer/jitsi-scribble/actions/workflows/ci.yml)

FaceTime-style ephemeral touch annotation for Jitsi calls. One participant draws on what they
see — primarily a **screen share** — and the other sees the stroke appear in real time and
fade a few seconds later. It's deliberately not a persistent whiteboard.

Ships as an Nx monorepo (React Native client, web/DOM renderer, shared protocol), published
open source on npm, proven in production by Genius_Native's teacher↔student video sessions.

**Core value:** during a live call, one person can point at a specific spot on the other
person's screen and the other person actually sees where they mean — on Android, iOS, and in
the session recording.

## Status

This project is under active development. Current state, package by package:

| Package | npm | Status |
|---|---|---|
| [`@vilancer/protocol`](packages/protocol) | [![npm](https://img.shields.io/npm/v/@vilancer/protocol)](https://www.npmjs.com/package/@vilancer/protocol) | **Published** (still at `0.0.1` — not yet re-published with Phase 3's additions below). Coordinate normalization, wire protocol schema/codec, transport, and a render-agnostic stroke-lifecycle store (start/move/end/clear, hold/fade timing, defensive caps, rate limiting, outbound move coalescing) — the shared foundation the client and web renderer build on. |
| [`@vilancer/react-native`](packages/react-native) | — | Private, unpublished. Renamed from the workspace-scaffold placeholder `jitsi-scribble`. Toolchain (dependencies, `bob`-based build target, `jest`/`jest-expo` test target, `.tsx` lint coverage), DRAW-03's tested tap/drag classifier (`classifyGesture`), the local-echo touch-capture worklet (`gesture.ts` — append-only UI-thread path string, fixed-capacity point ring buffer), RN content-rect measurement (`contentRect.native.ts`), the RN Jitsi transport adapter (`fromJitsiConference.ts`, mirroring the web adapter's probe/never-throw contract), the always-available `InAppSurface`, and `useScribbleSession` (transport↔store orchestration, presence via `AppState`, host callbacks, closing the Presence-frame rate-limit and from-field-spoofing gaps flagged for this phase) all now stand up end to end. The minimal real `<ScribbleOverlay>` placeholder still exists as-is; wiring the above into a rendered component is the next plan's job. |
| [`@vilancer/web`](packages/web) (DOM renderer) | — | Private, unpublished. Real content shipped in Phase 4: a probing, never-throwing `fromJitsiConference` transport adapter over `lib-jitsi-meet`'s data channel, a resize-reactive SVG renderer mounted over jitsi-meet's `#largeVideo` (one remote stroke renders end to end, proven by a jsdom-based three-assertion smoke test matching ARCHITECTURE.md's real-deployment contract), and a fully-tested `try`/`catch`-wrapped bootstrap entry point (duplicate-injection guard, silent mount-failure isolation, identifiable startup log). `pnpm nx build web` produces both `dist/jitsi-scribble.js` (ES) and `dist/jitsi-scribble.iife.js` (IIFE) — the actual browser-injectable bundle. Deployment (the real `custom-config.js`/nginx mount, a real Jibri recording) is a later phase's job. |
| `@jitsi-scribble/native-overlay` | — | Placeholder. Android out-of-app overlay (Expo module + config plugin) lands in a later phase. iOS gets a different, PiP-composited approach instead — see [Platform notes](#platform-notes). |

Only `@vilancer/protocol` is published today; the other packages are private until their
phases ship.

## Install

```sh
npm install @vilancer/protocol
```

Subpath imports, so you only pull in what you use:

```ts
import { encode, decode } from '@vilancer/protocol/codec';
import { contentRect, mapTouchToContent } from '@vilancer/protocol/geometry';
import { MemoryTransport, createMemoryTransportPair } from '@vilancer/protocol/transport';
import { StrokeStore } from '@vilancer/protocol/core';
import type { StartFrame } from '@vilancer/protocol/schema';
```

Don't import from the bare package root (`@vilancer/protocol`) on React Native unless you
also need `/schema` — see [Privacy & platform notes](#privacy) for why.

## Privacy

Strokes are never persisted server-side. They're relayed peer-to-peer over the existing Jitsi
conference data channel for the duration of the call and then gone — no whiteboard history, no
server-side storage. If a transport outside the conference is ever added, it will be
`wss://`/TLS only.

## Platform notes

Android and iOS parity is the goal, but iOS can't match Android's system-wide overlay.
Android uses a `SYSTEM_ALERT_WINDOW` overlay; iOS composites into the
`AVPictureInPictureVideoCallViewController` that `RTCPIPView` already hosts. This asymmetry is
a deliberate, documented product decision, not an oversight.

## Development

```sh
pnpm install
pnpm nx run-many -t typecheck lint test
```

## License

MIT
