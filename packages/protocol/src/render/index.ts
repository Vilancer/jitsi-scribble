// The shared render-policy math (D-01) — identity->colour hash and the
// casing/core stroke-width constants every renderer (web now, RN in Phase 5,
// native-overlay in Phase 7) imports unchanged. See
// .planning/research/FEATURES.md "Fade timing, stroke width, and colour:
// concrete numbers" for the numbers themselves (this file locates them, it
// does not invent them) and .planning/phases/04-jitsi-transport-adapter-and-web-renderer/04-CONTEXT.md
// D-01 for why this lives here, once, in protocol, rather than duplicated
// per renderer package.
//
// Pure functions, zero platform dependency — runs under plain node, no
// device/browser/Jitsi conference required to test. No effect/Schema, no
// DOM, no React, no React Native — safe for the root barrel (matches the
// same bar packages/protocol/src/index.ts's own comment states for
// codec/geometry/transport/core).

/**
 * The CVD-safe categorical colour palette (D-01). Published Okabe-Ito Color
 * Universal Design palette [CITED: Okabe & Ito, "Color Universal Design
 * (CUD)", 2002; Wong, B. "Points of view: Color blindness", Nature Methods 8,
 * 441 (2011)] — chosen because it was built and independently validated to
 * satisfy FEATURES.md's constraints (blue/orange-first pair, high chroma,
 * avoid red/green, sized ~6), rather than picked by eye this phase.
 */
export const PARTICIPANT_COLOUR_PALETTE: readonly string[] = [
  '#0072B2', // blue      — entry 0: paired with entry 1 as the maximally-distinguishable 1:1 pair
  '#E69F00', // orange    — entry 1
  '#009E73', // bluish green
  '#D55E00', // vermilion
  '#CC79A7', // reddish purple
  '#F0E442', // yellow
] as const;

/**
 * FNV-1a 32-bit — a small, well-known, public-domain string hash.
 * Deterministic: the same participant id always maps to the same palette
 * entry across rejoins (FEATURES.md: "not random, or the same person changes
 * colour on rejoin"). Jitsi participant ids are confirmed 8 lowercase-hex-char
 * ASCII strings (Phase 3 finding, STATE.md) — this hash makes no assumption
 * about that shape, so it also works for the LOCAL_SENDER sentinel and any
 * future non-Jitsi id source.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic identity->colour mapping (D-01) — same id always resolves
 * to the same PARTICIPANT_COLOUR_PALETTE entry. */
export function colourForParticipant(id: string): string {
  const index = fnv1a(id) % PARTICIPANT_COLOUR_PALETTE.length;
  return PARTICIPANT_COLOUR_PALETTE[index];
}

/** FEATURES.md "Stroke geometry" table, verbatim: the core stroke's width in
 * device-independent pixels before computeStrokeWidth's letterbox scaling. */
export const CORE_WIDTH_DP = 4 as const;

/** FEATURES.md "Stroke geometry" table, verbatim: how much wider than the
 * core the dark casing stroke drawn behind it is, in device-independent
 * pixels (added to CORE_WIDTH_DP, not a standalone width). */
export const CASING_EXTRA_WIDTH_DP = 2.5 as const;

/** FEATURES.md "Stroke geometry" table, verbatim: the casing stroke's
 * near-black, ~55%-alpha colour, drawn behind the participant-coloured core
 * so any core colour reads against any video content. */
export const CASING_COLOUR = 'rgba(0, 0, 0, 0.55)' as const;
