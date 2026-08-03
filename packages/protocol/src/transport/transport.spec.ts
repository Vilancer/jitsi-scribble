import { describe, expect, it } from 'vitest';

import { createMemoryTransportPair, MemoryTransport } from './index.js';
import type { ScribbleTransport, TransportState } from './index.js';

describe('ScribbleTransport (compile-time arity check)', () => {
  it("send has exactly one parameter — a call site passing a second argument is a compile error", () => {
    const transport: ScribbleTransport = new MemoryTransport('x');
    // @ts-expect-error — ScribbleTransport.send must have exactly one parameter (PROTO-02); a second
    // (targeting) argument is precisely the per-peer targeting this port structurally forbids.
    transport.send({ hello: 'world' }, 'some-peer-id');
    // The non-erroring call proves the interface still accepts the single-argument form.
    expect(() => transport.send({ hello: 'world' })).not.toThrow();
  });
});

describe('MemoryTransport', () => {
  it('send(payload) before any subscribe() call does not throw', () => {
    const transport = new MemoryTransport('a');
    expect(() => transport.send({ x: 1 })).not.toThrow();
  });

  it('subscribe() with zero prior sends does not throw', () => {
    const transport = new MemoryTransport('a');
    expect(() => transport.subscribe(() => {})).not.toThrow();
  });

  it('createMemoryTransportPair delivers broadcast (not targeted) messages between two peers', () => {
    const [a, b] = createMemoryTransportPair('a', 'b');
    const receivedByB: Array<{ from: string; payload: unknown }> = [];
    const receivedByA: Array<{ from: string; payload: unknown }> = [];
    b.subscribe((from, payload) => receivedByB.push({ from, payload }));
    a.subscribe((from, payload) => receivedByA.push({ from, payload }));

    a.send({ msg: 'from-a' });
    expect(receivedByB).toEqual([{ from: 'a', payload: { msg: 'from-a' } }]);

    b.send({ msg: 'from-b' });
    expect(receivedByA).toEqual([{ from: 'b', payload: { msg: 'from-b' } }]);
  });

  it('subscribe() returns an unsubscribe function; after unsubscribing, further sends do not invoke it', () => {
    const [a, b] = createMemoryTransportPair('a', 'b');
    const received: unknown[] = [];
    const unsubscribe = b.subscribe((_from, payload) => received.push(payload));

    a.send('first');
    expect(received).toEqual(['first']);

    unsubscribe();
    a.send('second');
    expect(received).toEqual(['first']);
  });

  it("state starts 'connecting'; a state-setting call transitions it and fires onStateChange", () => {
    const transport = new MemoryTransport('a');
    expect(transport.state).toBe('connecting');

    const seen: TransportState[] = [];
    transport.onStateChange((s) => seen.push(s));

    transport.setState('ready');
    expect(transport.state).toBe('ready');
    expect(seen).toEqual(['ready']);

    transport.setState('degraded');
    transport.setState('closed');
    expect(seen).toEqual(['ready', 'degraded', 'closed']);
  });

  it('localId() returns the id the transport was constructed with', () => {
    const transport = new MemoryTransport('my-id');
    expect(transport.localId()).toBe('my-id');
  });
});
