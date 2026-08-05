#!/usr/bin/env node
/**
 * Permanent, CI-runnable proof that eslint.config.mjs's restricted-imports
 * rule fires for all four rules named in ROADMAP Phase 2 success criterion 5
 * verbatim: lib-jitsi-meet, @jitsi/react-native-sdk, react-native-webrtc, and
 * the effect root barrel.
 *
 * Each fixture under ../eslint-fixtures/ is a permanent, deliberate
 * rule violation (never a manual edit-then-revert). This script lints each
 * fixture's text via ESLint's Node API against a synthetic path inside
 * packages/protocol/src/ so eslint.config.mjs's `files: ['packages/**\/src/**\/*.ts']`
 * glob applies — the real eslint-fixtures/ directory is globally ignored so
 * these files are never linted as part of any package's own `lint` target.
 *
 * Exits 1 (printing which fixture failed to trigger the rule) if any of the
 * four fixtures produces zero lint messages. Exits 0 otherwise.
 */
import { ESLint } from 'eslint';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/ -> packages/protocol -> packages -> repo root
const repoRoot = path.resolve(__dirname, '../../..');
const configFile = path.join(repoRoot, 'eslint.config.mjs');
const fixturesDir = path.join(__dirname, '..', 'eslint-fixtures');

const FIXTURES = [
  'bad-effect-barrel-import.ts.fixture',
  'bad-lib-jitsi-meet-import.ts.fixture',
  'bad-jitsi-react-native-sdk-import.ts.fixture',
  'bad-react-native-webrtc-import.ts.fixture',
  'bad-react-native-webrtc-import.tsx.fixture',
];

const eslint = new ESLint({ cwd: repoRoot, overrideConfigFile: configFile });

function syntheticPathFor(name) {
  return path.join(repoRoot, 'packages/protocol/src', `__fixture__-${name.replace(/\.fixture$/, '')}`);
}

let failed = false;

for (const fixture of FIXTURES) {
  const code = readFileSync(path.join(fixturesDir, fixture), 'utf8');
  const [result] = await eslint.lintText(code, { filePath: syntheticPathFor(fixture) });
  const messageCount = result?.messages?.length ?? 0;
  if (messageCount === 0) {
    failed = true;
    console.error(`FAIL: ${fixture} produced 0 lint messages (expected >= 1) — restricted-imports rule did not fire`);
  } else {
    console.log(`OK:   ${fixture} produced ${messageCount} lint message(s)`);
  }
}

// Extra regression coverage for two must-have truths not tied to a single
// named fixture — kept inline (not separate permanent .fixture files) since
// ROADMAP Phase 2 success criterion 5 enumerates exactly the four rules above.

// (1) A file violating two restricted-import rules at once must report two
// lint errors, not just the first (a linter that short-circuits after the
// first violation would silently hide the second).
{
  const code = "import * as Effect from 'effect';\nimport type { JitsiConference } from 'lib-jitsi-meet';\n";
  const [result] = await eslint.lintText(code, {
    filePath: path.join(repoRoot, 'packages/protocol/src', '__fixture__-double-violation.ts'),
  });
  const messageCount = result?.messages?.length ?? 0;
  if (messageCount !== 2) {
    failed = true;
    console.error(`FAIL: double-violation check produced ${messageCount} lint message(s), expected exactly 2`);
  } else {
    console.log(`OK:   double-violation check produced ${messageCount} lint message(s)`);
  }
}

// (2) A source file with zero imports must produce zero lint errors from the
// restricted-imports rule (no false positives on a clean file).
{
  const code = 'export const noop = () => undefined;\n';
  const [result] = await eslint.lintText(code, {
    filePath: path.join(repoRoot, 'packages/protocol/src', '__fixture__-clean.ts'),
  });
  const messageCount = result?.messages?.length ?? 0;
  if (messageCount !== 0) {
    failed = true;
    console.error(`FAIL: zero-import clean check produced ${messageCount} lint message(s), expected 0`);
  } else {
    console.log('OK:   zero-import clean check produced 0 lint messages');
  }
}

if (failed) {
  console.error('\nverify-lint-rules: one or more restricted-import checks failed.');
  process.exit(1);
}

console.log('\nverify-lint-rules: all restricted-import checks passed.');
process.exit(0);
