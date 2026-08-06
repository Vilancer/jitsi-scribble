import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { encode } from '@vilancer/protocol/codec';
import { MSG_END, MSG_PRESENCE, MSG_START, PROTOCOL_VERSION, RATE_CAPACITY } from '@vilancer/protocol/core';
import type { ScribbleTransport, TransportState } from '@vilancer/protocol/transport';

import { useScribbleSession } from './useScribbleSession.js';

/**
 * A hand-built object satisfying ScribbleTransport directly — bypassing
 * fromJitsiConference's own construction entirely, since MemoryTransport's
 * constructor signature does not match what fromJitsiConference expects
 * (this task's own documented mocking-seam discretion).
 */
function createTestTransport(localId: string): ScribbleTransport & { deliver: (from: string, payload: unknown) => void } {
  const subscribers = new Set<(from: string, payload: unknown) => void>();
  const sent: unknown[] = [];
  return {
    state: 'ready' as TransportState,
    send(payload: unknown): void {
      sent.push(payload);
    },
    subscribe(fn: (from: string, payload: unknown) => void): () => void {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    localId(): string {
      return localId;
    },
    onStateChange(): () => void {
      return () => {};
    },
    deliver(from: string, payload: unknown): void {
      for (const fn of subscribers) fn(from, payload);
    },
    get sentPayloads() {
      return sent;
    },
  } as ScribbleTransport & { deliver: (from: string, payload: unknown) => void; sentPayloads: unknown[] };
}

describe('useScribbleSession — presence outbound (D-02/D-03)', () => {
  it('mounting sends exactly one initial Presence frame reflecting AppState.currentState', async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');
    const sendSpy = jest.spyOn(transport, 'send');

    await renderHook(() => useScribbleSession({ transport }));

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith({ v: PROTOCOL_VERSION, t: MSG_PRESENCE, from: 'me', vis: true });
  });

  it('a backgrounded initial AppState sends vis:false', async () => {
    AppState.currentState = 'background';
    const transport = createTestTransport('me');
    const sendSpy = jest.spyOn(transport, 'send');

    await renderHook(() => useScribbleSession({ transport }));

    expect(sendSpy).toHaveBeenCalledWith({ v: PROTOCOL_VERSION, t: MSG_PRESENCE, from: 'me', vis: false });
  });
});

describe('useScribbleSession — Presence frames are NOT exempt from the rate limiter (T-05-03)', () => {
  it('sending RATE_CAPACITY + 1 Presence frames from one sender in rapid succession triggers the existing per-sender rate-limit warning', async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = await renderHook(() => useScribbleSession({ transport }));

    await act(() => {
      for (let i = 0; i < RATE_CAPACITY + 1; i++) {
        const payload = encode({ v: PROTOCOL_VERSION, t: MSG_PRESENCE, from: 'flooder', vis: i % 2 === 0 });
        (transport as unknown as { deliver: (from: string, payload: unknown) => void }).deliver('flooder', payload);
      }
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('flooder'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('exceeded rate limit'));
    // Proves apply() (and therefore checkRateLimit) actually ran for these
    // Presence-tagged payloads, not just that some other code path warned.
    expect(result.current.remotePresenceBySender.get('flooder')).toBeDefined();

    warnSpy.mockRestore();
  });
});

describe('useScribbleSession — host callback timing (D-04)', () => {
  it('onRemoteStrokeStart fires once at Start; onRemoteTap fires once, additionally, when that stroke later ends with kind:tap', async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');
    const onRemoteStrokeStart = jest.fn();
    const onRemoteTap = jest.fn();

    await renderHook(() => useScribbleSession({ transport, onRemoteStrokeStart, onRemoteTap }));

    const startPayload = encode({
      v: PROTOCOL_VERSION,
      t: MSG_START,
      from: 'alice',
      id: 'stroke-1',
      p: [0, 0],
      frame: { w: 100, h: 100 },
    });

    await act(() => {
      (transport as unknown as { deliver: (from: string, payload: unknown) => void }).deliver('alice', startPayload);
    });

    expect(onRemoteStrokeStart).toHaveBeenCalledTimes(1);
    expect(onRemoteStrokeStart).toHaveBeenCalledWith('alice');
    expect(onRemoteTap).not.toHaveBeenCalled();

    const endPayload = encode({ v: PROTOCOL_VERSION, t: MSG_END, from: 'alice', id: 'stroke-1', kind: 'tap' });

    await act(() => {
      (transport as unknown as { deliver: (from: string, payload: unknown) => void }).deliver('alice', endPayload);
    });

    expect(onRemoteStrokeStart).toHaveBeenCalledTimes(1); // still just once — not re-fired at End
    expect(onRemoteTap).toHaveBeenCalledTimes(1);
    expect(onRemoteTap).toHaveBeenCalledWith('alice');
  });

  it('never fires either callback for the local author\'s own strokes', async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');
    const onRemoteStrokeStart = jest.fn();
    const onRemoteTap = jest.fn();

    const { result } = await renderHook(() =>
      useScribbleSession({ transport, onRemoteStrokeStart, onRemoteTap, frameDims: { w: 100, h: 100 } }),
    );

    await act(() => {
      result.current.beginLocal('local-stroke');
      result.current.endLocal('local-stroke', 'tap');
    });

    expect(onRemoteStrokeStart).not.toHaveBeenCalled();
    expect(onRemoteTap).not.toHaveBeenCalled();
  });
});

describe('useScribbleSession — inbound presence spoofing resistance (T-05-05)', () => {
  it("a Presence frame whose own payload 'from' field is forged to a different id than the transport's own from argument still updates presence state keyed by the transport-supplied from, never the payload's own from field", async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');

    const { result } = await renderHook(() => useScribbleSession({ transport }));

    // The transport-supplied `from` argument is 'alice'; the payload's own
    // encoded `from` field is forged to 'mallory'.
    const forgedPayload = encode({ v: PROTOCOL_VERSION, t: MSG_PRESENCE, from: 'mallory', vis: false });

    await act(() => {
      (transport as unknown as { deliver: (from: string, payload: unknown) => void }).deliver('alice', forgedPayload);
    });

    // Keyed by the trusted transport argument ('alice'), never by the
    // forged payload field ('mallory').
    expect(result.current.remotePresenceBySender.get('alice')).toBe(false);
    expect(result.current.remotePresenceBySender.has('mallory')).toBe(false);
  });

  it('two distinct senders each update only their own transport-supplied key, even when one forges its payload.from to collide with the other', async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');

    const { result } = await renderHook(() => useScribbleSession({ transport }));

    const alicePayload = encode({ v: PROTOCOL_VERSION, t: MSG_PRESENCE, from: 'alice', vis: true });
    const bobForgedAsAlice = encode({ v: PROTOCOL_VERSION, t: MSG_PRESENCE, from: 'alice', vis: false });

    await act(() => {
      (transport as unknown as { deliver: (from: string, payload: unknown) => void }).deliver('alice', alicePayload);
      (transport as unknown as { deliver: (from: string, payload: unknown) => void }).deliver('bob', bobForgedAsAlice);
    });

    expect(result.current.remotePresenceBySender.get('alice')).toBe(true); // untouched by bob's forged frame
    expect(result.current.remotePresenceBySender.get('bob')).toBe(false); // bob's OWN key, despite payload.from:'alice'
  });
});
