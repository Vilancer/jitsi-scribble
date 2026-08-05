import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// bootstrap.ts fires its own module-eval-time side effect (`bootstrap()`) on
// import — this is exactly the injected-script shape it's written for
// (04-01-SUMMARY.md's D6 gap: this file closes it). Every test here uses
// vi.resetModules() + a fresh dynamic import() so bootstrap()'s guard/logging
// behavior can be exercised repeatedly with a clean window each time, and
// vi.doMock('./mount.js', ...) so the throwing-mount case (WEB-05) never
// needs a real fromJitsiConference/StrokeStore/rAF pipeline running.

function setFakeConferenceOnWindow(): void {
  (window as unknown as { APP: unknown }).APP = {
    store: {
      getState: () => ({ 'features/base/conference': { conference: {} } }),
      subscribe: () => () => {},
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  delete (window as unknown as { __jitsiScribbleMounted?: boolean }).__jitsiScribbleMounted;
  delete (window as unknown as { APP?: unknown }).APP;
  location.hash = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('./mount.js');
  vi.doUnmock('./jitsiMeetWeb.js');
  delete (window as unknown as { __jitsiScribbleMounted?: boolean }).__jitsiScribbleMounted;
  delete (window as unknown as { APP?: unknown }).APP;
  location.hash = '';
});

describe('bootstrap — WEB-08 identifiable log line', () => {
  it('logs exactly one non-recorder [jitsi-scribble] bootstrap loaded line when location.hash lacks iAmRecorder=true', async () => {
    vi.doMock('./mount.js', () => ({ mountScribbleOverlay: vi.fn() }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await import('./bootstrap.js');

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('[jitsi-scribble] bootstrap loaded');
  });

  it('logs the (recorder) variant when location.hash contains iAmRecorder=true', async () => {
    location.hash = '#config.iAmRecorder=true';
    vi.doMock('./mount.js', () => ({ mountScribbleOverlay: vi.fn() }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await import('./bootstrap.js');

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('[jitsi-scribble] bootstrap loaded (recorder)');
  });
});

describe('bootstrap — WEB-05 failure isolation', () => {
  it('a throwing mountScribbleOverlay call is caught, logs a mount-failed warning, and bootstrap returns normally (no uncaught exception)', async () => {
    setFakeConferenceOnWindow();
    vi.doMock('./mount.js', () => ({
      mountScribbleOverlay: vi.fn(() => {
        throw new Error('simulated mount failure');
      }),
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // The module-eval-time bootstrap() call must not throw past this import,
    // even though the mocked mountScribbleOverlay always throws.
    await expect(import('./bootstrap.js')).resolves.toBeDefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[jitsi-scribble] mount failed'),
      expect.any(Error),
    );
  });
});

describe('bootstrap — WEB-02 duplicate-injection guard', () => {
  it('calling bootstrap a second time on the same window logs a duplicate warning and does not call whenConference/mountScribbleOverlay again', async () => {
    setFakeConferenceOnWindow();
    const mountFn = vi.fn();
    vi.doMock('./mount.js', () => ({ mountScribbleOverlay: mountFn }));
    vi.doMock('./jitsiMeetWeb.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./jitsiMeetWeb.js')>();
      return { ...actual, whenConference: vi.fn(actual.whenConference) };
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const jitsiMeetWebMod = await import('./jitsiMeetWeb.js');
    const bootstrapMod = await import('./bootstrap.js');

    // First (module-eval-time) invocation already fired whenConference once,
    // and since window.APP.store's conference is present synchronously on
    // the very first poll, mountFn already fired once too.
    expect(jitsiMeetWebMod.whenConference).toHaveBeenCalledTimes(1);
    expect(mountFn).toHaveBeenCalledTimes(1);

    bootstrapMod.bootstrap();

    expect(jitsiMeetWebMod.whenConference).toHaveBeenCalledTimes(1);
    expect(mountFn).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('skipping duplicate invocation'));
  });
});

describe('bootstrap — whenConference give-up path (exercised directly, WEB-02/05 depend on it never throwing/hanging)', () => {
  it('polls at 250ms intervals and logs exactly one give-up warning after ~60s when window.APP.store never becomes truthy', async () => {
    vi.useFakeTimers();
    const { whenConference } = await import('./jitsiMeetWeb.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = vi.fn();

    expect(() => whenConference(cb)).not.toThrow();

    // Strictly-greater-than-60_000ms give-up check; polls land on exact
    // 250ms multiples (60_000 is one), so advance one tick past it.
    await vi.advanceTimersByTimeAsync(60_250);

    expect(cb).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[jitsi-scribble] gave up waiting for window.APP.store'));

    vi.useRealTimers();
  });
});
