// The effect/Schema representation of the wire format — used by web/tests
// and to generate fuzz cases for /codec (ARCHITECTURE.md section 2). Never
// re-exported from the package root barrel: importing effect/Schema throws
// at import time on any engine lacking TextEncoder/TextDecoder (bare React
// Native / Hermes without Expo's TextDecoder install) — see wire-constants.ts
// and the root index.ts comment for the full rationale.
//
// Subpath-imported per STACK.md's "Prescribed Effect usage rules": never
// `import * as Effect from 'effect'` (the barrel), always
// `import * as Schema from 'effect/Schema'`.
import * as Schema from 'effect/Schema';

import {
  MAX_IDENTIFIER_LENGTH,
  MAX_POINTS_PER_MESSAGE,
  MIN_IDENTIFIER_LENGTH,
  MSG_CLEAR,
  MSG_END,
  MSG_MOVE,
  MSG_PRESENCE,
  MSG_START,
  PROTOCOL_VERSION,
  QUANT_STEPS,
} from '../wire-constants.js';

/** Every member schema shares this exact-version literal — a frame whose `v`
 * does not equal PROTOCOL_VERSION is rejected (`version-mismatch` on the
 * codec side), never decoded under the current version's field-shape
 * assumptions. Must agree with codec.decode()'s `v === PROTOCOL_VERSION`
 * check (see roundtrip.spec.ts's accept/reject parity assertions). */
const Version = Schema.Literal(PROTOCOL_VERSION);

/** Every identifier field (`from`, `id`) shares the same length refinement,
 * counted as JS string .length (UTF-16 code units) — must agree with
 * codec.decode()'s identical `.length` check (see roundtrip.spec.ts). */
const Identifier = Schema.String.pipe(
  Schema.minLength(MIN_IDENTIFIER_LENGTH),
  Schema.maxLength(MAX_IDENTIFIER_LENGTH),
);

/** Every coordinate is the already-quantized 12-bit integer domain
 * [0, QUANT_STEPS] — NOT the raw float u/v. Quantize/dequantize is the
 * codec's job; the wire-level shape stays identical between codec and
 * schema. */
const Coordinate = Schema.Number.pipe(Schema.int(), Schema.between(0, QUANT_STEPS));

const Point = Schema.Tuple(Coordinate, Coordinate);

const FrameDims = Schema.Struct({
  w: Schema.Number,
  h: Schema.Number,
});

const StartFrameSchema = Schema.Struct({
  v: Version,
  t: Schema.Literal(MSG_START),
  from: Identifier,
  id: Identifier,
  p: Point,
  frame: FrameDims,
});

const MoveFrameSchema = Schema.Struct({
  v: Version,
  t: Schema.Literal(MSG_MOVE),
  from: Identifier,
  id: Identifier,
  pts: Schema.Array(Point).pipe(Schema.minItems(1), Schema.maxItems(MAX_POINTS_PER_MESSAGE)),
});

const EndFrameSchema = Schema.Struct({
  v: Version,
  t: Schema.Literal(MSG_END),
  from: Identifier,
  id: Identifier,
});

const ClearFrameSchema = Schema.Struct({
  v: Version,
  t: Schema.Literal(MSG_CLEAR),
  from: Identifier,
});

const PresenceFrameSchema = Schema.Struct({
  v: Version,
  t: Schema.Literal(MSG_PRESENCE),
  from: Identifier,
  vis: Schema.Boolean,
});

/** The discriminated union over all 5 wire message types, keyed on `t`. */
export const WireFrameSchema = Schema.Union(
  StartFrameSchema,
  MoveFrameSchema,
  EndFrameSchema,
  ClearFrameSchema,
  PresenceFrameSchema,
);

export type WireFrame = Schema.Schema.Type<typeof WireFrameSchema>;
export type StartFrame = Schema.Schema.Type<typeof StartFrameSchema>;
export type MoveFrame = Schema.Schema.Type<typeof MoveFrameSchema>;
export type EndFrame = Schema.Schema.Type<typeof EndFrameSchema>;
export type ClearFrame = Schema.Schema.Type<typeof ClearFrameSchema>;
export type PresenceFrame = Schema.Schema.Type<typeof PresenceFrameSchema>;
