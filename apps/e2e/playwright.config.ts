import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from '@playwright/test';

// Load the gitignored staging-auth env file (E2E_JITSI_JWT_SECRET) — the
// deployment runs AUTH_TYPE=jwt, so specs mint a short-lived moderator token
// per run. The secret itself never appears in committed code.
const envFile = resolve(__dirname, '.env.e2e');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}

// The chromium fake-media convention every spec in Phase 6 needs — declared
// ONCE here so Plans 06-02/06-04's specs never redeclare it (06-01 Task 2).
export default defineConfig({
  testDir: './tests',
  // Rebuilds the test-owned transport bundle (fixtures/test-transport.iife.js)
  // once before the suite — see scripts/build-test-transport.mjs.
  globalSetup: './global-setup.ts',
  timeout: 120_000,
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
          ],
        },
      },
    },
  ],
});
