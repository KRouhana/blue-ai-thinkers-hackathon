import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionRecord, StoredExperiment } from '@fork/state';
import { buildSnapshot } from './snapshot';

const T0 = '2026-09-12T15:00:00.000Z';

const session: SessionRecord = {
  id: 's', projectConfigId: 'demo-product', captureEpoch: 'cap', capture: 'listening', prototypeAutonomyEnabled: true,
  workspaceId: 'demo-1', revision: { source: 1, config: 1 }, previewUrl: 'http://localhost:4173',
  currentTopic: 'Start trial button',
  clarification: {
    intentId: 'int-9', question: 'Which button?', candidates: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    route: '/signup', contextObservationId: 'c1', createdAt: T0,
  },
  resumedAt: null, createdAt: T0, updatedAt: T0,
};

const experiment = (id: string): StoredExperiment => ({
  id, sessionId: 's', intentId: `int-${id}`, status: 'visible', summary: `experiment ${id}`, origin: 'inferred_experiment',
  sourceObservationIds: ['t1'], revision: { source: 1, config: 1 }, checkpointId: 'chk', mockNotes: [],
  targetKey: 'element:start-trial', createdAt: T0, updatedAt: T0,
});

test('the snapshot exposes the contract fields and hides internal bookkeeping', () => {
  const snapshot = buildSnapshot(session, [experiment('e1')], 7);
  assert.equal(snapshot.lastEventSequence, 7);
  assert.deepEqual(snapshot.revision, { source: 1, config: 1 });
  assert.deepEqual(snapshot.clarification, { intentId: 'int-9', question: 'Which button?', candidates: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  assert.deepEqual(Object.keys(snapshot.experiments[0] ?? {}).sort(), [
    'checkpointId', 'id', 'intentId', 'mockNotes', 'origin', 'revision', 'sourceObservationIds', 'status', 'summary',
  ]);
});

test('the experiment list is capped to the newest entries', () => {
  const experiments = ['e1', 'e2', 'e3', 'e4'].map(experiment);
  const snapshot = buildSnapshot(session, experiments, 1, 2);
  assert.deepEqual(snapshot.experiments.map((entry) => entry.id), ['e3', 'e4']);
});

test('no clarification means null, never a partial object', () => {
  const snapshot = buildSnapshot({ ...session, clarification: null }, [], 0);
  assert.equal(snapshot.clarification, null);
  assert.deepEqual(snapshot.experiments, []);
});
