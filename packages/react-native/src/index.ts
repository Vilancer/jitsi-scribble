// The public barrel — side-effect-free, matching packages/web/src/index.ts's
// own convention (named re-exports only). fromJitsiConference is exported
// (mirroring packages/web's barrel) so a consumer outside this monorepo can
// build the probing adapter itself and hand the resulting ScribbleTransport
// to useScribbleSession's `transport` option — INTEG-03's literal wording
// (Genius_Native's useJitsiConference constructs the transport, not the
// overlay).
export { fromJitsiConference } from './fromJitsiConference.js';
export type { FromJitsiConferenceOptions } from './fromJitsiConference.js';
export { ScribbleOverlay } from './ScribbleOverlay.js';
export type { ScribbleOverlayProps } from './ScribbleOverlay.js';
export { useScribbleSession } from './useScribbleSession.js';
export type { UseScribbleSessionOptions, UseScribbleSessionResult } from './useScribbleSession.js';
export { InAppSurface, inAppSurface } from './surfaces/InAppSurface.js';
export type { Disposable, ScribbleSurface } from './surfaces/InAppSurface.js';
