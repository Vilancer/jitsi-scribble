// The final, concrete proof that the whole @vilancer/protocol subpath
// surface — not just the root — is importable under plain node with zero
// platform dependency (PKG-02), now that every subpath carries real Wave-2
// content (Plans 02-02/02-03) instead of Plan 02-01's placeholder-only
// wiring. Exercises one real call against codec, geometry, and transport.

import { encode, decode } from '@vilancer/protocol/codec';
import { contentRect, mapTouchToContent } from '@vilancer/protocol/geometry';
import { MemoryTransport, createMemoryTransportPair } from '@vilancer/protocol/transport';
import type { StartFrame } from '@vilancer/protocol/schema';

function fail(message: string): never {
  throw new Error(message);
}

// --- codec: one real StartFrame, encode then decode, assert round trip ---
const startFrame: StartFrame = {
  v: 1,
  t: 's',
  from: 'teacher-1',
  id: 'stroke-1',
  p: [2048, 1024],
  frame: { w: 1920, h: 1080 },
};

const decoded = decode(encode(startFrame));
if (!decoded.ok) fail(`codec: decode(encode(startFrame)) failed with ${decoded.error}`);
if (JSON.stringify(decoded.frame) !== JSON.stringify(startFrame)) {
  fail('codec: round-tripped frame is not structurally equal to the original');
}
console.log('codec: OK');

// --- geometry: one real contentRect + mapTouchToContent call ---
const rect = contentRect(1920, 1080, 1280, 720, 'contain');
if (!(rect.w > 0 && rect.h > 0)) fail('geometry: contentRect produced a degenerate rect for valid input');

const mapped = mapTouchToContent(rect.x + rect.w / 2, rect.y + rect.h / 2, rect, { isStart: true });
if (!mapped.ok) fail(`geometry: mapTouchToContent rejected a center-of-content touch: ${mapped.reason}`);
if (Math.abs(mapped.point.u - 0.5) > 1e-9 || Math.abs(mapped.point.v - 0.5) > 1e-9) {
  fail('geometry: mapTouchToContent did not normalize the content-rect center to (0.5, 0.5)');
}
console.log('geometry: OK');

// --- transport: createMemoryTransportPair, send one message end to end ---
const [a, b] = createMemoryTransportPair('participant-a', 'participant-b');
if (!(a instanceof MemoryTransport) || !(b instanceof MemoryTransport)) {
  fail('transport: createMemoryTransportPair did not return MemoryTransport instances');
}

let received: { from: string; payload: unknown } | undefined;
b.subscribe((from, payload) => {
  received = { from, payload };
});

const wireMessage = encode(startFrame);
a.send(wireMessage);

if (!received) fail('transport: participant B never received the message sent by participant A');
if (received.from !== 'participant-a') fail(`transport: received message reports wrong sender: ${received.from}`);
if (received.payload !== wireMessage) fail('transport: received payload does not match the sent payload');
console.log('transport: OK');
