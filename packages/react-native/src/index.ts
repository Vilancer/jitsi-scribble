// Public API. Side-effect free: named re-exports only.

// Session + UI
export { ScribbleProvider, useScribble, useOptionalScribble, DEFAULT_TOOL_STATE } from './ScribbleProvider.js';
export type { ScribbleProviderProps, ScribbleContextValue, ToolState } from './ScribbleProvider.js';
export { ScribbleOverlay } from './ScribbleOverlay.js';
export type { ScribbleOverlayProps } from './ScribbleOverlay.js';
export { ScribbleToolbar } from './ScribbleToolbar.js';
export type { ScribbleToolbarProps } from './ScribbleToolbar.js';
export { ScribbleClient } from './client.js';
export type { ScribbleClientOptions, InboundListener, PresenceListener } from './client.js';

// Transport providers (one per call SDK)
export { jitsi } from './providers/jitsi.js';
export type { JitsiProviderOptions } from './providers/jitsi.js';
export { MemoryTransport, createMemoryTransportPair } from './providers/memory.js';
export type { ScribbleTransport, TransportState } from '@vilancer/protocol/transport';

// Lower-level pieces (Phase 5 API, still supported)
export { fromJitsiConference } from './fromJitsiConference.js';
export type { FromJitsiConferenceOptions } from './fromJitsiConference.js';
export { useScribbleSession } from './useScribbleSession.js';
export type { UseScribbleSessionOptions, UseScribbleSessionResult } from './useScribbleSession.js';
export { InAppSurface, inAppSurface } from './surfaces/InAppSurface.js';
export type { Disposable, ScribbleSurface } from './surfaces/InAppSurface.js';
