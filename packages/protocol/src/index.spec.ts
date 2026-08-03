import { describe, expect, it } from 'vitest';

// Placeholder regression test — Wave 2 (plans 02-02/02-03) replaces this with
// real codec/geometry/transport coverage. Kept minimal so `nx run protocol:test`
// has at least one assertion to run against the tracer scaffold.
//
// Plan 02-02 filled in ./geometry with real functions (contentRect, normalize,
// denormalize, mapTouchToContent, repairAspect, computeStrokeWidth), so
// __GEOMETRY_PLACEHOLDER__ no longer exists — asserting the real exports
// resolve from the root barrel instead is the meaningful replacement.
describe('protocol package scaffold', () => {
  it('resolves the root barrel without throwing', async () => {
    const mod = await import('./index.js');
    expect(mod).toBeDefined();
  });

  it('root barrel re-exports codec/transport placeholders without an ambiguous name collision', async () => {
    const mod = await import('./index.js');
    expect(mod.__PLACEHOLDER__).toBe(true);
    expect(mod.__CODEC_PLACEHOLDER__).toBe(true);
    expect(mod.__TRANSPORT_PLACEHOLDER__).toBe(true);
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

  it('does not re-export ./schema from the root (keeps effect/Schema out of the RN entrypoint)', async () => {
    const mod = await import('./index.js');
    expect('__SCHEMA_PLACEHOLDER__' in mod).toBe(false);
  });
});
