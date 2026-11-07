/**
 * lib-jitsi-meet browser-environment polyfills for React Native (Hermes / New Arch).
 *
 * lib-jitsi-meet is the same pure-JS conferencing engine that powers Jitsi web. It
 * assumes a browser: WebRTC globals, a DOM (for strophe.js XMPP stanza parsing),
 * `navigator.userAgent`, etc. The official @jitsi/react-native-sdk ships a polyfill
 * layer to satisfy these; we cannot use that SDK (its native UI modules crash on RN
 * 0.83's forced New Architecture — `mTurboModuleRegistry`), so this module recreates
 * the *JS* polyfill layer instead.
 *
 * MUST be evaluated before anything that touches lib-jitsi-meet. That ordering is
 * enforced by the module graph, not by convention: `jitsiClient` imports this file
 * ahead of `JitsiMeetJS`, so it cannot be loaded out of order. Nothing else should
 * import it — the whole WebRTC + xmldom stack costs a call-screen entry, not a launch.
 * App-wide shims (URL, getRandomValues, atob, TextEncoder) live in `polyfills.ts`.
 *
 * If a missing global surfaces (symptom: connects but never joins the MUC, or a
 * red-box referencing `document`/`navigator`/`DOMParser`), add the shim here — this
 * file is the single source of truth for the browser environment LJM sees.
 */
import { LogBox } from 'react-native';
import { DOMParser, XMLSerializer, DOMImplementation } from '@xmldom/xmldom';
const { installXmlQuerySelector } = require('./jitsiXmlQuerySelector');
// registerGlobals installs RTCPeerConnection, RTCSessionDescription, RTCIceCandidate,
// MediaStream, MediaStreamTrack, and navigator.mediaDevices (getUserMedia /
// getDisplayMedia / enumerateDevices) onto the global scope.
import { registerGlobals } from 'react-native-webrtc';

const g: any = globalThis as any;

// ── window ────────────────────────────────────────────────────────────────────
// Many browser libs branch on `window`. In RN, `global` is the closest analogue.
if (typeof g.window === 'undefined') {
  g.window = g;
}

// lib-jitsi-meet's connect() registers DOM event listeners on `window`
// (online/offline for network-change detection, unload/pagehide for cleanup).
// RN's global has no DOM event API, so these throw ("window.addEventListener is
// not a function") before the XMPP websocket is ever opened. Stub them as no-ops
// — network-change-driven reconnect is a later hardening item (A1 treats a
// dropped connection as `failed`), and unload has no meaning in RN.
if (typeof g.addEventListener !== 'function') {
  g.addEventListener = () => {};
}
if (typeof g.removeEventListener !== 'function') {
  g.removeEventListener = () => {};
}
if (typeof g.dispatchEvent !== 'function') {
  g.dispatchEvent = () => false;
}

// ── WebRTC ──────────────────────────────────────────────────────────────────────
registerGlobals();

// ── navigator ─────────────────────────────────────────────────────────────────
// @jitsi/js-utils browser-detection keys off userAgent/product; give it a stable UA
// so it resolves to a defined branch (rather than throwing on `undefined.match`).
if (typeof g.navigator === 'undefined') {
  g.navigator = {};
}
if (!g.navigator.userAgent) {
  g.navigator.userAgent = 'react-native';
}
if (!g.navigator.product) {
  g.navigator.product = 'ReactNative';
}

// ── DOM (for strophe.js XMPP-over-WebSocket stanza parsing) ─────────────────────
// strophe parses every inbound XMPP frame into an XML document and builds outbound
// stanzas via document.createElement/implementation.createDocument. @xmldom/xmldom
// provides a spec-ish DOM. This is the highest-risk polyfill — subtle API gaps here
// show up as silent stanza-parse failures ("connects but never joins the room").
if (typeof g.DOMParser === 'undefined') {
  g.DOMParser = DOMParser;
}
if (typeof g.XMLSerializer === 'undefined') {
  g.XMLSerializer = XMLSerializer;
}

// @xmldom/xmldom nodes lack querySelector/querySelectorAll/children, which modern
// lib-jitsi-meet's XMLUtils uses to parse every inbound stanza. Patch them onto the
// xmldom prototypes (must happen before any stanza is parsed). Without this the client
// connects but never joins ("Conference request response contained no focusJid").
installXmlQuerySelector();

// NOTE: installing `window`/`document` here (first call-screen entry, not launch)
// flips `typeof window !== 'undefined'`-style browser detection — e.g.
// @supabase/auth-js's isBrowser() — from false to true for the REST of the session.
// That's deliberate: at launch supabase must see a non-browser env (its visibility-
// based token auto-refresh would otherwise never start), and the app calls no auth
// method that branches on isBrowser() at runtime. The visibility fields below give
// any late browser-branch code sane "always in the foreground" values.
if (typeof g.document === 'undefined') {
  const domImpl = new DOMImplementation();
  // An XML document strophe can clone elements from; also carries the minimal
  // surface (currentScript, head, createElement) some LJM helpers read at load time.
  const xmlDoc: any = domImpl.createDocument(null, null, null);
  g.document = {
    implementation: domImpl,
    // `current-executing-script` (an LJM dep) reads document.currentScript at import.
    currentScript: null,
    visibilityState: 'visible',
    hidden: false,
    createElement: (name: string) => xmlDoc.createElement(name),
    createElementNS: (ns: string, name: string) => xmlDoc.createElementNS(ns, name),
    createTextNode: (text: string) => xmlDoc.createTextNode(text),
    getElementsByTagName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    head: null,
  };
}

// ── log noise ─────────────────────────────────────────────────────────────────
// Silence known-benign lib-jitsi-meet output so the dev LogBox overlay stops covering
// the in-call controls. These do NOT affect the call:
//  - extdisco:1/:2 "service-unavailable": this Jitsi deployment advertises no TURN
//    server (calls connect via the JVB's public IP + STUN); harmless.
//  - findAll ':scope>services>service': lib-jitsi-meet runs its STUN/TURN parser over
//    a room-metadata object that isn't an XML element; the shim installed above
//    catches it and returns [].
LogBox.ignoreLogs([
  /get STUN\/TURN credentials/,
  /getting turn credentials/,
  /mod_turncredentials/,
  /findAll error: :scope>services>service/,
  /Local storage is disabled/,
  // A frame sent before the bridge channel opens; jitsi-scribble's transport
  // drops it and recovers when the channel opens.
  /Bridge Channel send: no opened channel/,
]);

export {};
