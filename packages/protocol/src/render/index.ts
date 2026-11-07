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

/** The drawing tools, in toolbar order. Wire value is the string itself. */
export const SCRIBBLE_TOOLS = ['pen', 'marker', 'pencil', 'crayon'] as const;
export type ScribbleTool = (typeof SCRIBBLE_TOOLS)[number];

/** The shapes the toolbar offers. A shape travels on the wire as an ordinary
 * stroke (its outline as points), so receivers need no shape support. */
export const SCRIBBLE_SHAPES = ['line', 'arrow', 'rect', 'ellipse'] as const;
export type ScribbleShape = (typeof SCRIBBLE_SHAPES)[number];

/** Toolbar colour swatches, iOS system colours (dark-mode variants, which
 * read well on top of video): white, black, blue, green, yellow, red. */
export const SCRIBBLE_COLOURS: readonly string[] = [
  '#FFFFFF',
  '#000000',
  '#0A84FF',
  '#30D158',
  '#FFD60A',
  '#FF453A',
] as const;

/** The bigger "more colours" grid behind the spectrum swatch: 12 hues by 5
 * lightness steps, then a grey ramp. Pure data so every renderer shows the
 * same grid. */
export function colourGrid(): readonly (readonly string[])[] {
  const hues = [0, 25, 45, 60, 90, 140, 175, 200, 220, 260, 290, 330];
  const rows: string[][] = [];
  for (const l of [0.8, 0.65, 0.5, 0.38, 0.26]) {
    rows.push(hues.map((h) => hslToHex(h, l > 0.7 ? 0.75 : 0.9, l)));
  }
  const greys: string[] = [];
  for (let i = 0; i < 12; i++) {
    const g = Math.round(255 * (1 - i / 11));
    greys.push(rgbToHex(g, g, g));
  }
  rows.push(greys);
  return rows;
}

/** Stroke sizes (dp) offered by the toolbar's size picker. */
export const SCRIBBLE_WIDTHS = [2, 3, 4, 6, 9, 12, 18] as const;

/** Per-tool rendering recipe every renderer follows. Width is the style's
 * width times `widthScale`; opacity multiplies the fade alpha. `casing`
 * draws the dark outline behind the core (pen only: it keeps a thin line
 * readable on any video). `texture` names how the edge is roughened. */
export interface ToolRecipe {
  readonly widthScale: number;
  readonly opacity: number;
  readonly casing: boolean;
  readonly cap: 'round' | 'butt';
  readonly texture: 'none' | 'grain' | 'wax';
}

export const TOOL_RECIPES: Readonly<Record<ScribbleTool, ToolRecipe>> = {
  pen: { widthScale: 1, opacity: 1, casing: true, cap: 'round', texture: 'none' },
  marker: { widthScale: 3, opacity: 0.45, casing: false, cap: 'butt', texture: 'none' },
  pencil: { widthScale: 0.75, opacity: 0.9, casing: false, cap: 'round', texture: 'grain' },
  crayon: { widthScale: 2, opacity: 0.85, casing: false, cap: 'round', texture: 'wax' },
};

/** The recipe for any tool string, falling back to the pen for a tool this
 * version doesn't know. */
export function toolRecipe(tool: string | undefined): ToolRecipe {
  return (tool && (TOOL_RECIPES as Record<string, ToolRecipe>)[tool]) || TOOL_RECIPES.pen;
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}
