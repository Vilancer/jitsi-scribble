import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { encode } from '@vilancer/protocol/codec';
import {
  MSG_END,
  MSG_PRESENCE,
  MSG_START,
  PROTOCOL_VERSION,
  RATE_CAPACITY,
} from '@vilancer/protocol/core';
import type {
  ScribbleTransport,
  TransportState,
} from '@vilancer/protocol/transport';

import { useScribbleSession } from './useScribbleSession.js';

/**
 * A hand-built object satisfying ScribbleTransport directly — bypassing
 * fromJitsiConference's own construction entirely, since MemoryTransport's
 * constructor signature does not match what fromJitsiConference expects
 * (this task's own documented mocking-seam discretion).
 */
function createTestTransport(
  localId: string,
): ScribbleTransport & { deliver: (from: string, payload: unknown) => void } {
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
  } as ScribbleTransport & {
    deliver: (from: string, payload: unknown) => void;
    sentPayloads: unknown[];
  };
}

describe('useScribbleSession — presence outbound (D-02/D-03)', () => {
  it('mounting sends exactly one initial Presence frame reflecting AppState.currentState', async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');
    const sendSpy = jest.spyOn(transport, 'send');

    await renderHook(() => useScribbleSession({ transport }));

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith({
      v: PROTOCOL_VERSION,
      t: MSG_PRESENCE,
      from: 'me',
      vis: true,
    });
  });

  it('a backgrounded initial AppState sends vis:false', async () => {
    AppState.currentState = 'background';
    const transport = createTestTransport('me');
    const sendSpy = jest.spyOn(transport, 'send');

    await renderHook(() => useScribbleSession({ transport }));

    expect(sendSpy).toHaveBeenCalledWith({
      v: PROTOCOL_VERSION,
      t: MSG_PRESENCE,
      from: 'me',
      vis: false,
    });
  });
});

describe('useScribbleSession — Presence frames are NOT exempt from the rate limiter (T-05-03)', () => {
  it('sending RATE_CAPACITY + 1 Presence frames from one sender in rapid succession triggers the existing per-sender rate-limit warning', async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = await renderHook(() =>
      useScribbleSession({ transport }),
    );

    await act(() => {
      for (let i = 0; i < RATE_CAPACITY + 1; i++) {
        const payload = encode({
          v: PROTOCOL_VERSION,
          t: MSG_PRESENCE,
          from: 'flooder',
          vis: i % 2 === 0,
        });
        (
          transport as unknown as {
            deliver: (from: string, payload: unknown) => void;
          }
        ).deliver('flooder', payload);
      }
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('flooder'));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('exceeded rate limit'),
    );
    // Proves apply() (and therefore checkRateLimit) actually ran for these
    // Presence-tagged payloads, not just that some other code path warned.
    expect(result.current.remotePresenceBySender.get('flooder')).toBeDefined();

    warnSpy.mockRestore();
  });
});

describe('useScribbleSession — an unmemoized transportOptions object does NOT tear down/rebuild the session on re-render (05-REVIEW.md CR-02)', () => {
  it('re-rendering with a brand-new transportOptions object literal (same transport) does not re-send the initial Presence frame or reset the store', async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');
    const sendSpy = jest.spyOn(transport, 'send');

    const { result, rerender } = await renderHook(
      (props: { transportOptions: Record<string, never> }) =>
        useScribbleSession({
          transport,
          frameDims: { w: 100, h: 100 },
          transportOptions: props.transportOptions,
        }),
      { initialProps: { transportOptions: {} } },
    );

    expect(sendSpy).toHaveBeenCalledTimes(1); // exactly one initial Presence send

    await act(() => {
      result.current.beginLocal('local-stroke-1');
      result.current.appendLocal('local-stroke-1', 10, 10);
    });

    expect(result.current.getStrokesSnapshot()).toHaveLength(1);

    // A BRAND-NEW object literal every time — exactly what a host passing
    // `transportOptions={{ ... }}` inline in JSX produces on every one of
    // ITS OWN re-renders, with no memoization. Pre-CR-02-fix, this identity
    // change alone tore down and rebuilt the entire session.
    await rerender({ transportOptions: {} });
    await rerender({ transportOptions: {} });

    // No second Presence send — the session was never torn down/rebuilt.
    expect(sendSpy).toHaveBeenCalledTimes(1);
    // The stroke begun before the re-renders is still there — a rebuilt
    // session would have constructed a brand-new, empty StrokeStore.
    expect(result.current.getStrokesSnapshot()).toHaveLength(1);
    expect(result.current.getStrokesSnapshot()[0]?.id).toBe('local-stroke-1');
  });

  it('swapping to a genuinely different injected transport STILL tears down and rebuilds the session (the legitimate case the fix above must not break)', async () => {
    AppState.currentState = 'active';
    const transportA = createTestTransport('me');
    const transportB = createTestTransport('me');
    const sendSpyA = jest.spyOn(transportA, 'send');
    const sendSpyB = jest.spyOn(transportB, 'send');

    const { result, rerender } = await renderHook(
      (props: { transport: ScribbleTransport }) =>
        useScribbleSession({
          transport: props.transport,
          frameDims: { w: 100, h: 100 },
        }),
      { initialProps: { transport: transportA } },
    );

    expect(sendSpyA).toHaveBeenCalledTimes(1);

    await act(() => {
      result.current.beginLocal('stroke-on-a');
    });
    expect(result.current.getStrokesSnapshot()).toHaveLength(1);

    // A REAL identity change — the "host swapped to a different
    // conference/transport" case CR-02's fix must keep working.
    await rerender({ transport: transportB });

    // The new transport announces its own initial Presence — proof a fresh
    // session was actually constructed over it.
    expect(sendSpyB).toHaveBeenCalledTimes(1);
    // The stroke authored against the OLD session's store is gone — proof
    // the store itself was rebuilt from scratch, not reused.
    expect(result.current.getStrokesSnapshot()).toHaveLength(0);
  });
});

describe('useScribbleSession — an unmemoized frameDims object does NOT churn beginLocal/appendLocal/contentRect identity on re-render (05-REVIEW.md CR-01, re-review)', () => {
  it('re-rendering with a brand-new frameDims object literal carrying the same w/h values keeps contentRect, appendLocal, and beginLocal referentially stable', async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');

    const { result, rerender } = await renderHook(
      (props: { frameDims: { w: number; h: number } }) =>
        useScribbleSession({ transport, frameDims: props.frameDims }),
      { initialProps: { frameDims: { w: 100, h: 100 } } },
    );

    // Measure the overlay surface so contentRect actually resolves to a
    // non-null rect, not just `null` twice in a row (which would trivially
    // "pass" without exercising the memo this fix touches).
    await act(() => {
      result.current.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 100 } },
      } as never);
    });

    const contentRectBefore = result.current.contentRect;
    const appendLocalBefore = result.current.appendLocal;
    const beginLocalBefore = result.current.beginLocal;
    expect(contentRectBefore).not.toBeNull();

    // A BRAND-NEW object literal every time, same w/h — exactly what a host
    // passing `frameDims={{ w: track.width, h: track.height }}` inline in
    // JSX produces on every one of ITS OWN re-renders, with no
    // memoization. Pre-fix, this identity change alone churned
    // contentRect's memo (keyed on `frameDims` by reference), which cascaded
    // into appendLocal's `useCallback([contentRect])` and beginLocal's
    // `useCallback([frameDims])` — the second, independent path to the same
    // churn this test also covers.
    await rerender({ frameDims: { w: 100, h: 100 } });
    await rerender({ frameDims: { w: 100, h: 100 } });

    expect(result.current.contentRect).toBe(contentRectBefore);
    expect(result.current.appendLocal).toBe(appendLocalBefore);
    expect(result.current.beginLocal).toBe(beginLocalBefore);
  });

  it('a frameDims object literal whose w/h VALUES actually change still produces a new contentRect (the legitimate case the fix above must not break)', async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');

    const { result, rerender } = await renderHook(
      (props: { frameDims: { w: number; h: number } }) =>
        useScribbleSession({ transport, frameDims: props.frameDims }),
      { initialProps: { frameDims: { w: 100, h: 100 } } },
    );

    await act(() => {
      result.current.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 100 } },
      } as never);
    });

    const contentRectBefore = result.current.contentRect;
    expect(contentRectBefore).not.toBeNull();

    // A genuine value change — e.g. the sender's real video track resized —
    // must still recompute contentRect.
    await rerender({ frameDims: { w: 200, h: 100 } });

    expect(result.current.contentRect).not.toBe(contentRectBefore);
  });
});

describe('useScribbleSession — malformed/undecodable payloads are NOT exempt from the rate limiter (05-REVIEW.md CR-01)', () => {
  it("sending RATE_CAPACITY + 1 undecodable (non-JSON garbage) payloads from one sender in rapid succession triggers the per-sender rate-limit warning, proving apply() — and therefore checkRateLimit — runs even when this listener's own decode() would fail", async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await renderHook(() => useScribbleSession({ transport }));

    await act(() => {
      for (let i = 0; i < RATE_CAPACITY + 1; i++) {
        // Not a valid encoded frame at all — the cheapest flood a hostile
        // sender could mount, and the exact traffic shape CR-01 identified
        // as bypassing the rate limiter under the pre-fix code (an early
        // `return` on decode failure, before store.apply() was ever
        // reached).
        (
          transport as unknown as {
            deliver: (from: string, payload: unknown) => void;
          }
        ).deliver('garbage-flooder', `not valid json ${i}`);
      }
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('garbage-flooder'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('exceeded rate limit'),
    );

    warnSpy.mockRestore();
  });
});

describe('useScribbleSession — host callback timing (D-04)', () => {
  it('onRemoteStrokeStart fires once at Start; onRemoteTap fires once, additionally, when that stroke later ends with kind:tap', async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');
    const onRemoteStrokeStart = jest.fn();
    const onRemoteTap = jest.fn();

    await renderHook(() =>
      useScribbleSession({ transport, onRemoteStrokeStart, onRemoteTap }),
    );

    const startPayload = encode({
      v: PROTOCOL_VERSION,
      t: MSG_START,
      from: 'alice',
      id: 'stroke-1',
      p: [0, 0],
      frame: { w: 100, h: 100 },
    });

    await act(() => {
      (
        transport as unknown as {
          deliver: (from: string, payload: unknown) => void;
        }
      ).deliver('alice', startPayload);
    });

    expect(onRemoteStrokeStart).toHaveBeenCalledTimes(1);
    expect(onRemoteStrokeStart).toHaveBeenCalledWith('alice');
    expect(onRemoteTap).not.toHaveBeenCalled();

    const endPayload = encode({
      v: PROTOCOL_VERSION,
      t: MSG_END,
      from: 'alice',
      id: 'stroke-1',
      kind: 'tap',
    });

    await act(() => {
      (
        transport as unknown as {
          deliver: (from: string, payload: unknown) => void;
        }
      ).deliver('alice', endPayload);
    });

    expect(onRemoteStrokeStart).toHaveBeenCalledTimes(1); // still just once — not re-fired at End
    expect(onRemoteTap).toHaveBeenCalledTimes(1);
    expect(onRemoteTap).toHaveBeenCalledWith('alice');
  });

  it("never fires either callback for the local author's own strokes", async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');
    const onRemoteStrokeStart = jest.fn();
    const onRemoteTap = jest.fn();

    const { result } = await renderHook(() =>
      useScribbleSession({
        transport,
        onRemoteStrokeStart,
        onRemoteTap,
        frameDims: { w: 100, h: 100 },
      }),
    );

    await act(() => {
      result.current.beginLocal('local-stroke');
      result.current.endLocal('local-stroke', 'tap');
    });

    expect(onRemoteStrokeStart).not.toHaveBeenCalled();
    expect(onRemoteTap).not.toHaveBeenCalled();
  });
});

describe('useScribbleSession — onRemoteStrokeStart/onRemoteTap are read via ref, not a stale closure (05-REVIEW.md WR-01)', () => {
  it("a later render's new onRemoteStrokeStart identity is picked up on the next remote Start, even though the invoking effect never re-ran", async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');
    const calls: string[] = [];

    // Simulates a host's idiomatic inline callback that closes over its own
    // changing render-scope state (`props.tag` here stands in for e.g. a
    // `currentCallId`) — a brand-new function identity every render.
    const { rerender } = await renderHook(
      (props: { tag: string }) =>
        useScribbleSession({
          transport,
          onRemoteStrokeStart: (from: string) => calls.push(`${props.tag}:${from}`),
        }),
      { initialProps: { tag: 'first' } },
    );

    // The effect that actually invokes onRemoteStrokeStart only re-runs on
    // [conference, injectedTransport] changes — `transport`'s identity is
    // unchanged across this rerender, so pre-fix this new callback would
    // never have been picked up; the OLD ('first') closure would fire
    // forever instead.
    await rerender({ tag: 'second' });

    const startPayload = encode({
      v: PROTOCOL_VERSION,
      t: MSG_START,
      from: 'alice',
      id: 'stroke-1',
      p: [0, 0],
      frame: { w: 100, h: 100 },
    });

    await act(() => {
      (
        transport as unknown as {
          deliver: (from: string, payload: unknown) => void;
        }
      ).deliver('alice', startPayload);
    });

    expect(calls).toEqual(['second:alice']); // NOT 'first:alice'
  });

  it("the same holds for onRemoteTap", async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');
    const calls: string[] = [];

    const { rerender } = await renderHook(
      (props: { tag: string }) =>
        useScribbleSession({
          transport,
          onRemoteTap: (from: string) => calls.push(`${props.tag}:${from}`),
        }),
      { initialProps: { tag: 'first' } },
    );

    await rerender({ tag: 'second' });

    const startPayload = encode({
      v: PROTOCOL_VERSION,
      t: MSG_START,
      from: 'alice',
      id: 'stroke-1',
      p: [0, 0],
      frame: { w: 100, h: 100 },
    });
    const endPayload = encode({
      v: PROTOCOL_VERSION,
      t: MSG_END,
      from: 'alice',
      id: 'stroke-1',
      kind: 'tap',
    });

    await act(() => {
      (
        transport as unknown as {
          deliver: (from: string, payload: unknown) => void;
        }
      ).deliver('alice', startPayload);
      (
        transport as unknown as {
          deliver: (from: string, payload: unknown) => void;
        }
      ).deliver('alice', endPayload);
    });

    expect(calls).toEqual(['second:alice']); // NOT 'first:alice'
  });
});

describe('useScribbleSession — inbound presence spoofing resistance (T-05-05)', () => {
  it("a Presence frame whose own payload 'from' field is forged to a different id than the transport's own from argument still updates presence state keyed by the transport-supplied from, never the payload's own from field", async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');

    const { result } = await renderHook(() =>
      useScribbleSession({ transport }),
    );

    // The transport-supplied `from` argument is 'alice'; the payload's own
    // encoded `from` field is forged to 'mallory'.
    const forgedPayload = encode({
      v: PROTOCOL_VERSION,
      t: MSG_PRESENCE,
      from: 'mallory',
      vis: false,
    });

    await act(() => {
      (
        transport as unknown as {
          deliver: (from: string, payload: unknown) => void;
        }
      ).deliver('alice', forgedPayload);
    });

    // Keyed by the trusted transport argument ('alice'), never by the
    // forged payload field ('mallory').
    expect(result.current.remotePresenceBySender.get('alice')).toBe(false);
    expect(result.current.remotePresenceBySender.has('mallory')).toBe(false);
  });

  it('two distinct senders each update only their own transport-supplied key, even when one forges its payload.from to collide with the other', async () => {
    AppState.currentState = 'active';
    const transport = createTestTransport('me');

    const { result } = await renderHook(() =>
      useScribbleSession({ transport }),
    );

    const alicePayload = encode({
      v: PROTOCOL_VERSION,
      t: MSG_PRESENCE,
      from: 'alice',
      vis: true,
    });
    const bobForgedAsAlice = encode({
      v: PROTOCOL_VERSION,
      t: MSG_PRESENCE,
      from: 'alice',
      vis: false,
    });

    await act(() => {
      (
        transport as unknown as {
          deliver: (from: string, payload: unknown) => void;
        }
      ).deliver('alice', alicePayload);
      (
        transport as unknown as {
          deliver: (from: string, payload: unknown) => void;
        }
      ).deliver('bob', bobForgedAsAlice);
    });

    expect(result.current.remotePresenceBySender.get('alice')).toBe(true); // untouched by bob's forged frame
    expect(result.current.remotePresenceBySender.get('bob')).toBe(false); // bob's OWN key, despite payload.from:'alice'
  });
});
