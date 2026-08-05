import { beforeEach, describe, expect, it, vi } from 'vitest';

import { observeContentRectChanges, whenConference } from './jitsiMeetWeb.js';

// jsdom ships no real ResizeObserver (04-RESEARCH.md Common Pitfalls) — stub
// a minimal fake that records every observed target/callback pair and lets
// tests fire them on demand via triggerResize().
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  callback: () => void;
  observedTargets: Element[] = [];
  disconnected = false;

  constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observedTargets.push(target);
  }

  disconnect(): void {
    this.observedTargets = [];
    this.disconnected = true;
  }

  unobserve(target: Element): void {
    this.observedTargets = this.observedTargets.filter((t) => t !== target);
  }
}

function triggerResize(): void {
  for (const instance of FakeResizeObserver.instances) {
    if (!instance.disconnected) instance.callback();
  }
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  (globalThis as unknown as { ResizeObserver: typeof FakeResizeObserver }).ResizeObserver = FakeResizeObserver;
  document.body.innerHTML = '';
});

describe('observeContentRectChanges', () => {
  it('calls onChange when the observed ResizeObserver fires', () => {
    document.body.innerHTML = `
      <div id="largeVideoContainer">
        <video id="largeVideo"></video>
      </div>`;
    const onChange = vi.fn();

    observeContentRectChanges(onChange);
    expect(onChange).not.toHaveBeenCalled();

    triggerResize();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('stops calling onChange after the returned unsubscribe is invoked', () => {
    document.body.innerHTML = `
      <div id="largeVideoContainer">
        <video id="largeVideo"></video>
      </div>`;
    const onChange = vi.fn();

    const unsubscribe = observeContentRectChanges(onChange);
    triggerResize();
    expect(onChange).toHaveBeenCalledTimes(1);

    unsubscribe();
    triggerResize();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('returns a callable no-op when #largeVideo/#largeVideoContainer are both absent', () => {
    document.body.innerHTML = '';
    const onChange = vi.fn();

    const unsubscribe = observeContentRectChanges(onChange);

    expect(() => unsubscribe()).not.toThrow();
    expect(FakeResizeObserver.instances.length).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('whenConference', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('polls at 250ms intervals and logs exactly one give-up warning after ~60s when window.APP.store never becomes truthy', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = vi.fn();

    expect(() => whenConference(cb)).not.toThrow();

    // whenConference's give-up check is strictly-greater-than 60_000ms, and
    // polls land on exact 250ms multiples (60_000 is one) — advance past the
    // boundary by one more tick so the give-up branch is actually reached.
    await vi.advanceTimersByTimeAsync(60_250);

    expect(cb).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[jitsi-scribble] gave up waiting for window.APP.store'));

    // Advancing further must not throw or log again — the poll loop stops
    // once it gives up.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
    vi.useRealTimers();
  });
});
