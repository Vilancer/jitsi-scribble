import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fromJitsiConference } from './fromJitsiConference.js';
import { createFakeJitsiConference } from '../test-support/fakes.js';

// 04-02-PLAN.md Task 1: every probe-order permutation PROTO-05 describes.
// Plan 04-01 already implemented resolveSend() correctly per
// 04-RESEARCH.md Pattern 1 — this task is test coverage, not a rewrite.

describe('fromJitsiConference — probe order (PROTO-05)', () => {
  it('conference exposing only sendMessage: send() calls sendMessage', () => {
    const { conference, emit, sentPayloads } = createFakeJitsiConference({ methods: ['sendMessage'] });
    const transport = fromJitsiConference(conference);

    emit('conference.dataChannelOpened');
    transport.send('hello');

    expect(sentPayloads).toEqual([{ method: 'sendMessage', payload: 'hello' }]);
  });

  it('conference exposing only broadcastEndpointMessage: send() calls broadcastEndpointMessage', () => {
    const { conference, emit, sentPayloads } = createFakeJitsiConference({
      methods: ['broadcastEndpointMessage'],
    });
    const transport = fromJitsiConference(conference);

    emit('conference.dataChannelOpened');
    transport.send('hello');

    expect(sentPayloads).toEqual([{ method: 'broadcastEndpointMessage', payload: 'hello' }]);
  });

  it('conference exposing only sendEndpointMessage: send() calls sendEndpointMessage', () => {
    const { conference, emit, sentPayloads } = createFakeJitsiConference({
      methods: ['sendEndpointMessage'],
    });
    const transport = fromJitsiConference(conference);

    emit('conference.dataChannelOpened');
    transport.send('hello');

    expect(sentPayloads).toEqual([{ method: 'sendEndpointMessage', payload: 'hello' }]);
  });

  it('conference exposing all three: send() calls sendMessage, never the other two (probe order is preference order)', () => {
    const { conference, emit, sentPayloads } = createFakeJitsiConference({
      methods: ['sendMessage', 'broadcastEndpointMessage', 'sendEndpointMessage'],
    });
    const transport = fromJitsiConference(conference);

    emit('conference.dataChannelOpened');
    transport.send('hello');

    expect(sentPayloads).toEqual([{ method: 'sendMessage', payload: 'hello' }]);
  });

  it('conference exposing broadcastEndpointMessage and sendEndpointMessage (no sendMessage): send() calls broadcastEndpointMessage, never sendEndpointMessage', () => {
    const { conference, emit, sentPayloads } = createFakeJitsiConference({
      methods: ['broadcastEndpointMessage', 'sendEndpointMessage'],
    });
    const transport = fromJitsiConference(conference);

    emit('conference.dataChannelOpened');
    transport.send('hello');

    expect(sentPayloads).toEqual([{ method: 'broadcastEndpointMessage', payload: 'hello' }]);
  });

  it('conference exposing none of the three: constructing throws, naming all three method names', () => {
    const { conference } = createFakeJitsiConference({ methods: [] });

    expect(() => fromJitsiConference(conference)).toThrow();

    let thrown: Error | undefined;
    try {
      fromJitsiConference(conference);
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown!.message).toContain('sendMessage');
    expect(thrown!.message).toContain('broadcastEndpointMessage');
    expect(thrown!.message).toContain('sendEndpointMessage');
  });
});

// 04-02-PLAN.md Task 2: readiness state machine depth — degraded, re-latch,
// never-throw. Mirrors protocol/transport/index.ts's onStateChange contract.

describe('fromJitsiConference — readiness state machine depth (PROTO-06/07)', () => {
  // CR-01 fix (04-REVIEW.md): the adapter now defaults optimistically to
  // 'ready' at construction (not 'connecting'), because DATA_CHANNEL_OPENED
  // is a one-shot event with no replay semantics — an adapter constructed
  // after the real data channel already opened would otherwise get stuck
  // 'connecting' forever with every send() silently dropped. This is exactly
  // that "constructed after the channel is already open" scenario: no
  // dataChannelOpened event is ever emitted here, yet send() must still
  // succeed immediately.
  it('adapter starts ready optimistically (no dataChannelOpened event needed) so send() succeeds immediately after construction', () => {
    const { conference, sentPayloads } = createFakeJitsiConference({ methods: ['sendMessage'] });
    const transport = fromJitsiConference(conference);

    expect(transport.state).toBe('ready');
    expect(() => transport.send('immediate')).not.toThrow();
    expect(sentPayloads).toEqual([{ method: 'sendMessage', payload: 'immediate' }]);
  });

  it('conference.dataChannelOpened is an idempotent no-op when already ready (the "normal" case: adapter constructed before the real event fires)', () => {
    const { conference, emit } = createFakeJitsiConference({ methods: ['sendMessage'] });
    const transport = fromJitsiConference(conference);

    emit('conference.dataChannelOpened');

    expect(transport.state).toBe('ready');
  });

  it('a ready adapter whose underlying send throws: send() does not throw, state -> degraded', () => {
    const { conference, emit } = createFakeJitsiConference({ methods: ['sendMessage'], throwOnSend: true });
    const transport = fromJitsiConference(conference);
    emit('conference.dataChannelOpened');

    expect(() => transport.send('boom')).not.toThrow();
    expect(transport.state).toBe('degraded');
  });

  it('send() while degraded is a silent no-op, same as connecting', () => {
    const { conference, emit, sentPayloads } = createFakeJitsiConference({
      methods: ['sendMessage'],
      throwOnSend: true,
    });
    const transport = fromJitsiConference(conference);
    emit('conference.dataChannelOpened');
    transport.send('boom'); // throws internally once -> degraded, nothing recorded

    expect(transport.state).toBe('degraded');
    expect(sentPayloads).toEqual([]);

    transport.send('also-dropped');

    expect(sentPayloads).toEqual([]);
  });

  it('conference.dataChannelClosed transitions ready -> degraded directly (not only via a throwing send)', () => {
    const { conference, emit } = createFakeJitsiConference({ methods: ['sendMessage'] });
    const transport = fromJitsiConference(conference);
    emit('conference.dataChannelOpened');
    expect(transport.state).toBe('ready');

    emit('conference.dataChannelClosed');

    expect(transport.state).toBe('degraded');
  });

  it('a degraded adapter re-latches to ready on a subsequent dataChannelOpened, and send() after re-latch is delivered', () => {
    const { conference, emit, sentPayloads } = createFakeJitsiConference({ methods: ['sendMessage'] });
    const transport = fromJitsiConference(conference);
    emit('conference.dataChannelOpened');
    emit('conference.dataChannelClosed');
    expect(transport.state).toBe('degraded');

    emit('conference.dataChannelOpened');

    expect(transport.state).toBe('ready');
    transport.send('after-relatch');
    expect(sentPayloads).toEqual([{ method: 'sendMessage', payload: 'after-relatch' }]);
  });

  it('a throw-induced degraded adapter also re-latches to ready, and a post-relatch send() is delivered via the winner method again', () => {
    const { conference, emit, sentPayloads } = createFakeJitsiConference({
      methods: ['sendMessage'],
      throwOnSend: true,
    });
    const transport = fromJitsiConference(conference);
    emit('conference.dataChannelOpened');
    transport.send('first'); // throws internally once -> degraded
    expect(transport.state).toBe('degraded');

    emit('conference.dataChannelOpened'); // re-latch

    expect(transport.state).toBe('ready');
    transport.send('second');
    expect(sentPayloads).toEqual([{ method: 'sendMessage', payload: 'second' }]);
  });

  it('onStateChange(fn) fires fn on every transition in order (subscribing after construction, when the adapter is already ready by default, observes no initial-ready transition); unsubscribe stops further notifications', () => {
    const { conference, emit } = createFakeJitsiConference({ methods: ['sendMessage'] });
    const transport = fromJitsiConference(conference);
    const observed: string[] = [];
    const unsubscribe = transport.onStateChange((s) => observed.push(s));

    emit('conference.dataChannelOpened'); // already ready -> no-op, not observed
    emit('conference.dataChannelClosed'); // ready -> degraded
    emit('conference.dataChannelOpened'); // degraded -> ready

    expect(observed).toEqual(['degraded', 'ready']);

    unsubscribe();
    emit('conference.dataChannelClosed');

    expect(observed).toEqual(['degraded', 'ready']);
  });
});

// 04-02-PLAN.md Task 3: every p2p.enabled warning branch PROTO-08 describes,
// including the conference.isP2PEnabled() correction found during Plan 04-01.

describe('fromJitsiConference — p2p warning branch matrix (PROTO-08)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('opts.p2pEnabled: false suppresses the warning, regardless of conference.isP2PEnabled', () => {
    const { conference } = createFakeJitsiConference({ methods: ['sendMessage'], p2pEnabled: true });

    fromJitsiConference(conference, { p2pEnabled: false });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('opts.p2pEnabled: true fires the warning even if conference.isP2PEnabled() would return false', () => {
    const { conference } = createFakeJitsiConference({ methods: ['sendMessage'], p2pEnabled: false });

    fromJitsiConference(conference, { p2pEnabled: true });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/^\[jitsi-scribble\] /);
  });

  it('no opts.p2pEnabled, conference has no isP2PEnabled method: warns (unconfirmed defaults to warn)', () => {
    const { conference } = createFakeJitsiConference({ methods: ['sendMessage'] });

    fromJitsiConference(conference);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/^\[jitsi-scribble\] /);
  });

  it('no opts.p2pEnabled, conference.isP2PEnabled() returns false: no warning', () => {
    const { conference } = createFakeJitsiConference({ methods: ['sendMessage'], p2pEnabled: false });

    fromJitsiConference(conference);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('no opts.p2pEnabled, conference.isP2PEnabled() returns true: warns', () => {
    const { conference } = createFakeJitsiConference({ methods: ['sendMessage'], p2pEnabled: true });

    fromJitsiConference(conference);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/^\[jitsi-scribble\] /);
  });
});
