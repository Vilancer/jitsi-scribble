/**
 * DRAW-03/FEATURES.md D3's tap-vs-drag classifier, extracted into its own
 * pure function so it can be called directly from inside a Reanimated
 * `Gesture.Pan().onEnd()` worklet callback (see gesture.ts, a later plan) —
 * hence the leading `'worklet';` directive as this file's own first
 * statement, and zero imports of any kind (a worklet-transformable function
 * imported from a module, not written inline, only workletizes correctly
 * when Reanimated's babel plugin can see a self-contained function body).
 *
 * D-01: this function's return value is what a later plan passes as the
 * optional second argument to `StrokeStore.endLocal` — the tap/drag
 * discriminant reaches the wire via the End frame's optional `kind` field.
 *
 * Thresholds are DRAW-03's exact, already-locked figures — not re-derived
 * here: movement strictly under 8dp AND elapsed time strictly under 150ms
 * classifies as a tap; every other case (including exactly at either
 * boundary) classifies as a stroke.
 */
export function classifyGesture(totalDistanceDp: number, elapsedMs: number): 'tap' | 'stroke' {
  'worklet';
  if (totalDistanceDp < 8 && elapsedMs < 150) {
    return 'tap';
  }
  return 'stroke';
}
