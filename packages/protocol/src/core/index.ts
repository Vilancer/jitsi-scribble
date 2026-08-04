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
}

/** Internal-only stroke record — carries the raw timestamps `tick()` needs
 * to recompute phase/alpha, never exposed on the public Stroke shape. */
interface StrokeInternal extends Stroke {
  endedAt: number | undefined;
  lastMoveAt: number;
  createdAt: number;
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

function toPublicStroke(s: StrokeInternal): Stroke {
  return {
    id: s.id,
    from: s.from,
    points: s.points,
    frame: s.frame,
    phase: s.phase,
    fadeStartedAt: s.fadeStartedAt,
    alpha: s.alpha,
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
  private readonly holdMs: number;
  private readonly fadeMs: number;
  private readonly staleMs: number;
  /** The injected-clock cache every non-tick public method reads instead of
   * Date.now(). Since beginLocal/appendLocal/endLocal take no `now`
   * parameter per the locked D-02 signature list, they timestamp against
   * whatever tick(now) most recently cached — fully deterministic given a
   * sequence of tick() calls, needing no fake timers to test. */
  private lastTickNow = 0;

  constructor(opts?: { holdMs?: number; fadeMs?: number; staleMs?: number }) {
    this.holdMs = opts?.holdMs ?? HOLD_MS;
    this.fadeMs = opts?.fadeMs ?? FADE_MS;
    this.staleMs = opts?.staleMs ?? STALE_MS;
    // Ref.unsafeMake needs no Effect runtime — safe to call directly here.
    this.state = Ref.unsafeMake<StoreState>({ strokes: new Map() });
  }

  private key(from: string, id: string): string {
    return `${from} ${id}`;
  }

  /** Begins a locally-authored stroke. This task does NOT yet apply any cap
   * (Plan 03-02 adds that). */
  beginLocal(id: string, frame: FrameDims): void {
    Effect.runSync(
      Ref.update(this.state, (s) => {
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
        };
        s.strokes.set(this.key(LOCAL_SENDER, id), internal);
        return s;
      }),
    );
    this.notify();
  }

  /** Appends a point to a locally-authored stroke. Defensive: a lookup miss
   * (no matching beginLocal) is a silent no-op, never throws. */
  appendLocal(id: string, u: number, v: number): void {
    Effect.runSync(
      Ref.update(this.state, (s) => {
        const entry = s.strokes.get(this.key(LOCAL_SENDER, id));
        if (entry) {
          entry.points = [...entry.points, [u, v]];
          entry.lastMoveAt = this.lastTickNow;
        }
        return s;
      }),
    );
    this.notify();
  }

  /** Ends a locally-authored stroke. Idempotent — a second endLocal call on
   * an already-ended stroke is a no-op, never resets the timer. */
  endLocal(id: string): void {
    Effect.runSync(
      Ref.update(this.state, (s) => {
        const entry = s.strokes.get(this.key(LOCAL_SENDER, id));
        if (entry && entry.endedAt === undefined) {
          entry.endedAt = this.lastTickNow;
        }
        return s;
      }),
    );
    this.notify();
  }

  /**
   * Advances the injected clock and recomputes every stroke's phase/alpha.
   * FIRST deletes every entry whose CACHED phase (from the previous tick) is
   * already 'dead' — this is what gives a dead stroke exactly one observable
   * tick before eviction: a stroke that just became dead THIS tick is not
   * deleted until the NEXT tick's first pass. THEN recomputes {phase, alpha}
   * for every remaining entry.
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

  /** Not part of the D-02 public API surface — a test-only hook for
   * inserting a stroke as if it had arrived from a remote sender, since
   * apply() (Plan 03-02's remote-ingest pipeline) does not exist yet. Real
   * remote strokes arrive through apply() once it is built; this method
   * exists solely so this plan's clear('mine')/clear(scope) tests can set up
   * a mixed local+remote store without waiting on that pipeline. */
  __testInsertRemote(from: string, id: string, points: readonly (readonly [number, number])[] = []): void {
    Effect.runSync(
      Ref.update(this.state, (s) => {
        s.strokes.set(this.key(from, id), {
          id,
          from,
          points,
          frame: undefined,
          phase: 'live',
          fadeStartedAt: undefined,
          alpha: 1,
          endedAt: undefined,
          createdAt: this.lastTickNow,
          lastMoveAt: this.lastTickNow,
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

  private notify(): void {
    const strokes = this.snapshot();
    for (const fn of this.subscribers) fn(strokes);
  }
}
