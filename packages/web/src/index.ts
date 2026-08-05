// The public barrel — side-effect-free. Deliberately does NOT re-export
// bootstrap.ts: its side effect (calling whenConference at module
// evaluation) must only fire when the IIFE build's own entry is evaluated
// (Plan 04-03), never on a bare `import { ... } from '@vilancer/web'`.
export { fromJitsiConference } from './transport/fromJitsiConference.js';
export type { FromJitsiConferenceOptions } from './transport/fromJitsiConference.js';
export { mountScribbleOverlay } from './mount.js';
export type { ScribbleOverlayHandle } from './mount.js';
