import { describe, expect, it } from 'vitest';

// Root-barrel regression test. Plan 02-02 filled in ./geometry with real
// functions; Plan 02-03 filled in ./codec (encode/decode) and ./transport
// (ScribbleTransport/MemoryTransport/createMemoryTransportPair) — none of
// the wave-1 placeholder markers (__CODEC_PLACEHOLDER__,
// __TRANSPORT_PLACEHOLDER__) exist anymore, so this asserts the real
// exports resolve from the root barrel instead.
describe('protocol package scaffold', () => {
  it('resolves the root barrel without throwing', async () => {
    const mod = await import('./index.js');
    expect(mod).toBeDefined();
  });

  it('root barrel re-exports the root-level placeholder marker', async () => {
    const mod = await import('./index.js');
    expect(mod.__PLACEHOLDER__).toBe(true);
  });

  it('root barrel re-exports the real geometry functions (Plan 02-02)', async () => {
    const mod = await import('./index.js');
    expect(typeof mod.contentRect).toBe('function');
    expect(typeof mod.normalize).toBe('function');
    expect(typeof mod.denormalize).toBe('function');
    expect(typeof mod.mapTouchToContent).toBe('function');
    expect(typeof mod.repairAspect).toBe('function');
    expect(typeof mod.computeStrokeWidth).toBe('function');
  });

  it('root barrel re-exports the real codec functions (Plan 02-03)', async () => {
    const mod = await import('./index.js');
    expect(typeof mod.encode).toBe('function');
    expect(typeof mod.decode).toBe('function');
  });

  it('root barrel re-exports the real transport classes/functions (Plan 02-03)', async () => {
    const mod = await import('./index.js');
    expect(typeof mod.MemoryTransport).toBe('function');
    expect(typeof mod.createMemoryTransportPair).toBe('function');
  });

  it('does not re-export ./schema from the root (keeps effect/Schema out of the RN entrypoint)', async () => {
    const mod = await import('./index.js');
    expect('__SCHEMA_PLACEHOLDER__' in mod).toBe(false);
    expect('WireFrameSchema' in mod).toBe(false);
  });

  it('root barrel re-exports the real core functions/classes (Plan 03-01)', async () => {
    const mod = await import('./index.js');
    expect(typeof mod.StrokeStore).toBe('function');
    expect(typeof mod.computePhaseAndAlpha).toBe('function');
  });
});
