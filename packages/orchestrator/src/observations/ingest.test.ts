import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TranscriptObservation } from '@fork/contracts';
import { openSqliteStore, type SessionRecord } from '@fork/state';
import { fixedClock } from '../clock';
import { ingestBatch } from './ingest';

const T0 = '2026-09-12T15:00:00.000Z';
const session: SessionRecord = {
  id: 's', projectConfigId: 'p', captureEpoch: 'cap-2', capture: 'listening', prototypeAutonomyEnabled: true,
  workspaceId: 'w', revision: { source: 1, config: 0 }, previewUrl: null, currentTopic: null, clarification: null,
  resumedAt: null, createdAt: T0, updatedAt: T0,
};
const turn = (id: string, extra: Partial<TranscriptObservation> = {}): TranscriptObservation => ({
  id, sessionId: 's', captureEpoch: 'cap-2', capturedAt: T0, version: 1, kind: 'transcript', phase: 'final',
  providerItemId: id, audioTurnSequence: 1, orderReliable: true, streamId: 'mic', text: 'hi',
  speaker: { label: null, verified: false }, ...extra,
});

test('reports duplicates, stale epochs, and ignored partials; stores finals', () => {
  const store = openSqliteStore(':memory:');
  store.createSession(session);
  const report = ingestBatch({ store, clock: fixedClock(T0) }, session, [
    turn('a'), turn('a'), turn('old', { captureEpoch: 'cap-1' }), turn('p', { phase: 'partial' }),
  ]);
  assert.deepEqual(report, { accepted: 1, duplicates: ['a'], staleEpoch: ['old'], ignoredPartials: 1 });
  assert.equal(store.listPendingTranscript('s', 'cap-2').length, 1);
  store.close();
});

test('a corrected final supersedes its prior segment', () => {
  const store = openSqliteStore(':memory:');
  store.createSession(session);
  ingestBatch({ store, clock: fixedClock(T0) }, session, [turn('a')]);
  ingestBatch({ store, clock: fixedClock(T0) }, session, [turn('a2', { supersedesObservationId: 'a', version: 2 })]);
  assert.deepEqual(store.listPendingTranscript('s', 'cap-2').map((o) => o.observation.id), ['a2']);
  store.close();
});

test('turns captured before resumedAt are skipped, not planned (no replay after Pause/Resume)', () => {
  const store = openSqliteStore(':memory:');
  const resumed = { ...session, resumedAt: '2026-09-12T15:00:10.000Z' };
  store.createSession(resumed);
  ingestBatch({ store, clock: fixedClock(T0) }, resumed, [
    turn('stale', { capturedAt: '2026-09-12T15:00:05.000Z' }),
    turn('fresh', { capturedAt: '2026-09-12T15:00:12.000Z' }),
  ]);
  assert.deepEqual(store.listPendingTranscript('s', 'cap-2').map((o) => o.observation.id), ['fresh']);
  assert.equal(store.getObservation('stale')?.planStatus, 'skipped');
  store.close();
});

test('while paused, finals are stored but immediately skipped', () => {
  const store = openSqliteStore(':memory:');
  const paused = { ...session, capture: 'paused' as const };
  store.createSession(paused);
  ingestBatch({ store, clock: fixedClock(T0) }, paused, [turn('a')]);
  assert.equal(store.getObservation('a')?.planStatus, 'skipped');
  store.close();
});

test('context observations are stored as evidence and never left pending', () => {
  const store = openSqliteStore(':memory:');
  store.createSession(session);
  const report = ingestBatch({ store, clock: fixedClock(T0) }, session, [{
    id: 'ctx', sessionId: 's', captureEpoch: 'cap-2', capturedAt: T0, version: 1, kind: 'preview_context',
    workspaceId: 'w', revision: { source: 1, config: 0 }, route: '/signup', viewport: { width: 1, height: 1 },
    elements: [], focusId: null, hover: null, selection: null,
  }]);
  assert.equal(report.accepted, 1);
  assert.equal(store.getObservation('ctx')?.planStatus, 'planned');
  assert.equal(store.listContext('s', 'cap-2', 10).length, 1);
  store.close();
});
