// Playwright globalSetup: build the test-owned browser transport bundle once
// before the suite runs. Kept as a thin wrapper over the script's exported
// function (Plan 06-01 Task 2: "a single reusable function, not a CLI-only
// script").
export default async function globalSetup(): Promise<void> {
  const { buildTestTransportBundle } = await import(
    './scripts/build-test-transport.mjs'
  );
  await buildTestTransportBundle();
}
