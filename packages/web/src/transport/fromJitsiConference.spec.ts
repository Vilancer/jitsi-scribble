import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

    expect(sentPayloads).toMatchObject([{ method: 'sendMessage', payload: 'hello' }]);
  });

  it('conference exposing only broadcastEndpointMessage: send() calls broadcastEndpointMessage', () => {
    const { conference, emit, sentPayloads } = createFakeJitsiConference({
      methods: ['broadcastEndpointMessage'],
    });
    const transport = fromJitsiConference(conference);

    emit('conference.dataChannelOpened');
    transport.send('hello');

    expect(sentPayloads).toMatchObject([{ method: 'broadcastEndpointMessage', payload: 'hello' }]);
  });

  it('conference exposing only sendEndpointMessage: send() calls sendEndpointMessage', () => {
    const { conference, emit, sentPayloads } = createFakeJitsiConference({
      methods: ['sendEndpointMessage'],
    });
    const transport = fromJitsiConference(conference);

    emit('conference.dataChannelOpened');
    transport.send('hello');

    expect(sentPayloads).toMatchObject([{ method: 'sendEndpointMessage', payload: 'hello' }]);
  });

  it('conference exposing all three: send() calls sendMessage, never the other two (probe order is preference order)', () => {
    const { conference, emit, sentPayloads } = createFakeJitsiConference({
      methods: ['sendMessage', 'broadcastEndpointMessage', 'sendEndpointMessage'],
    });
    const transport = fromJitsiConference(conference);

    emit('conference.dataChannelOpened');
    transport.send('hello');

    expect(sentPayloads).toMatchObject([{ method: 'sendMessage', payload: 'hello' }]);
  });

  it('conference exposing broadcastEndpointMessage and sendEndpointMessage (no sendMessage): send() calls broadcastEndpointMessage, never sendEndpointMessage', () => {
    const { conference, emit, sentPayloads } = createFakeJitsiConference({
      methods: ['broadcastEndpointMessage', 'sendEndpointMessage'],
    });
    const transport = fromJitsiConference(conference);

    emit('conference.dataChannelOpened');
    transport.send('hello');

    expect(sentPayloads).toMatchObject([{ method: 'broadcastEndpointMessage', payload: 'hello' }]);
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
    expect(sentPayloads).toMatchObject([{ method: 'sendMessage', payload: 'immediate' }]);
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
    expect(sentPayloads).toMatchObject([{ method: 'sendMessage', payload: 'after-relatch' }]);
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
    expect(sentPayloads).toMatchObject([{ method: 'sendMessage', payload: 'second' }]);
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

// PROTO-10 (Plan 06-02 Task 2): this behavioral + source-inspection pair is
// the PRIMARY proof that stroke traffic never falls back to XMPP. A
// Prosody-log-based assertion was evaluated and rejected as a false-negative
// trap (RESEARCH.md Pitfall R1): at this deployment's default log verbosity
// (LOG_LEVEL=info, no stanza-dump directive), a build secretly sending over
// XMPP would still produce a clean log, so a log grep passes either way. The
// manual LOG_LEVEL=debug confirmatory spike (RESEARCH.md Open Question 3)
// remains optional and was not performed this phase, given the deployment's
// documented prior disk-exhaustion incident from unbounded logging.
describe('fromJitsiConference — PROTO-10: no XMPP-fallback candidate', () => {
  it('sendMessage is always invoked with viaBridge === true — the bridge-channel path, never the XMPP path', () => {
    const { conference, emit, sentPayloads } = createFakeJitsiConference({ methods: ['sendMessage'] });
    const transport = fromJitsiConference(conference, { p2pEnabled: false });

    emit('conference.dataChannelOpened');
    transport.send('proto-10-probe');

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0].method).toBe('sendMessage');
    // lib-jitsi-meet's own sendMessage(message, to, sendThroughVideobridge)
    // signature: a literal `false` third argument IS the XMPP fallback.
    expect(sentPayloads[0].args[2]).toBe(true);
  });

  it("resolveSend()'s probe list contains no viaBridge=false candidate at the source level", () => {
    // vitest runs with cwd at the package root (pnpm --filter @vilancer/web);
    // import.meta.url is rewritten to a non-file scheme under this setup.
    const sourcePath = join(process.cwd(), 'src/transport/fromJitsiConference.ts');
    // Strip comments first: resolveSend()'s own docblock deliberately names
    // the unimplemented `sendMessage(payload, '', false)` extension point,
    // which must not false-positive this assertion.
    const source = readFileSync(sourcePath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    // The only sendMessage invocation passes a literal `true` third argument…
    expect(source).toMatch(/\(p,\s*'',\s*true\)/);
    // …and no call site anywhere passes `false` as the third argument.
    expect(source).not.toMatch(/\(p,\s*'',\s*false\)/);
    expect(source).not.toMatch(/sendMessage[^\n]*false\s*\)/);
  });
});
