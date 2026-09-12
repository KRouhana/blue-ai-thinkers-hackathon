import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG, resolveConfig } from './config';

test('resolveConfig merges partial over defaults and rejects nonsense', () => {
  assert.equal(resolveConfig({ settleMs: 50 }).settleMs, 50);
  assert.equal(resolveConfig({}).transcriptWindowTurns, DEFAULT_CONFIG.transcriptWindowTurns);
  assert.throws(() => resolveConfig({ settleMs: -1 }), /settleMs/);
});
