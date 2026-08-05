import { describe, expect, it } from 'vitest';

import { colourForParticipant, PARTICIPANT_COLOUR_PALETTE } from './index.js';

// D-01: identity->colour hash must be deterministic (same id always resolves
// to the same palette entry across rejoins) and must always resolve to a
// member of the published Okabe-Ito palette.

describe('colourForParticipant', () => {
  it('is deterministic — the same id resolves to the same colour every time', () => {
    const first = colourForParticipant('remote-1');
    const second = colourForParticipant('remote-1');
    expect(second).toBe(first);
  });

  it('always returns a member of PARTICIPANT_COLOUR_PALETTE', () => {
    const ids = ['remote-1', 'abc123ef', '__local__', '', 'participant-99', 'x'];
    for (const id of ids) {
      expect(PARTICIPANT_COLOUR_PALETTE).toContain(colourForParticipant(id));
    }
  });

  it('resolves at least two different ids to different palette entries', () => {
    const colours = new Set(['remote-1', 'remote-2', 'remote-3', 'remote-4', 'remote-5', 'remote-6'].map(colourForParticipant));
    expect(colours.size).toBeGreaterThan(1);
  });
});
