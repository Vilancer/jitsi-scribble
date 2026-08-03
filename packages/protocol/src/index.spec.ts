import { describe, expect, it } from 'vitest';

// Placeholder regression test — Wave 2 (plans 02-02/02-03) replaces this with
// real codec/geometry/transport coverage. Kept minimal so `nx run protocol:test`
// has at least one assertion to run against the tracer scaffold.
describe('protocol package scaffold', () => {
  it('resolves the root barrel without throwing', async () => {
    const mod = await import('./index.js');
    expect(mod).toBeDefined();
  });
});
