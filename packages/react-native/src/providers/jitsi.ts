// The Jitsi transport provider: annotation frames ride lib-jitsi-meet's
// bridge data channel (endpoint messages), broadcast to every participant,
// so a Jibri recorder in the room sees them too.
//
//   const transport = useMemo(() => conference && jitsi(conference), [conference]);
//   <ScribbleProvider transport={transport}>…</ScribbleProvider>
//
// `conference` is the JitsiConference from lib-jitsi-meet (what
// `connection.initJitsiConference()` returns). This package never imports
// lib-jitsi-meet itself: the adapter probes the conference object at runtime
// and never throws, so a lib-jitsi-meet upgrade can't crash the call.
import type { ScribbleTransport } from '@vilancer/scribble-protocol/transport';

import { fromJitsiConference, type FromJitsiConferenceOptions } from '../fromJitsiConference.js';

export type JitsiProviderOptions = FromJitsiConferenceOptions;

export function jitsi(conference: unknown, options?: JitsiProviderOptions): ScribbleTransport {
  return fromJitsiConference(conference, options);
}
