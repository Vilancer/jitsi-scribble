// StrokeStore — the render-agnostic local-authoring lifecycle and
// injected-clock state machine (CORE-01, CORE-02, D-01, D-02). Per CONTEXT.md
// D-01, Effect (Ref + Effect.runSync) is used internally for state, but per
// D-02 every public method stays a plain, synchronous, callback-based
// function — no caller of this class needs any Effect runtime knowledge.
// Consequence: `tick(now)` is the ONLY place phase/alpha/eviction are
// computed (RESEARCH.md Pattern 1's "now in snapshot()" note) — no method
// other than tick() may mutate phase/alpha, and snapshot() is a pure
// projection of whatever the last tick(now) call cached.
//
// This file imports nothing from react, react-dom, react-native, any DOM
// global, or lib-jitsi-meet, and this is the ONE `StrokeStore` implementation
// every renderer (RN overlay, web, native overlay) consumes unchanged (CORE-07)
// — do not add a per-renderer subclass or fork.

import * as Effect from 'effect/Effect';
import * as Ref from 'effect/Ref';

import { decode } from '../codec/index.js';
// Type-only import — erased at compile time, matching codec/index.ts's own
// convention. This does NOT pull effect/Schema into core's emitted .js,
// since it is a type, never a value, import.
import type { WireFrame } from '../schema/index.js';
import {
  MAX_IDENTIFIER_LENGTH,
  MSG_CLEAR,
  MSG_END,
  MSG_MOVE,
  MSG_PRESENCE,
  MSG_START,
  PROTOCOL_VERSION,
  QUANT_MAX,
  QUANT_MIN,
  QUANT_STEPS,
} from '../wire-constants.js';

// Re-exported (not just imported) so a consumer that needs to hand-construct
// a WireFrame — e.g. useScribbleSession.ts's Presence frame, which is
// deliberately built by hand rather than via effect/Schema's
// PresenceFrameSchema, per PKG-04 — can reach PROTOCOL_VERSION/MSG_PRESENCE
// through this already-RN-safe subpath instead of needing a new one. Keeps
// this plan's new files importing only the already-enumerated
// /core, /geometry, /render, /transport, /codec subpaths.
export { MSG_CLEAR, MSG_END, MSG_MOVE, MSG_PRESENCE, MSG_START, PROTOCOL_VERSION };

/** A stroke holds at full opacity for this long (ms) after its effective end
 * time, before it starts fading (CORE-02). Half-open interval: at
 * `elapsed === HOLD_MS` exactly, the stroke has already moved into the
 * fading branch (see computePhaseAndAlpha) — do not "fix" this boundary. */
export const HOLD_MS = 2000 as const;

/** After HOLD_MS elapses, a stroke's alpha fades linearly from 1 to 0 over
 * this long (ms) (CORE-02). */
export const FADE_MS = 500 as const;

/** ARCHITECTURE.md section 4.2's stale-watchdog figure: a stroke with no
 * `appendLocal`/move for this long (ms) while still nominally live is
 * treated as if `end` arrived at `lastMoveAt + STALE_MS` — tolerates a lost
 * `end` message (CORE-06's sibling concern) without leaving a stroke stuck
 * live forever. */
export const STALE_MS = 1500 as const;

/** Internal sentinel `from` value every beginLocal-authored stroke is tagged
 * with — never a real Jitsi participant id. Used ONLY for internal
 * map-keying and clear('mine') scoping; never sent on the wire. */
export const LOCAL_SENDER = '__local__' as const;

/** D-03's conservative defensive-cap numbers, biasing toward protecting
 * low-end Android memory. A hostile/broken sender cannot grow the store
 * past these bounds (CORE-04, T-03-02-01) — enforced by
 * `enforceCapsBeforeInsert`/`appendPointsCapped`, never by rejecting an
 * insert/append wholesale. */
export const MAX_STROKES_PER_SENDER = 4 as const;
export const MAX_TOTAL_STROKES = 16 as const;
export const MAX_POINTS_PER_STROKE = 256 as const;

/** D-04's per-sender receive-rate token-bucket capacity: ~3x the ~30 msg/s
 * legitimate coalesced rate, chosen wide to absorb a stall-then-burst
 * recovery pattern on the reliable-ordered, no-backpressure data channel
 * (CORE-05, T-03-02-02) — a narrower threshold would misclassify that
 * recovery burst as hostile. */
export const RATE_CAPACITY = 90 as const;

/** RATE_CAPACITY expressed as tokens-refilled-per-millisecond, for the
 * token-bucket refill formula in checkRateLimit. */
const RATE_PER_MS = RATE_CAPACITY / 1000;

/** WR-02's defensive cap on the number of distinct `from` keys tracked in
 * `rateLimitBuckets` — mirrors D-03's "hostile/broken sender cannot grow the
 * store past these bounds" goal, but for the rate-limiter's own bookkeeping
 * Map, which otherwise has no cap at all (unlike the stroke-count state).
 * Generous enough to comfortably exceed any realistic Jitsi conference's
 * participant count, narrow enough that a sender/relay spraying many
 * distinct (or very long) `from` values cannot grow this Map unbounded. */
export const MAX_TRACKED_RATE_LIMIT_SENDERS = 64 as const;

/** PROTO-03's outbound move-coalescing time window (ms): a local stroke's
 * buffered points flush as one coalesced Move WireFrame once at least this
 * long has elapsed since the last flush for that stroke. Closed lower bound
 * — `elapsed >= MOVE_COALESCE_TIME_MS` triggers the flush, not `>`. */
export const MOVE_COALESCE_TIME_MS = 33 as const;

/** PROTO-03's outbound move-coalescing distance threshold, in the store's
 * normalized [QUANT_MIN, QUANT_MAX] coordinate domain: a point at least this
 * far from the last flushed point makes the NEXT tick() flush immediately
 * even if MOVE_COALESCE_TIME_MS hasn't elapsed yet. Derivation (this plan's
 * own arithmetic, not independently sourced — no prior doc gives a
 * normalized-space epsilon for "~4dp" directly, since the store deliberately
 * never touches pixels/dp): ARCHITECTURE.md section 5 anchors its own
 * ε≈0.004 normalized threshold to "≈1.5 px on a 390 px-wide tile"
 * (0.004/1.5 ≈ 0.002667 normalized per reference-pixel). PROTO-03's refined
 * "~4dp" figure, scaled by that same reference-tile methodology, is
 * 4 × 0.002667 ≈ 0.0107, rounded to 0.01. */
export const MOVE_COALESCE_DISTANCE_EPSILON = 0.01 as const;

/** PROTO-03's exact wire-size budget: a coalesced Move WireFrame, encoded via
 * codec.encode(), must be at most this many bytes. Measured via
 * codec.encode(frame).length — a JS string's UTF-16-code-unit .length used as
 * a byte-count proxy; numerically exact for ASCII sender/stroke identifiers
 * (the practical case for Jitsi participant ids and locally-generated stroke
 * ids), unverified for non-ASCII ones (accepted, not closed, per this plan's
 * own must_haves backstop truth). This is a coalescing-CADENCE target, not
 * MAX_POINTS_PER_MESSAGE's job (RESEARCH.md Pitfall 2) — the coalescer must
 * independently target a much smaller points-per-flush count than the
 * decode-time 64-point safety ceiling. */
export const MOVE_WIRE_BYTE_BUDGET = 600 as const;

export interface FrameDims {
  readonly w: number;
  readonly h: number;
}

/**
 * The public, render-agnostic shape of a stroke. No `style` field this phase
 * (deferred to Phase 5 / DRAW-06-07, per RESEARCH.md Open Question 3).
 * `frame` is `undefined` for a stroke that never carried frame dims (e.g. a
 * future orphan-move case, Plan 03-02) — a consumer must treat that as "no
 * aspect-repair possible for this stroke, render as-is."
 */
export interface Stroke {
  readonly id: string;
  readonly from: string;
  readonly points: readonly (readonly [number, number])[];
  readonly frame: FrameDims | undefined;
  readonly phase: 'live' | 'fading' | 'dead';
  readonly fadeStartedAt: number | undefined;
  readonly alpha: number;
  /** D-01's tap/drag classification, set only by endLocal(id, kind) or by an
   * inbound End WireFrame carrying `kind`. `undefined` (never a literal
   * 'stroke' default assigned anywhere in this file) is the correct value
   * for every stroke that hasn't ended yet, or ended before this field
   * existed — "defaults to stroke" is a rendering-layer convention a
   * consumer applies via its own `stroke.kind === 'tap'` check. */
  readonly kind: 'tap' | 'stroke' | undefined;
}

/** Internal-only stroke record — a mutable working copy of `Stroke`'s
 * fields (deliberately NOT `extends Stroke`, since every `Stroke` field is
 * `readonly` and this record is `tick()`/`apply()`'s mutation target; TS's
 * interface-extension rules do not let a derived interface relax a
 * `readonly` modifier declared on the base) plus the raw timestamps
 * `tick()` needs to recompute phase/alpha. `toPublicStroke()` is the only
 * place this shape is projected onto the public, readonly `Stroke` type. */
interface StrokeInternal {
  id: string;
  from: string;
  points: (readonly [number, number])[];
  frame: FrameDims | undefined;
  phase: 'live' | 'fading' | 'dead';
  fadeStartedAt: number | undefined;
  alpha: number;
  endedAt: number | undefined;
  lastMoveAt: number;
  createdAt: number;
  kind: 'tap' | 'stroke' | undefined;
}

interface StoreState {
  /** Keyed by the composite string `${from} ${id}` (space separator) — never
   * by `id` alone, so two different senders' identically-named strokes
   * cannot collide (RESEARCH.md Pitfall 4). */
  strokes: Map<string, StrokeInternal>;
}

/**
 * Pure function of `now` and a stroke's two timestamps — no `setTimeout`, no
 * `setInterval`, no `Date.now()`, anywhere in this file (CORE-01's injected-
 * clock contract). Folds a missing `endedAt` into the stale watchdog's
 * synthesized end (`lastMoveAt + staleMs`) once `now - lastMoveAt >=
 * staleMs`. Half-open-interval note: at `elapsed === holdMs` exactly, the
 * first branch's `<` is false, so it falls into the fading branch with
 * alpha exactly 1 — this is intentional (CORE-02's boundary reads as
 * fading, not live), not a bug to "fix".
 */
export function computePhaseAndAlpha(
  now: number,
  s: { endedAt: number | undefined; lastMoveAt: number },
  timing: { holdMs: number; fadeMs: number; staleMs: number } = { holdMs: HOLD_MS, fadeMs: FADE_MS, staleMs: STALE_MS },
): { phase: 'live' | 'fading' | 'dead'; alpha: number } {
  const effectiveEndedAt =
    s.endedAt ?? (now - s.lastMoveAt >= timing.staleMs ? s.lastMoveAt + timing.staleMs : undefined);

  if (effectiveEndedAt === undefined) return { phase: 'live', alpha: 1 };

  const elapsed = now - effectiveEndedAt;
  if (elapsed < timing.holdMs) return { phase: 'live', alpha: 1 };
  if (elapsed < timing.holdMs + timing.fadeMs) {
    return { phase: 'fading', alpha: 1 - (elapsed - timing.holdMs) / timing.fadeMs };
  }
  return { phase: 'dead', alpha: 0 };
}

/**
 * Maps a real-domain normalized coordinate (`wire-constants.ts`'s
 * [QUANT_MIN, QUANT_MAX] = [-0.5, 1.5] domain) into the wire's 12-bit
 * unsigned integer domain [0, QUANT_STEPS] (RESEARCH.md Pattern 4's exact
 * linear-map formula). The `Math.min(Math.max(...))` clamp exists ONLY to
 * keep the result inside the wire's representable integer range before
 * rounding — a hard requirement, since an out-of-range integer would fail
 * `codec.decode()`'s own validation on the receiving end. This does NOT
 * contradict ARCHITECTURE.md section 3.6's "never clamp (u,v)" policy: that
 * policy is about geometry's point-rejection semantics (whether to keep or
 * drop a point), not about the wire's numeric encoding boundary.
 */
export function quantize(real: number): number {
  const clamped = Math.min(Math.max(real, QUANT_MIN), QUANT_MAX);
  return Math.round(((clamped - QUANT_MIN) / (QUANT_MAX - QUANT_MIN)) * QUANT_STEPS);
}

/** Inverse of `quantize` — maps a wire integer back into the real-domain
 * normalized coordinate. `dequantize(quantize(x))` is within `1/QUANT_STEPS`
 * of `x` for any `x` in `[QUANT_MIN, QUANT_MAX]` (RESEARCH.md Pattern 4). */
export function dequantize(q: number): number {
  return QUANT_MIN + (q / QUANT_STEPS) * (QUANT_MAX - QUANT_MIN);
}

function toPublicStroke(s: StrokeInternal): Stroke {
  return {
    id: s.id,
    from: s.from,
    // WR-03: defensive copies, not the live internal references. `readonly`
    // on Stroke.points/.frame is compile-time-only — nothing at runtime
    // stops a consumer from mutating an array/object returned by
    // snapshot(), and appendPointsCapped later spreads off this exact same
    // `points` reference, so an external mutation of a previously-returned
    // snapshot would corrupt the live store's future state.
    points: [...s.points],
    frame: s.frame ? { ...s.frame } : undefined,
    phase: s.phase,
    fadeStartedAt: s.fadeStartedAt,
    alpha: s.alpha,
    kind: s.kind,
  };
}

/**
 * The render-agnostic local-authoring lifecycle and injected-clock state
 * machine (CORE-01, CORE-02, D-01, D-02). Effect (`Ref` + `Effect.runSync`)
 * is used internally for state (D-01); every public method stays plain and
 * synchronous (D-02).
 */
export class StrokeStore {
  private readonly state: Ref.Ref<StoreState>;
  private readonly subscribers = new Set<(strokes: readonly Stroke[]) => void>();
  /** onOutbound subscribers (PROTO-03) — a second, independent Set, notified
   * ONLY from beginLocal/appendLocal/endLocal/tick's local-flush pass, never
   * from apply()'s remote-ingest branches (T-03-03-01). Copies the exact
   * Set.add / return-delete-closure idiom `subscribe` and transport/index.ts
   * already use. */
  private readonly outboundSubscribers = new Set<(frame: WireFrame) => void>();
  /** Per-sender token buckets (D-04/CORE-05) — deliberately a plain `Map`
   * OUTSIDE the `Ref`-wrapped StoreState, since it is bookkeeping, not
   * shareable snapshot state, following the same "plain field beside the
   * Ref" precedent transport/index.ts sets for its subscribers/stateListeners
   * Sets. */
  private readonly rateLimitBuckets = new Map<
    string,
    { tokens: number; lastRefillAt: number; warnedSinceRecovery: boolean }
  >();
  /** Per-local-stroke outbound-coalescing bookkeeping (PROTO-03), keyed by
   * the PLAIN `id` (not the composite `${from} ${id}` key — this bookkeeping
   * only ever exists for local strokes, whose sender is always `LOCAL_SENDER`
   * internally). Deliberately a plain field beside the Ref, same rationale as
   * `rateLimitBuckets` above. */
  private readonly localOutbound = new Map<
    string,
    {
      pendingPoints: Array<readonly [number, number]>;
      lastFlushAt: number;
      lastFlushPoint: readonly [number, number] | undefined;
    }
  >();
  private readonly holdMs: number;
  private readonly fadeMs: number;
  private readonly staleMs: number;
  private readonly maxStrokesPerSender: number;
  private readonly maxTotalStrokes: number;
  private readonly maxPointsPerStroke: number;
  /** The `from` field stamped onto every outbound WireFrame this store
   * emits (PROTO-03) — used ONLY for that purpose, never for internal
   * map-keying, which always uses the LOCAL_SENDER sentinel (Plan 03-01). */
  private readonly localId: string;
  /** The injected-clock cache every non-tick public method reads instead of
   * Date.now(). Since beginLocal/appendLocal/endLocal take no `now`
   * parameter per the locked D-02 signature list, they timestamp against
   * whatever tick(now) most recently cached — fully deterministic given a
   * sequence of tick() calls, needing no fake timers to test. */
  private lastTickNow = 0;

  constructor(opts?: {
    holdMs?: number;
    fadeMs?: number;
    staleMs?: number;
    maxStrokesPerSender?: number;
    maxTotalStrokes?: number;
    maxPointsPerStroke?: number;
    localId?: string;
  }) {
    this.holdMs = opts?.holdMs ?? HOLD_MS;
    this.fadeMs = opts?.fadeMs ?? FADE_MS;
    this.staleMs = opts?.staleMs ?? STALE_MS;
    this.maxStrokesPerSender = opts?.maxStrokesPerSender ?? MAX_STROKES_PER_SENDER;
    this.maxTotalStrokes = opts?.maxTotalStrokes ?? MAX_TOTAL_STROKES;
    this.maxPointsPerStroke = opts?.maxPointsPerStroke ?? MAX_POINTS_PER_STROKE;
    this.localId = opts?.localId ?? LOCAL_SENDER;
    // Ref.unsafeMake needs no Effect runtime — safe to call directly here.
    this.state = Ref.unsafeMake<StoreState>({ strokes: new Map() });
  }

  private key(from: string, id: string): string {
    return `${from} ${id}`;
  }

  /**
   * D-03's total + per-sender cap enforcement, called from inside the SAME
   * Ref.update transaction as the insert it precedes (never a separate
   * Effect.runSync call), so check-then-evict-then-insert is atomic against
   * this single-threaded store. Independent checks — a single insert can
   * trigger both a global eviction and a per-sender eviction if both
   * thresholds are already at their limit (RESEARCH.md Code Examples).
   * Called from THREE sites: beginLocal, apply()'s MSG_START branch, and
   * apply()'s MSG_MOVE orphan-insert branch. Local strokes are NOT exempt
   * from the total cap (CONTEXT.md's Claude's-Discretion item, resolved:
   * counted, since it's a shared memory budget).
   *
   * No log line here — cap eviction is a routine, expected, unlogged state
   * transition (only rate-limit drops log, per D-04/Task 3).
   */
  private enforceCapsBeforeInsert(strokes: Map<string, StrokeInternal>, from: string): void {
    if (strokes.size >= this.maxTotalStrokes) {
      let oldestKey: string | undefined;
      let oldestCreatedAt = Infinity;
      for (const [key, entry] of strokes) {
        if (entry.createdAt < oldestCreatedAt) {
          oldestCreatedAt = entry.createdAt;
          oldestKey = key;
        }
      }
      if (oldestKey !== undefined) strokes.delete(oldestKey);
    }

    const bySender = [...strokes.entries()].filter(([, v]) => v.from === from);
    if (bySender.length >= this.maxStrokesPerSender) {
      const oldest = bySender.reduce((a, b) => (a[1].createdAt <= b[1].createdAt ? a : b));
      strokes.delete(oldest[0]);
    }
  }

  /**
   * D-03's points-per-stroke cap (CORE-04): pushes every new point onto
   * `stroke.points`, then, if the resulting length exceeds
   * `maxPointsPerStroke`, slices the array down to keep only the most
   * recent `maxPointsPerStroke` entries (drop from the front — sliding
   * window, never rejects the whole append). Independent of, and much
   * smaller in scope than, MAX_POINTS_PER_MESSAGE (`codec`'s single-message
   * cap) — this caps a stroke's whole-lifetime total.
   */
  private appendPointsCapped(
    stroke: StrokeInternal,
    newPoints: readonly (readonly [number, number])[],
  ): void {
    const combined = [...stroke.points, ...newPoints];
    stroke.points =
      combined.length > this.maxPointsPerStroke ? combined.slice(combined.length - this.maxPointsPerStroke) : combined;
  }

  /** Begins a locally-authored stroke. Subject to the same total-cap
   * eviction as any remote insert (D-03) — local strokes are NOT exempt.
   * Initializes this stroke's outbound-coalescing bookkeeping (PROTO-03) —
   * the actual Start WireFrame emission happens on the FIRST appendLocal
   * call, not here (matching the wire's own Start-carries-the-first-point
   * shape). */
  beginLocal(id: string, frame: FrameDims): void {
    Effect.runSync(
      Ref.update(this.state, (s) => {
        this.enforceCapsBeforeInsert(s.strokes, LOCAL_SENDER);
        const internal: StrokeInternal = {
          id,
          from: LOCAL_SENDER,
          points: [],
          frame,
          phase: 'live',
          fadeStartedAt: undefined,
          alpha: 1,
          endedAt: undefined,
          createdAt: this.lastTickNow,
          lastMoveAt: this.lastTickNow,
          kind: undefined,
        };
        s.strokes.set(this.key(LOCAL_SENDER, id), internal);
        return s;
      }),
    );
    this.localOutbound.set(id, { pendingPoints: [], lastFlushAt: this.lastTickNow, lastFlushPoint: undefined });
    this.notify();
  }

  /** Appends a point to a locally-authored stroke. Defensive: a lookup miss
   * (no matching beginLocal) is a silent no-op, never throws. Points beyond
   * `maxPointsPerStroke` slide the window (D-03), evicting this stroke's own
   * oldest points, never a different stroke.
   *
   * Outbound coalescing (PROTO-03): the FIRST point ever appended to this
   * stroke (points.length === 1 right after the push) emits a Start
   * WireFrame immediately via emitOutbound — never batched, never waiting
   * for tick(). Every subsequent point is buffered into this stroke's
   * localOutbound.pendingPoints instead, to be flushed as a coalesced Move
   * by tick()'s local-flush pass or by endLocal. */
  appendLocal(id: string, u: number, v: number): void {
    let startFrame: WireFrame | undefined;
    Effect.runSync(
      Ref.update(this.state, (s) => {
        const entry = s.strokes.get(this.key(LOCAL_SENDER, id));
        if (entry) {
          this.appendPointsCapped(entry, [[u, v]]);
          entry.lastMoveAt = this.lastTickNow;
          if (entry.points.length === 1) {
            startFrame = {
              v: PROTOCOL_VERSION,
              t: MSG_START,
              from: this.localId,
              id,
              p: [quantize(u), quantize(v)],
              frame: entry.frame as FrameDims,
            };
          } else {
            this.localOutbound.get(id)?.pendingPoints.push([u, v]);
          }
        }
        return s;
      }),
    );

    if (startFrame) {
      const outbound = this.localOutbound.get(id);
      if (outbound) outbound.lastFlushPoint = [u, v]; // Start point IS the first flush baseline
      this.emitOutbound(startFrame);
    }

    this.notify();
  }

  /** Ends a locally-authored stroke. Idempotent — a second endLocal call on
   * an already-ended stroke is a no-op, never resets the timer, never
   * re-flushes or re-emits an End WireFrame.
   *
   * Outbound coalescing (PROTO-03): BEFORE setting endedAt, flushes any
   * still-pending, not-yet-coalesced points as a final Move WireFrame (so no
   * buffered movement is silently lost when the finger lifts mid-coalescing-
   * window), THEN emits an End WireFrame — in that order — and finally
   * garbage-collects this stroke's localOutbound bookkeeping entry. */
  endLocal(id: string, kind?: 'tap' | 'stroke'): void {
    const key = this.key(LOCAL_SENDER, id);
    const existing = Effect.runSync(Ref.get(this.state)).strokes.get(key);
    const shouldEnd = existing !== undefined && existing.endedAt === undefined;

    if (shouldEnd) this.flushPending(id);

    Effect.runSync(
      Ref.update(this.state, (s) => {
        const entry = s.strokes.get(key);
        if (entry && entry.endedAt === undefined) {
          entry.endedAt = this.lastTickNow;
          if (kind !== undefined) entry.kind = kind;
        }
        return s;
      }),
    );

    if (shouldEnd) {
      this.emitOutbound({
        v: PROTOCOL_VERSION,
        t: MSG_END,
        from: this.localId,
        id,
        ...(kind !== undefined ? { kind } : {}),
      });
      this.localOutbound.delete(id);
    }

    this.notify();
  }

  /** Notifies every registered onOutbound(fn) listener, in registration
   * order (mirrors subscribe()'s existing multi-listener guarantee). Called
   * EXCLUSIVELY from beginLocal/appendLocal/endLocal/tick's local-flush pass
   * — apply()'s remote-ingest branches never call this (T-03-03-01): a
   * remote-originated stroke is never re-broadcast back onto the wire by
   * this store. */
  private emitOutbound(frame: WireFrame): void {
    for (const fn of this.outboundSubscribers) fn(frame);
  }

  /**
   * PROTO-03's outbound move-coalescing flush: reads this stroke's
   * localOutbound entry; if absent or it has zero pending points, this is a
   * no-op (this is what makes "a tick() call with zero pending points fires
   * zero onOutbound events" hold — no empty Move frame is ever constructed).
   * Otherwise builds one Move WireFrame carrying every pending point in
   * append order (quantized), emits it via emitOutbound, then resets the
   * pending-points buffer and records the flush baseline (time + last point)
   * for the next coalescing window. Called from endLocal (a final flush
   * before the End frame) and from tick()'s local-flush pass — never from
   * apply()'s remote-ingest branches.
   */
  private flushPending(id: string): void {
    const outbound = this.localOutbound.get(id);
    if (!outbound || outbound.pendingPoints.length === 0) return;

    const frame: WireFrame = {
      v: PROTOCOL_VERSION,
      t: MSG_MOVE,
      from: this.localId,
      id,
      pts: outbound.pendingPoints.map(([u, v]): [number, number] => [quantize(u), quantize(v)]),
    };
    this.emitOutbound(frame);

    const lastFlushPoint = outbound.pendingPoints[outbound.pendingPoints.length - 1];
    outbound.pendingPoints = [];
    outbound.lastFlushAt = this.lastTickNow;
    outbound.lastFlushPoint = lastFlushPoint;
  }

  /**
   * D-04's per-sender token-bucket receive rate limit (CORE-05,
   * T-03-02-02). Gets-or-creates `from`'s bucket (a new bucket starts at
   * full RATE_CAPACITY, so a brand-new sender's first message is always
   * admitted), refills using floating-point arithmetic capped at
   * RATE_CAPACITY via Math.min (fractional remainder retained between
   * checks, never floored), and admits whenever tokens >= 1. Logs via
   * console.warn a single line naming the sender ONLY on the first
   * over-budget message of an episode (`warnedSinceRecovery` false ->
   * true); a later admitted message re-arms it so a FUTURE over-budget
   * episode logs again (log-once-per-episode, not permanent).
   */
  private checkRateLimit(from: string): boolean {
    let bucket = this.rateLimitBuckets.get(from);
    if (!bucket) {
      // WR-02: this check runs BEFORE decode()'s own identifier-length
      // validation, so a garbage/oversized `from` must never get a bucket
      // created for it in the first place.
      if (from.length > MAX_IDENTIFIER_LENGTH) return false;

      // WR-02: bound the total number of distinct buckets tracked — evict
      // the least-recently-refilled bucket (mirrors
      // enforceCapsBeforeInsert's oldest-by-createdAt eviction pattern) so a
      // sender/relay using many distinct `from` values cannot grow this Map
      // without bound.
      if (this.rateLimitBuckets.size >= MAX_TRACKED_RATE_LIMIT_SENDERS) {
        let oldestFrom: string | undefined;
        let oldestRefillAt = Infinity;
        for (const [key, b] of this.rateLimitBuckets) {
          if (b.lastRefillAt < oldestRefillAt) {
            oldestRefillAt = b.lastRefillAt;
            oldestFrom = key;
          }
        }
        if (oldestFrom !== undefined) this.rateLimitBuckets.delete(oldestFrom);
      }

      bucket = { tokens: RATE_CAPACITY, lastRefillAt: this.lastTickNow, warnedSinceRecovery: false };
      this.rateLimitBuckets.set(from, bucket);
    }

    const elapsed = this.lastTickNow - bucket.lastRefillAt;
    bucket.tokens = Math.min(RATE_CAPACITY, bucket.tokens + elapsed * RATE_PER_MS);
    bucket.lastRefillAt = this.lastTickNow;

    if (bucket.tokens < 1) {
      if (!bucket.warnedSinceRecovery) {
        console.warn(`[jitsi-scribble] sender ${from} exceeded rate limit — dropping messages`);
        bucket.warnedSinceRecovery = true;
      }
      return false;
    }

    bucket.tokens -= 1;
    bucket.warnedSinceRecovery = false;
    return true;
  }

  /**
   * The remote-ingest pipeline (CORE-04/05/06) — decodes and dispatches an
   * incoming wire payload from `from` into this same `StrokeInternal` map.
   * This task's version does NOT yet check a rate limit or a cap (Plan
   * 03-02 Tasks 2/3 add those as the FIRST statement and around each insert,
   * respectively) — wired now so it never throws and always calls
   * `decode(payload)` first.
   *
   * On decode failure: return silently (drop) — the malformed-payload
   * threat is already `codec.decode()`'s job; `apply()` never re-validates.
   *
   * `MSG_START`: insert a new stroke keyed by the composite `${from} ${id}`.
   * `MSG_MOVE`: look up the composite key — if found, append every
   *   dequantized point; if NOT found (CORE-06's orphan case), synthesize a
   *   new stroke with `frame: undefined` so an orphan move still renders.
   * `MSG_END`: look up the composite key — if found and not yet ended, end
   *   it exactly like `endLocal`; if NOT found, do nothing (an orphan `end`
   *   is silently ignored — unlike `move`, no stroke is synthesized).
   * `MSG_CLEAR`/`MSG_PRESENCE`: handled in Task 3.
   *
   * Note (T-03-03-01): this method NEVER calls emitOutbound or flushPending
   * — a remote-originated stroke is never re-broadcast back onto the wire
   * by this store, regardless of how many tick() calls follow.
   */
  apply(payload: unknown, from: string): void {
    if (!this.checkRateLimit(from)) return;

    const result = decode(payload);
    if (!result.ok) return;
    const frame = result.frame;

    switch (frame.t) {
      case MSG_START: {
        Effect.runSync(
          Ref.update(this.state, (s) => {
            const key = this.key(from, frame.id);
            // WR-01: a duplicate/replayed Start for an already-open
            // composite key must never reset the existing stroke — that
            // would silently discard its accumulated points/endedAt/
            // lastMoveAt AND let a sender dodge the globally-oldest-by-
            // createdAt eviction cap by periodically re-sending Start to
            // refresh its createdAt. Ignore the duplicate instead.
            if (s.strokes.has(key)) return s;
            this.enforceCapsBeforeInsert(s.strokes, from);
            const internal: StrokeInternal = {
              id: frame.id,
              from,
              points: [[dequantize(frame.p[0]), dequantize(frame.p[1])]],
              frame: { w: frame.frame.w, h: frame.frame.h },
              phase: 'live',
              fadeStartedAt: undefined,
              alpha: 1,
              endedAt: undefined,
              createdAt: this.lastTickNow,
              lastMoveAt: this.lastTickNow,
              kind: undefined,
            };
            s.strokes.set(key, internal);
            return s;
          }),
        );
        this.notify();
        return;
      }

      case MSG_MOVE: {
        Effect.runSync(
          Ref.update(this.state, (s) => {
            const key = this.key(from, frame.id);
            const entry = s.strokes.get(key);
            const dequantizedPoints = frame.pts.map(
              ([u, v]): readonly [number, number] => [dequantize(u), dequantize(v)],
            );
            if (entry) {
              this.appendPointsCapped(entry, dequantizedPoints);
              entry.lastMoveAt = this.lastTickNow;
            } else {
              // CORE-06: an orphan move (no preceding start) synthesizes a
              // new stroke rather than being discarded. No frame dims are
              // available from the wire for this case (MoveFrameSchema
              // carries no `frame` field) — frame stays undefined. Subject
              // to the same total/per-sender caps as any other insert.
              this.enforceCapsBeforeInsert(s.strokes, from);
              const inserted: StrokeInternal = {
                id: frame.id,
                from,
                points: [],
                frame: undefined,
                phase: 'live',
                fadeStartedAt: undefined,
                alpha: 1,
                endedAt: undefined,
                createdAt: this.lastTickNow,
                lastMoveAt: this.lastTickNow,
                kind: undefined,
              };
              this.appendPointsCapped(inserted, dequantizedPoints);
              s.strokes.set(key, inserted);
            }
            return s;
          }),
        );
        this.notify();
        return;
      }

      case MSG_END: {
        Effect.runSync(
          Ref.update(this.state, (s) => {
            const entry = s.strokes.get(this.key(from, frame.id));
            if (entry && entry.endedAt === undefined) {
              entry.endedAt = this.lastTickNow;
              if (frame.kind !== undefined) entry.kind = frame.kind;
            }
            return s;
          }),
        );
        this.notify();
        return;
      }

      case MSG_CLEAR: {
        // A remote Clear frame is scoped to its own sender — clearBySender(from),
        // NEVER this.clear(from) (RESEARCH.md Open Question 2's three-variant
        // clear(scope) signature). clear(scope)'s 'all'/'mine' sentinels are
        // reserved for trusted, host-code callers only (CORE-03's seven local
        // trigger sites); a wire-derived `from` that happens to collide with
        // one of those sentinel strings must never be reinterpreted as a
        // scope. clearBySender() never special-cases any string value, so it
        // is the only safe routing for remote-ingest (CR-01).
        // clearBySender() already calls notify().
        this.clearBySender(from);
        return;
      }

      case MSG_PRESENCE:
        // no-op — AWARE-01/02/03 consume Presence in Phase 5, not here
        return;
    }
  }

  /**
   * Advances the injected clock and recomputes every stroke's phase/alpha.
   * FIRST deletes every entry whose CACHED phase (from the previous tick) is
   * already 'dead' — this is what gives a dead stroke exactly one observable
   * tick before eviction: a stroke that just became dead THIS tick is not
   * deleted until the NEXT tick's first pass. THEN recomputes {phase, alpha}
   * for every remaining entry.
   *
   * AFTER those two passes, runs a THIRD pass: PROTO-03's outbound
   * local-move-coalescing flush. A stroke that dies this tick still gets one
   * final coalesce-flush opportunity before eviction next tick, since this
   * pass runs in the same tick() call as the dead-eviction pass above.
   */
  tick(now: number): void {
    this.lastTickNow = now;
    Effect.runSync(
      Ref.update(this.state, (s) => {
        for (const [key, entry] of s.strokes) {
          if (entry.phase === 'dead') s.strokes.delete(key);
        }
        for (const entry of s.strokes.values()) {
          const { phase, alpha } = computePhaseAndAlpha(
            now,
            { endedAt: entry.endedAt, lastMoveAt: entry.lastMoveAt },
            { holdMs: this.holdMs, fadeMs: this.fadeMs, staleMs: this.staleMs },
          );
          entry.phase = phase;
          entry.alpha = alpha;
          if (phase === 'fading' && entry.fadeStartedAt === undefined) {
            entry.fadeStartedAt = now;
          }
        }
        return s;
      }),
    );

    const currentStrokes = Effect.runSync(Ref.get(this.state)).strokes;
    // Garbage-collect localOutbound entries for strokes evicted by a cap or
    // by clear() — cheap at this map's bounded size.
    for (const id of [...this.localOutbound.keys()]) {
      if (!currentStrokes.has(this.key(LOCAL_SENDER, id))) {
        this.localOutbound.delete(id);
      }
    }
    for (const [id, outbound] of this.localOutbound) {
      if (outbound.pendingPoints.length === 0) continue;
      const lastPendingPoint = outbound.pendingPoints[outbound.pendingPoints.length - 1];
      const basePoint = outbound.lastFlushPoint ?? lastPendingPoint;
      const elapsed = now - outbound.lastFlushAt;
      const distance = Math.hypot(lastPendingPoint[0] - basePoint[0], lastPendingPoint[1] - basePoint[1]);
      if (elapsed >= MOVE_COALESCE_TIME_MS || distance >= MOVE_COALESCE_DISTANCE_EPSILON) {
        this.flushPending(id);
      }
    }

    this.notify();
  }

  /**
   * Removes strokes matching `scope`, regardless of their current cached
   * `phase` — D-05's instant-vanish contract: a stroke mid-fade is removed
   * exactly as instantly as a stroke still live. Never runs a matched stroke
   * through computePhaseAndAlpha or any fade path before removing it.
   *
   * 'all' -> delete every entry unconditionally.
   * 'mine' -> delete only entries whose .from === LOCAL_SENDER.
   * any other string -> treat it as a specific sender id and delete only
   *   entries whose .from === scope (Plan 03-02's apply() future Clear-frame
   *   handling calls this variant with a specific remote sender id).
   *
   * GEO-05's video-dimension-change trigger and CORE-03's other five
   * triggers (share start/stop, remote track swap, orientation change,
   * participant leave, data-channel close) all route through this exact
   * same clear('all') call from host code (Phase 4/5/7, out of this phase's
   * scope) — this file's job is only to make that one call correct for
   * every stroke phase, not to wire the seven host-side event listeners.
   */
  clear(scope: 'all' | 'mine' | string = 'all'): void {
    Effect.runSync(
      Ref.update(this.state, (s) => {
        for (const [key, entry] of s.strokes) {
          const matches =
            scope === 'all' ||
            (scope === 'mine' ? entry.from === LOCAL_SENDER : entry.from === scope);
          if (matches) s.strokes.delete(key);
        }
        return s;
      }),
    );
    this.notify();
  }

  /**
   * CR-01's dedicated remote-ingest Clear routing: deletes every stroke
   * whose `.from === from`, with NO magic-string special-casing — unlike
   * `clear(scope)`, an arbitrary wire-supplied `from` value can never be
   * misread as the `'all'`/`'mine'` sentinels. `apply()`'s `MSG_CLEAR` branch
   * must call this method, never `clear(from)`, so a sender whose id happens
   * to literally be `"all"` or `"mine"` cannot escalate its own-sender clear
   * into a global wipe (`"all"`) or a local-stroke wipe (`"mine"`).
   */
  private clearBySender(from: string): void {
    Effect.runSync(
      Ref.update(this.state, (s) => {
        for (const [key, entry] of s.strokes) {
          if (entry.from === from) s.strokes.delete(key);
        }
        return s;
      }),
    );
    this.notify();
  }

  /** Not part of the D-02 public API surface — a test-only hook for
   * inserting a stroke as if it had arrived from a remote sender, since
   * apply() (Plan 03-02's remote-ingest pipeline) does not exist yet. Real
   * remote strokes arrive through apply() once it is built; this method
   * exists solely so this plan's clear('mine')/clear(scope) tests can set up
   * a mixed local+remote store without waiting on that pipeline.
   *
   * WR-04: this is still a plain, public, shipped class method — nothing
   * strips it from the published bundle — so it routes through
   * `enforceCapsBeforeInsert` exactly like every real insert path
   * (beginLocal / apply()'s MSG_START / apply()'s MSG_MOVE orphan-insert),
   * so it can never be used, even by mistake, to bypass D-03/D-04's caps. */
  __testInsertRemote(from: string, id: string, points: readonly (readonly [number, number])[] = []): void {
    Effect.runSync(
      Ref.update(this.state, (s) => {
        this.enforceCapsBeforeInsert(s.strokes, from);
        s.strokes.set(this.key(from, id), {
          id,
          from,
          points: [...points],
          frame: undefined,
          phase: 'live',
          fadeStartedAt: undefined,
          alpha: 1,
          endedAt: undefined,
          createdAt: this.lastTickNow,
          lastMoveAt: this.lastTickNow,
          kind: undefined,
        });
        return s;
      }),
    );
  }

  /** Pure read-only projection of whatever the last tick(now) call cached —
   * no method other than tick() may mutate phase/alpha, and snapshot()
   * itself computes nothing time-dependent (no Date.now(), no re-deriving
   * phase/alpha). Preserves Map insertion order. */
  snapshot(): readonly Stroke[] {
    const s = Effect.runSync(Ref.get(this.state));
    return [...s.strokes.values()].map(toPublicStroke);
  }

  /** Registers a listener invoked on every state-changing call (tick, clear,
   * beginLocal, appendLocal, endLocal). Returns an unsubscribe function.
   * Copied verbatim from transport/index.ts's Set.add / return-a-closure-
   * that-deletes idiom. A store with zero subscribe() calls still functions
   * correctly — subscribe() is optional infrastructure, not a requirement
   * for the store's own state machine to run. */
  subscribe(fn: (strokes: readonly Stroke[]) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /**
   * Registers a listener invoked with every coalesced, budget-respecting
   * outbound WireFrame this store emits for a LOCAL stroke — never for a
   * remote-originated one (T-03-03-01). Returns an unsubscribe function,
   * copying the exact Set.add / return-delete-closure idiom `subscribe`
   * above already uses. The future Phase 4/5 host glue is
   * `store.onOutbound(frame => transport.send(frame))` — entirely outside
   * this phase's scope; this store never imports or calls a transport
   * itself (PROTO-03's "at the store's outbound edge" boundary).
   */
  onOutbound(fn: (frame: WireFrame) => void): () => void {
    this.outboundSubscribers.add(fn);
    return () => this.outboundSubscribers.delete(fn);
  }

  private notify(): void {
    const strokes = this.snapshot();
    for (const fn of this.subscribers) fn(strokes);
  }
}
