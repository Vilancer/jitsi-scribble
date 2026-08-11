// Builds a browser-loadable IIFE bundle of packages/web's PUBLIC barrel
// (src/index.ts — fromJitsiConference + mountScribbleOverlay), exposed as
// window.__jitsiScribbleTestTransport once page.addScriptTag()-ed into a
// Playwright page.
//
// Why this exists (Plan 06-01 Task 2): packages/web's own vite build entry
// is src/bootstrap.ts — an auto-executing side effect meant for the Jibri
// deployment, not a clean library surface a test can call into. The specs in
// Plans 06-02/06-04 need a TEST-OWNED ScribbleTransport constructed against
// the page's real conference object, so this script bundles the exact same
// shipped adapter (never a hand-rolled reimplementation — T-06-01-02, and
// the phase's "never reimplement resolveSend()" prohibition).
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { build } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

export const OUTPUT_FILE = resolve(
  here,
  '../tests/fixtures/test-transport.iife.js',
);

/** Reusable from playwright.config.ts's globalSetup — not CLI-only. */
export async function buildTestTransportBundle() {
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      lib: {
        entry: resolve(here, '../../../packages/web/src/index.ts'),
        name: '__jitsiScribbleTestTransport',
        formats: ['iife'],
        fileName: () => 'test-transport.iife.js',
      },
      outDir: resolve(here, '../tests/fixtures'),
      emptyOutDir: false,
      sourcemap: false,
      minify: false,
    },
  });
  return OUTPUT_FILE;
}

// Allow `node scripts/build-test-transport.mjs` direct invocation too.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildTestTransportBundle()
    .then((file) => {
      console.log(`test-transport bundle written to ${file}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
