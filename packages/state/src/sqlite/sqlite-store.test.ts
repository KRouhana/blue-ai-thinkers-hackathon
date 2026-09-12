import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TranscriptObservation } from '@fork/contracts';
import { openSqliteStore } from './sqlite-store';
import type { SessionRecord } from '../records';

const T0 = '2026-09-12T15:00:00.000Z';
const session: SessionRecord = {
  id: 'ses-1', projectConfigId: 'demo-product', captureEpoch: 'cap-1', capture: 'stopped',
  prototypeAutonomyEnabled: false, workspaceId: null, revision: { source: 0, config: 0 },
  previewUrl: null, currentTopic: null, clarification: null, resumedAt: null, createdAt: T0, updatedAt: T0,
};
const turn = (id: string, seq: number, extra: Partial<TranscriptObservation> = {}): TranscriptObservation => ({
  id, sessionId: 'ses-1', captureEpoch: 'cap-1', capturedAt: T0, version: 1, kind: 'transcript', phase: 'final',
  providerItemId: `p-${id}`, audioTurnSequence: seq, orderReliable: true, streamId: 'mic', text: `turn ${id}`,
  speaker: { label: null, verified: false }, ...extra,
});

test('session round-trip and immutable update', () => {
  const store = openSqliteStore(':memory:');
  const created = store.createSession(session);
  const updated = store.updateSession('ses-1', { capture: 'listening', revision: { source: 1, config: 0 } }, '2026-09-12T15:00:01.000Z');
  assert.equal(created.capture, 'stopped');
  assert.equal(updated.capture, 'listening');
  assert.deepEqual(store.getSession('ses-1')?.revision, { source: 1, config: 0 });
  assert.notEqual(created, updated);
  store.close();
});

test('observation ids are idempotent', () => {
  const store = openSqliteStore(':memory:');
  store.createSession(session);
  assert.equal(store.insertObservation(turn('t1', 1), T0), true);
  assert.equal(store.insertObservation(turn('t1', 1), T0), false);
  assert.equal(store.listFinalTranscript('ses-1', 'cap-1', 10).length, 1);
  store.close();
});

test('supersede + plan status bookkeeping', () => {
  const store = openSqliteStore(':memory:');
  store.createSession(session);
  store.insertObservation(turn('t1', 1), T0);
  store.insertObservation(turn('t2', 1, { supersedesObservationId: 't1', version: 2 }), T0);
  store.markSuperseded('t1', 't2');
  assert.equal(store.getObservation('t1')?.supersededBy, 't2');
  assert.deepEqual(store.listPendingTranscript('ses-1', 'cap-1').map((o) => o.observation.id), ['t2']);
  store.setPlanStatus(['t2'], 'planned', 'int-1');
  assert.equal(store.listPendingTranscript('ses-1', 'cap-1').length, 0);
  assert.equal(store.getObservation('t2')?.intentId, 'int-1');
  store.close();
});

test('epoch scoping: observations from another epoch are not listed', () => {
  const store = openSqliteStore(':memory:');
  store.createSession(session);
  store.insertObservation(turn('old', 1, { captureEpoch: 'cap-0' }), T0);
  store.insertObservation(turn('new', 1), T0);
  assert.deepEqual(store.listPendingTranscript('ses-1', 'cap-1').map((o) => o.observation.id), ['new']);
  store.close();
});

test('events get a monotonic per-session sequence and replay after a cursor', () => {
  const store = openSqliteStore(':memory:');
  store.createSession(session);
  const e1 = store.appendEvent('ses-1', { kind: 'status', message: 'a' }, T0, 'evt-1');
  const e2 = store.appendEvent('ses-1', { kind: 'status', message: 'b' }, T0, 'evt-2');
  assert.equal(e1.sequence, 1);
  assert.equal(e2.sequence, 2);
  assert.deepEqual(store.listEventsAfter('ses-1', 1, 10).map((e) => e.id), ['evt-2']);
  assert.equal(store.lastEventSequence('ses-1'), 2);
  store.close();
});

test('dedupe keys are per session', () => {
  const store = openSqliteStore(':memory:');
  store.createSession(session);
  store.putDedupeKey('ses-1', 'k', 'int-1');
  assert.equal(store.hasDedupeKey('ses-1', 'k'), true);
  assert.equal(store.hasDedupeKey('ses-2', 'k'), false);
  store.close();
});

test('transaction rolls back on throw', () => {
  const store = openSqliteStore(':memory:');
  assert.throws(() => store.transaction(() => { store.createSession(session); throw new Error('boom'); }), /boom/);
  assert.equal(store.getSession('ses-1'), null);
  store.close();
});

test('intents, experiments, jobs, repo map round-trip with immutable updates', () => {
  const store = openSqliteStore(':memory:');
  store.createSession(session);
  const proposal = { id: 'int-1', sessionId: 'ses-1', captureEpoch: 'cap-1', sourceObservationIds: ['t1'],
    expectedRevision: { source: 0, config: 0 }, summary: 's', kind: 'observe' as const, reason: 'r' };
  const intent = store.insertIntent('ses-1', { proposal, gateStatus: 'allowed', gateReason: null, dedupeKey: 'k', pendingPatch: null, createdAt: T0 });
  const intent2 = store.updateIntent('int-1', { gateStatus: 'superseded', gateReason: 'newer' });
  assert.equal(intent.gateStatus, 'allowed');
  assert.equal(intent2.gateStatus, 'superseded');
  assert.equal(store.listIntents('ses-1', 10).length, 1);

  const exp = store.insertExperiment({ id: 'exp-1', sessionId: 'ses-1', intentId: 'int-1', status: 'proposed', summary: 'Try', origin: 'inferred_experiment',
    sourceObservationIds: ['t1'], revision: { source: 0, config: 0 }, checkpointId: null, mockNotes: [], targetKey: 'element:x', createdAt: T0, updatedAt: T0 });
  const exp2 = store.updateExperiment('exp-1', { status: 'visible', checkpointId: 'chk-1', revision: { source: 0, config: 1 } }, T0);
  assert.equal(exp.status, 'proposed');
  assert.equal(exp2.checkpointId, 'chk-1');
  assert.deepEqual(store.listExperiments('ses-1', 10).map((e) => e.id), ['exp-1']);

  const job = { id: 'job-1', experimentId: 'exp-1', sessionId: 'ses-1', workspaceId: 'w', intentId: 'int-1', expectedRevision: { source: 0, config: 0 },
    brief: 'b', relevantSources: [], constraints: [], mockedIntegrations: [], mode: 'demo_only' as const, verification: 'compile_and_render' as const };
  store.insertJob('ses-1', { job, state: 'queued', message: '', result: null, createdAt: T0, updatedAt: T0 });
  const job2 = store.updateJob('job-1', { state: 'running', message: 'go' }, T0);
  assert.equal(job2.state, 'running');
  assert.equal(store.getJob('job-1')?.message, 'go');

  const repoMap = { workspaceId: 'w', origin: 'existing_repo' as const, fingerprint: 'f', framework: { name: 'x', verified: false },
    routes: [], relevantSources: [], mockCapabilities: [], limitations: [] };
  store.saveRepoMap('ses-1', repoMap);
  assert.deepEqual(store.getRepoMap('ses-1'), repoMap);
  store.close();
});
