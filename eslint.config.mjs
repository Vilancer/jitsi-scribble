// @ts-check
import tseslint from 'typescript-eslint';

/**
 * The sole enforcement point for the architectural import boundary this whole
 * project depends on: no bare `effect` root-barrel import (pulls in 223
 * fast-check modules, see STACK.md "The barrel import is a trap"), and no
 * import of lib-jitsi-meet / @jitsi/react-native-sdk / react-native-webrtc
 * from any published package (STACK.md "Peer-dependency strategy" — this
 * library injects those, never depends on them).
 *
 * `no-restricted-imports`'s `paths` option restricts type-only imports by
 * default (`allowTypeImports` defaults to false), so `import type {...} from
 * 'lib-jitsi-meet'` is caught by the `patterns` entry below with no extra
 * matcher needed — verified empirically by
 * packages/protocol/scripts/verify-lint-rules.mjs against
 * bad-lib-jitsi-meet-import.ts.fixture (a type-only import).
 */
const restrictedImportsRule = {
  'no-restricted-imports': [
    'error',
    {
      paths: [
        {
          name: 'effect',
          message: "Use subpath imports: import * as Effect from 'effect/Effect'",
        },
      ],
      patterns: ['lib-jitsi-meet', '@jitsi/react-native-sdk', 'react-native-webrtc'],
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/out-tsc/**',
      '**/.nx/**',
      // Fixtures are deliberate rule violations, never linted as part of a
      // package's own `lint` target — they are exercised only by
      // verify-lint-rules.mjs via ESLint's Node API against in-memory text.
      '**/eslint-fixtures/**',
    ],
  },
  {
    files: ['packages/**/src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        sourceType: 'module',
      },
    },
    rules: {
      ...restrictedImportsRule,
    },
  },
);
