import { AppState } from 'react-native';
import { createMemoryTransportPair } from '@vilancer/scribble-protocol/transport';
import { decode } from '@vilancer/scribble-protocol/codec';
import { MSG_CLEAR, MSG_END, MSG_MOVE, MSG_PRESENCE, MSG_START, RATE_CAPACITY } from '@vilancer/scribble-protocol/core';
import { ScribbleClient } from '@vilancer/scribble';

import { OutOfAppBridge, type OverlayNative } from './bridge.js';
import type { LocalStrokeEvent } from './native.js';

type Listener = (e: unknown) => void;

function fakeNative() {
  const listeners = new Map<string, Set<Listener>>();
  const calls: Array<[string, ...unknown[]]> = [];
  const native: OverlayNative & { emit(event: string, e: unknown): void } = {
    show: jest.fn(async () => true),
    hide: jest.fn(),
    setStyle: jest.fn(),
    remoteBegin: (...a: unknown[]) => void calls.push(['remoteBegin', ...a]),
    remoteAppend: (...a: unknown[]) => void calls.push(['remoteAppend', ...a]),
    remoteEnd: (...a: unknown[]) => void calls.push(['remoteEnd', ...a]),
    clear: (...a: unknown[]) => void calls.push(['clear', ...a]),
    clearSender: (...a: unknown[]) => void calls.push(['clearSender', ...a]),
    addListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn as Listener);
      return { remove: () => listeners.get(event)!.delete(fn as Listener) };
    },
    emit(event, e) {
      for (const fn of listeners.get(event) ?? []) fn(e);
    },
  };
  return { native, calls };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function setup() {
  const [sharerT, viewerT] = createMemoryTransportPair('sharer', 'viewer');
  const sharer = new ScribbleClient(sharerT);
  const viewer = new ScribbleClient(viewerT);
  cleanups.push(sharer.start(), viewer.start());
  const wire: unknown[] = [];
  viewerT.subscribe((_from, payload) => wire.push(payload));
  const { native, calls } = fakeNative();
  const bridge = new OutOfAppBridge(sharer, native);
  cleanups.push(() => bridge.dispose());
  return { sharer, viewer, native, calls, bridge, wire };
}

describe('OutOfAppBridge', () => {
  it('forwards remote strokes to the native ink layer only while shown', async () => {
    const { viewer, calls, bridge } = setup();
    viewer.store.beginLocal('a', { w: 100, h: 100 }, { color: '#0A84FF', width: 6, tool: 'marker' });
    viewer.store.appendLocal('a', 0.5, 0.5);
    expect(calls).toHaveLength(0); // hidden: nothing forwarded

    await bridge.show({ hideInkFromCapture: false, hideControlsFromCapture: false, holdMs: 2000, fadeMs: 500, staleMs: 1500 });
    viewer.store.beginLocal('b', { w: 100, h: 100 }, { color: '#0A84FF', width: 6, tool: 'marker' });
    viewer.store.appendLocal('b', 0.25, 0.75);
    viewer.store.appendLocal('b', 0.3, 0.7);
    viewer.store.endLocal('b', 'stroke');

    const begin = calls.find((c) => c[0] === 'remoteBegin')!;
    expect(begin[1]).toBe('viewer b');
    expect(begin[2]).toBeCloseTo(0.25, 2);
    expect(begin[3]).toBeCloseTo(0.75, 2);
    expect(begin.slice(4)).toEqual(['#0A84FF', 6, 'marker']);
    expect(calls.some((c) => c[0] === 'remoteAppend' && c[1] === 'viewer b')).toBe(true);
    expect(calls).toContainEqual(['remoteEnd', 'viewer b', 'stroke']);
  });

  it('a flooding sender is capped by the same rate limit before reaching the native layer', async () => {
    // Frozen clock: no bucket refill while the burst arrives.
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const { viewer, calls, bridge } = setup();
    await bridge.show({ hideInkFromCapture: false, hideControlsFromCapture: false, holdMs: 2000, fadeMs: 500, staleMs: 1500 });
    for (let i = 0; i < RATE_CAPACITY + 50; i++) {
      viewer.transport.send({ v: 1, t: 's', from: 'viewer', id: `flood-${i}`, p: [10, 10], frame: { w: 1, h: 1 } });
    }
    const begins = calls.filter((c) => c[0] === 'remoteBegin').length;
    expect(begins).toBeLessThanOrEqual(RATE_CAPACITY);
    expect(begins).toBeGreaterThan(0);
    now.mockRestore();
  });

  it('a remote Clear clears that sender on the ink layer', async () => {
    const { viewer, calls, bridge } = setup();
    await bridge.show({ hideInkFromCapture: false, hideControlsFromCapture: false, holdMs: 2000, fadeMs: 500, staleMs: 1500 });
    viewer.clearMine();
    expect(calls).toContainEqual(['clearSender', 'viewer']);
    expect(calls.some((c) => c[0] === 'clear')).toBe(false);
  });

  it('turns native touches into wire frames with style, and the viewer receives the stroke', async () => {
    const { native, viewer, wire, bridge } = setup();
    await bridge.show({ hideInkFromCapture: false, hideControlsFromCapture: false, holdMs: 2000, fadeMs: 500, staleMs: 1500 });
    const events: LocalStrokeEvent[] = [
      { phase: 'begin', id: 'ooa-1', points: [0.1, 0.2], frameW: 1080, frameH: 2400, tool: 'pen', color: '#FF453A', width: 6 },
      { phase: 'append', id: 'ooa-1', points: [0.11, 0.21, 0.2, 0.3, 0.3, 0.4] },
      { phase: 'end', id: 'ooa-1', kind: 'stroke' },
    ];
    for (const e of events) native.emit('onLocalStroke', e);

    const frames = wire.map((p) => decode(p)).filter((r) => r.ok).map((r) => (r as { ok: true; frame: { t: string } }).frame);
    const strokeFrames = frames.filter((f) => f.t !== MSG_PRESENCE);
    expect(strokeFrames[0]).toMatchObject({ t: MSG_START, id: 'ooa-1', frame: { w: 1080, h: 2400 }, st: { c: '#FF453A', w: 6, k: 'pen' } });
    expect(strokeFrames.some((f) => f.t === MSG_MOVE)).toBe(true);
    expect(strokeFrames[strokeFrames.length - 1]).toMatchObject({ t: MSG_END, id: 'ooa-1', kind: 'stroke' });

    const remote = viewer.store.snapshot().find((s) => s.id === 'ooa-1')!;
    expect(remote.points).toHaveLength(4);
    expect(remote.style).toEqual({ color: '#FF453A', width: 6, tool: 'pen' });
  });

  it('a native shape arrives as one complete stroke', async () => {
    const { native, viewer, bridge } = setup();
    await bridge.show({ hideInkFromCapture: false, hideControlsFromCapture: false, holdMs: 2000, fadeMs: 500, staleMs: 1500 });
    const pts: number[] = [];
    for (let i = 0; i <= 36; i++) pts.push(0.5 + 0.1 * Math.cos(i / 6), 0.5 + 0.1 * Math.sin(i / 6));
    native.emit('onLocalStroke', { phase: 'shape', id: 'ooa-2', points: pts, frameW: 1080, frameH: 2400, tool: 'pen', color: '#30D158', width: 3 });
    const remote = viewer.store.snapshot().find((s) => s.id === 'ooa-2')!;
    expect(remote.points).toHaveLength(37);
    expect(remote.style?.color).toBe('#30D158');
  });

  it('the toolbar trash clears this participant everywhere', async () => {
    const { native, viewer, wire, bridge } = setup();
    await bridge.show({ hideInkFromCapture: false, hideControlsFromCapture: false, holdMs: 2000, fadeMs: 500, staleMs: 1500 });
    native.emit('onLocalStroke', { phase: 'begin', id: 'ooa-3', points: [0.1, 0.1], frameW: 10, frameH: 10, tool: 'pen', color: '#FFFFFF', width: 3 });
    expect(viewer.store.snapshot()).toHaveLength(1);
    native.emit('onAction', { action: 'clear' });
    expect(viewer.store.snapshot()).toHaveLength(0);
    expect(wire.map((p) => decode(p)).some((r) => r.ok && r.frame.t === MSG_CLEAR)).toBe(true);
  });

  it('reports this session as visible while shown, and goes back to AppState after', async () => {
    const { viewer, bridge } = setup();
    await bridge.show({ hideInkFromCapture: false, hideControlsFromCapture: false, holdMs: 2000, fadeMs: 500, staleMs: 1500 });
    expect(viewer.getPresence().get('sharer')).toBe(true);
    bridge.dispose();
    // Override released: presence follows AppState again.
    expect(viewer.getPresence().get('sharer')).toBe(AppState.currentState === 'active');
  });
});
