import { describe, expect, it } from 'vitest';

// Placeholder regression test — Wave 2 (plans 02-02/02-03) replaces this with
// real codec/geometry/transport coverage. Kept minimal so `nx run protocol:test`
// has at least one assertion to run against the tracer scaffold.
describe('protocol package scaffold', () => {
  it('resolves the root barrel without throwing', async () => {
    const mod = await import('./index.js');
    expect(mod).toBeDefined();
  });

  it('root barrel re-exports codec/geometry/transport without an ambiguous name collision', async () => {
    const mod = await import('./index.js');
    expect(mod.__PLACEHOLDER__).toBe(true);
    expect(mod.__CODEC_PLACEHOLDER__).toBe(true);
    expect(mod.__GEOMETRY_PLACEHOLDER__).toBe(true);
    expect(mod.__TRANSPORT_PLACEHOLDER__).toBe(true);
  });

  it('does not re-export ./schema from the root (keeps effect/Schema out of the RN entrypoint)', async () => {
    const mod = await import('./index.js');
    expect('__SCHEMA_PLACEHOLDER__' in mod).toBe(false);
  });
});
