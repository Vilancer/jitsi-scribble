/**
 * App-wide browser polyfills — the small set of globals that code OUTSIDE the call
 * screen depends on, installed on every launch from `index.js`.
 *
 * Keep this file cheap: it runs before the first frame. Anything only lib-jitsi-meet
 * needs (WebRTC globals, a DOM, xmldom) belongs in `jitsiPolyfills` instead, which is
 * pulled in by `jitsiClient` and therefore only costs users who actually join a call.
 */

// URL / URLSearchParams (RN has neither natively). Supabase parses its own URL at
// client construction, so this must be installed app-wide, not per-feature.
import 'react-native-url-polyfill/auto';
// crypto.getRandomValues (uuid inside supabase-js and lib-jitsi-meet). Side-effect import.
import 'react-native-get-random-values';

import { decode as atobPolyfill, encode as btoaPolyfill } from 'base-64';

const g: any = globalThis as any;

// ── base64 (older Hermes builds lack reliable atob/btoa) ─────────────────────────
if (typeof g.atob === 'undefined') {
  g.atob = atobPolyfill;
}
if (typeof g.btoa === 'undefined') {
  g.btoa = btoaPolyfill;
}

// ── TextEncoder / TextDecoder ────────────────────────────────────────────────────
// Hermes ships neither, and both supabase-js (auth helpers, realtime binary frames)
// and lib-jitsi-meet's codec/e2ee paths reach for them. Eager assignment on purpose:
// a lazy getter buys nothing here — axios's fetch adapter destructures TextEncoder
// off the global at module scope, and apiClient imports axios at startup, so the
// ~530 KB `text-encoding` package parses during launch either way (and an accessor
// with no setter breaks strict-mode `global.TextEncoder = …` assignments, which
// `text-encoding` itself performs).
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const te = require('text-encoding');
  if (typeof g.TextEncoder === 'undefined') g.TextEncoder = te.TextEncoder;
  if (typeof g.TextDecoder === 'undefined') g.TextDecoder = te.TextDecoder;
} catch {
  // text-encoding not installed — only needed if an encode path actually runs.
}

export {};
