import { describe, expect, it } from 'vitest';

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
