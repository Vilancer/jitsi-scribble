// The public barrel — side-effect-free, matching packages/web/src/index.ts's
// own convention (named re-exports only). useScribbleSession accepts a raw
// `conference: unknown` and constructs fromJitsiConference's adapter
// internally, so fromJitsiConference itself stays an internal implementation
// detail — not part of this package's public surface, mirroring how
// packages/web's own bootstrap-only usage of it is likewise unexported here
// (a host app that needs the lower-level ScribbleTransport seam directly can
// still reach useScribbleSession's `transport` option, which accepts any
// object satisfying @vilancer/protocol/transport's ScribbleTransport).
export { ScribbleOverlay } from './ScribbleOverlay.js';
export type { ScribbleOverlayProps } from './ScribbleOverlay.js';
export { useScribbleSession } from './useScribbleSession.js';
export type { UseScribbleSessionOptions, UseScribbleSessionResult } from './useScribbleSession.js';
export { InAppSurface, inAppSurface } from './surfaces/InAppSurface.js';
export type { Disposable, ScribbleSurface } from './surfaces/InAppSurface.js';
