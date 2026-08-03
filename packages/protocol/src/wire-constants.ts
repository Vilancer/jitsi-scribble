// Wire-format constants shared by both independent representations of the
// wire format: /schema (effect/Schema, web/tests) and /codec (hand-written,
// Hermes-safe, React Native). Zero dependencies — importable by either side
// of the codec/schema divergence-risk boundary without pulling effect/Schema
// into the RN-facing codec bundle (see ARCHITECTURE.md section 2).

/** Current wire-protocol version. A frame whose `v` field doesn't match this
 * exact value is rejected outright, never decoded under the current
 * version's field-shape assumptions (PROTO-01). */
export const PROTOCOL_VERSION = 1 as const;

/**
 * The real (unquantized) normalized-coordinate domain a point is drawn from,
 * on both u and v. Deliberately wider than [0,1]: per ARCHITECTURE.md
 * section 3.6's "transmit unclamped" policy, a move point dragged into the
 * letterbox bars around a `contain`-fit video is still representable on the
 * wire without being clamped back into range before it's sent — each
 * receiver clips locally at render time instead.
 */
export const QUANT_MIN = -0.5 as const;
export const QUANT_MAX = 1.5 as const;

/** The 12-bit unsigned integer domain [0, QUANT_STEPS] that [QUANT_MIN,
 * QUANT_MAX] is linearly quantized into on the wire. */
export const QUANT_STEPS = 4095 as const;

/** Maximum number of points a single `move` frame may carry. An oversized
 * array is rejected outright ('too-many-points'), never truncated
 * (PROTO-09 / T-02-03-02). */
export const MAX_POINTS_PER_MESSAGE = 64 as const;

/** Inclusive bounds on identifier field length (`from`, `id`) — counted as
 * JavaScript string .length (UTF-16 code units), consistently between
 * codec.decode() and schema's Schema.String length refinements. */
export const MIN_IDENTIFIER_LENGTH = 1 as const;
export const MAX_IDENTIFIER_LENGTH = 128 as const;

/** Short single-character message-type tags, matching ARCHITECTURE.md
 * section 5's own `t:'m'` example — chosen for wire-size economy. */
export const MSG_START = 's' as const;
export const MSG_MOVE = 'm' as const;
export const MSG_END = 'e' as const;
export const MSG_CLEAR = 'c' as const;
export const MSG_PRESENCE = 'p' as const;
