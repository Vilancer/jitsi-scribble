// jest-expo's preset is a superset of plain jest (RN-mocking machinery for
// component specs like Plan 05-04's ScribbleOverlay.spec.tsx); a pure-logic
// spec with zero react-native imports (gestureClassifier.spec.ts) runs under
// it exactly as it would under plain jest. Pinned to the sdk-55 dist-tag per
// CLAUDE.md's Testing Tools table, matching the example app's Expo SDK — never
// `latest`.
/** @type {import('jest').Config} */
export default {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // First renders load svg/reanimated/gesture-handler and take seconds on a
  // busy CI runner; the default 5 s is too tight there.
  testTimeout: 30000,
  // nx runs projects in parallel; uncapped Jest workers on top of that
  // starve the first renders (svg/reanimated/gesture-handler load) on a
  // busy machine.
  maxWorkers: 2,
  // This package's TS sources use nodenext-style explicit `.js` extensions
  // on relative imports (e.g. `./gestureClassifier.js`, matching
  // packages/protocol's own convention) even though the file on disk is
  // `.ts` — strip the extension so Jest's resolver falls through to
  // moduleFileExtensions and finds the real .ts/.tsx file.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
