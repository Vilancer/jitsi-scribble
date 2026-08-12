// Playwright globalSetup: build the test-owned browser transport bundle once
// before the suite runs (Plan 06-01 Task 2: "a single reusable function, not a
// CLI-only script"), and generate the portrait fake-camera fixture if absent
// (Plan 06-04 Task 2 — raw y4m is ~15MB, generated not committed; ffmpeg is a
// confirmed host tool, n8.1.2).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PORTRAIT_FIXTURE = resolve(__dirname, 'tests/fixtures/portrait.y4m');

export default async function globalSetup(): Promise<void> {
  const { buildTestTransportBundle } = await import(
    './scripts/build-test-transport.mjs'
  );
  await buildTestTransportBundle();

  if (!existsSync(PORTRAIT_FIXTURE)) {
    execFileSync('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=size=360x640:rate=15:duration=3',
      '-pix_fmt', 'yuv420p',
      PORTRAIT_FIXTURE,
    ], { stdio: 'ignore' });
  }
}
