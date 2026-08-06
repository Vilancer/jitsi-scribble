// A manual, JS-only Jest mock for `react-native-reanimated`. Jest auto-uses
// any `__mocks__/<pkg>.js` file adjacent to this package's own source for
// every test in this package, with no `jest.mock()` call needed at each
// call site.
//
// Why this exists instead of the package's own shipped `react-native-reanimated/mock`
// entrypoint: that shipped mock (`src/mock.ts`) imports several VALUE bindings
// from the real `./index` module (`ColorSpace`, `Extrapolation`, etc.), and
// `./index`'s own module-scope side effect eagerly initializes the native
// `react-native-worklets` module (`NativeWorklets.native.ts`'s
// `installUnpackers`/`loadUnpackersWithCode`) — which throws
// (`Cannot read properties of undefined (reading 'loadUnpackersWithCode')`)
// under Jest, where no such native module is registered. Confirmed this
// session by importing the shipped mock directly and observing the same
// throw the real package produces.
//
// This mock only implements the small surface this package's tests actually
// exercise (`useSharedValue`, `runOnJS`, plus Plan 05-04's additions below:
// `createAnimatedComponent`, `useAnimatedProps`, `useReducedMotion`,
// `withTiming`) — a plain, synchronous, JS-only stand-in, matching
// Reanimated's own documented "mock provides a non-animated implementation"
// intent, just without the shipped mock's broken import chain. Extend this
// file (not the shipped mock) if a future plan's spec needs another
// Reanimated export mocked.

function useSharedValue(initial) {
  // A real SharedValue is a UI-thread object; under Jest there is no UI
  // thread, so a plain mutable `{ value }` box is a faithful-enough stand-in
  // for every test in this package (none of which assert cross-thread
  // behavior — that is explicitly a human-verification item, not a unit
  // test, per this plan's own must_haves).
  return { value: initial };
}

function runOnJS(fn) {
  // Under Jest there is no UI thread to schedule FROM — calling straight
  // through is the correct test-environment behavior: the real contract
  // ("schedules a JS-thread call without blocking the UI thread") has
  // nothing to prove synchronously in a single-thread test process.
  return (...args) => fn(...args);
}

function useAnimatedProps(factory) {
  return factory();
}

function useReducedMotion() {
  return false;
}

/** Plan 05-04's addition: under Jest there is no native view registry to
 * wrap, so the "animated" component is just the underlying component itself
 * — matching the real package's documented mock intent (no animation, still
 * a valid renderable component). */
function createAnimatedComponent(Component) {
  return Component;
}

/** Plan 05-04's addition: no real animation clock exists under Jest, so
 * withTiming resolves synchronously to its target value — the same
 * simplification the real package's own shipped mock (`react-native-reanimated/mock`)
 * documents for its animation-function mocks. */
function withTiming(toValue) {
  return toValue;
}

/** Plan 05-04's addition: `react-native-gesture-handler`'s own
 * `GestureDetector` probes for a real Reanimated at import time
 * (`handlers/gestures/reanimatedWrapper.ts`) by checking `Reanimated
 * ?.useSharedValue` — since this mock DOES provide `useSharedValue` (above),
 * gesture-handler treats this mock as "real enough" and goes on to call
 * `Reanimated.useEvent`/`.setGestureState`/`.default.createAnimatedComponent`
 * from its own internals. All three need a stub or `<GestureDetector>`
 * throws at mount under Jest — exercised for the first time by this plan's
 * `ScribbleOverlay.spec.tsx` (Plan 05-03's own specs never mounted a real
 * `<GestureDetector>`, only called `pan.handlers.onX` directly). */
function useEvent(callback) {
  // Under Jest there is no native event system to attach to — returning the
  // callback itself is a harmless stand-in; nothing in this package's tests
  // fires a native gesture event through this path.
  return { current: callback };
}

function setGestureState() {}

module.exports = {
  useSharedValue,
  runOnJS,
  useAnimatedProps,
  useReducedMotion,
  createAnimatedComponent,
  withTiming,
  useEvent,
  setGestureState,
  default: { createAnimatedComponent },
};
