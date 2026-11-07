// jest-expo's preset is a superset of plain jest (RN-mocking machinery for
// component specs like Plan 05-04's ScribbleOverlay.spec.tsx); a pure-logic
// spec with zero react-native imports (gestureClassifier.spec.ts) runs under
// it exactly as it would under plain jest. Pinned to the sdk-55 dist-tag per
// CLAUDE.md's Testing Tools table, matching the example app's Expo SDK — never
// `latest`.
/** @type {import('jest').Config} */
export default {
  testTimeout: 30000,
  preset: 'jest-expo',
  // This package's TS sources use nodenext-style explicit `.js` extensions
  // on relative imports (e.g. `./gestureClassifier.js`, matching
  // packages/protocol's own convention) even though the file on disk is
  // `.ts` — strip the extension so Jest's resolver falls through to
  // moduleFileExtensions and finds the real .ts/.tsx file.
  moduleNameMapper: {
    // The @vilancer/scribble barrel pulls in reanimated, whose native
    // worklets module can't load under Jest; reuse that package's mock.
    '^react-native-reanimated$': '<rootDir>/../react-native/__mocks__/react-native-reanimated.js',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
