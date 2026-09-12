import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StoredObservation } from '@fork/state';
import { selectContextAt } from './context-at';

const ctx = (id: string, capturedAt: string, receivedSeq: number): StoredObservation => ({
  observation: {
    id, sessionId: 's', captureEpoch: 'c', capturedAt, version: 1, kind: 'preview_context', workspaceId: 'w',
    revision: { source: 1, config: 0 }, route: '/signup', viewport: { width: 1, height: 1 }, elements: [],
    focusId: null, hover: null, selection: null,
  },
  planStatus: 'planned', supersededBy: null, intentId: null, receivedSeq,
});

test('picks the newest context captured at or before the speech', () => {
  const picked = selectContextAt([
    ctx('c1', '2026-09-12T15:00:00.000Z', 1),
    ctx('c2', '2026-09-12T15:00:05.000Z', 2),
    ctx('c3', '2026-09-12T15:00:09.000Z', 3),
  ], '2026-09-12T15:00:06.000Z', 15000);
  assert.equal(picked?.observation.id, 'c2');
});

test('falls back to the first context after the speech within lookback, else null', () => {
  assert.equal(selectContextAt([ctx('c3', '2026-09-12T15:00:09.000Z', 1)], '2026-09-12T15:00:06.000Z', 15000)?.observation.id, 'c3');
  assert.equal(selectContextAt([ctx('c3', '2026-09-12T15:01:09.000Z', 1)], '2026-09-12T15:00:06.000Z', 15000), null);
});

test('returns null with no contexts at all', () => {
  assert.equal(selectContextAt([], '2026-09-12T15:00:06.000Z', 15000), null);
});
