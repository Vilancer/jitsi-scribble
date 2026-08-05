// Boundary-value testing convention mirrored from
// packages/protocol/src/codec/codec.spec.ts: test the boundary value itself
// AND one step to either side.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { classifyGesture } from './gestureClassifier.js';

describe('classifyGesture', () => {
  it('returns tap when both distance and duration are strictly under threshold', () => {
    expect(classifyGesture(7.99, 149)).toBe('tap');
  });

  it('returns stroke when distance is exactly at the 8dp boundary', () => {
    expect(classifyGesture(8, 149)).toBe('stroke');
  });

  it('returns stroke when duration is exactly at the 150ms boundary', () => {
    expect(classifyGesture(7.99, 150)).toBe('stroke');
  });

  it('returns tap for a true stationary tap (0, 0)', () => {
    expect(classifyGesture(0, 0)).toBe('tap');
  });

  it('returns stroke for an obvious drag far past both thresholds', () => {
    expect(classifyGesture(500, 2000)).toBe('stroke');
  });

  it('carries a leading worklet directive as classifyGesture function body\'s own first statement, and has zero import statements', () => {
    const source = readFileSync(path.join(__dirname, 'gestureClassifier.ts'), 'utf8');
    const functionBodyOpen = source.indexOf('{', source.indexOf('function classifyGesture'));
    const firstStatementInBody = source
      .slice(functionBodyOpen + 1)
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('//'));
    expect(firstStatementInBody).toBe("'worklet';");
    expect(source).not.toMatch(/^\s*import /m);
  });
});
