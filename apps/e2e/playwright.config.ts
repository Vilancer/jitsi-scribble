import { defineConfig } from '@playwright/test';

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
