import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TranscriptObservation } from '@fork/contracts';
import type { StoredObservation } from '@fork/state';
import { lastTurns, orderTurns } from './transcript-window';

const t = (id: string, seq: number | null, receivedSeq: number, orderReliable = true): StoredObservation => ({
  observation: {
    id, sessionId: 's', captureEpoch: 'c', capturedAt: '2026-09-12T15:00:00.000Z', version: 1, kind: 'transcript',
    phase: 'final', providerItemId: id, audioTurnSequence: seq, orderReliable, streamId: 'mic', text: id,
    speaker: { label: null, verified: false },
  } satisfies TranscriptObservation,
  planStatus: 'pending', supersededBy: null, intentId: null, receivedSeq,
});

test('orders by audio turn sequence when every turn is reliable, regardless of arrival', () => {
  assert.deepEqual(orderTurns([t('b', 2, 1), t('a', 1, 2)]).map((o) => o.observation.id), ['a', 'b']);
});

test('falls back to arrival order when any turn is unreliable', () => {
  assert.deepEqual(orderTurns([t('b', 2, 1), t('a', 1, 2, false)]).map((o) => o.observation.id), ['b', 'a']);
});

test('lastTurns keeps the newest window', () => {
  const turns = [t('a', 1, 1), t('b', 2, 2), t('c', 3, 3)];
  assert.deepEqual(lastTurns(turns, 2).map((o) => o.observation.id), ['b', 'c']);
  assert.deepEqual(lastTurns(turns, 9).map((o) => o.observation.id), ['a', 'b', 'c']);
});
