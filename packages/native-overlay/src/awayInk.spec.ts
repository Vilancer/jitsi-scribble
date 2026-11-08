import { createMemoryTransportPair } from '@vilancer/scribble-protocol/transport';
import { ScribbleClient } from '@vilancer/scribble';

import { AwayInk, DEFAULT_AWAY_CONFIG, type AwayInkDeps, type AwayInkNative } from './awayInk.js';

function fakeNative() {
  const calls: Array<[string, ...unknown[]]> = [];
  const native: AwayInkNative = {
    remoteBegin: (...a: unknown[]) => void calls.push(['remoteBegin', ...a]),
    remoteAppend: (...a: unknown[]) => void calls.push(['remoteAppend', ...a]),
    remoteEnd: (...a: unknown[]) => void calls.push(['remoteEnd', ...a]),
    clear: (...a: unknown[]) => void calls.push(['clear', ...a]),
    clearSender: (...a: unknown[]) => void calls.push(['clearSender', ...a]),
    notify: (...a: unknown[]) => void calls.push(['notify', ...a]),
    snapshot: async () => ({ uri: 'file:///snap.jpg', width: 390, height: 844 }),
    deleteSnapshots: () => void calls.push(['deleteSnapshots']),
  };
  return { native, calls };
}

/** A hand-cranked clock and timer queue. */
function fakeTime() {
  let now = 1_000_000;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const deps: AwayInkDeps = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (h) => void timers.delete(h as number),
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
      await Promise.resolve();
      await Promise.resolve();
    }
    now = end;
  };
  return { deps, advance, tick: (ms: number) => void (now += ms) };
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
  const { native, calls } = fakeNative();
  const time = fakeTime();
  const replays: Array<unknown> = [];
  const away = new AwayInk(sharer, native, DEFAULT_AWAY_CONFIG, (s) => replays.push(s), time.deps);
  cleanups.push(() => away.dispose());
  const draw = (id: string) => {
    viewer.store.beginLocal(id, { w: 390, h: 844 }, { color: '#0A84FF', width: 6, tool: 'pen' });
    viewer.store.appendLocal(id, 0.2, 0.3);
    viewer.store.appendLocal(id, 0.6, 0.7);
    viewer.store.endLocal(id, 'stroke');
    viewer.store.tick(Date.now() + 100);
  };
  return { sharer, viewer, away, calls, time, replays, draw };
}

describe('AwayInk', () => {
  it('does nothing while the user is in the app', () => {
    const { calls, draw } = setup();
    draw('a');
    expect(calls).toHaveLength(0);
  });

  it('forwards ink and notifies once per burst while away', () => {
    const { away, calls, draw, time } = setup();
    away.setAway(true);
    draw('a');
    time.tick(2000);
    draw('b'); // same burst: no second notification
    expect(calls.filter((c) => c[0] === 'notify')).toHaveLength(1);
    expect(calls.some((c) => c[0] === 'remoteBegin' && c[1] === 'viewer a')).toBe(true);
    time.tick(DEFAULT_AWAY_CONFIG.burstGapMs + 1);
    draw('c'); // a new burst after a quiet gap
    expect(calls.filter((c) => c[0] === 'notify')).toHaveLength(2);
  });

  it('replays what arrived while away over its snapshot, under fresh ids', async () => {
    const { away, sharer, draw, time, replays, calls } = setup();
    away.setAway(true);
    draw('a');
    sharer.store.clear('all');
    away.setAway(false);
    expect(calls).toContainEqual(['clear', 'all']);
    await time.advance(500);
    expect(replays[0]).toEqual({ uri: 'file:///snap.jpg', width: 390, height: 844 });
    const ids = sharer.store.snapshot().map((s) => s.id);
    expect(ids.some((id) => id.startsWith('a~r'))).toBe(true);
    await time.advance(10_000);
    expect(replays[replays.length - 1]).toBeNull();
    expect(calls).toContainEqual(['deleteSnapshots']);
  });

  it('cancels a replay when the user leaves again', async () => {
    const { away, draw, time, replays } = setup();
    away.setAway(true);
    draw('a');
    away.setAway(false);
    await time.advance(500);
    away.setAway(true);
    expect(replays[replays.length - 1]).toBeNull();
    expect(away.isReplaying).toBe(false);
  });

  it('reports itself visible while the PiP shows the ink', () => {
    const { away, sharer } = setup();
    const spy = jest.spyOn(sharer, 'setPresenceOverride');
    away.setPipActive(true);
    away.setPipActive(false);
    expect(spy.mock.calls).toEqual([[true], [null]]);
  });
});
