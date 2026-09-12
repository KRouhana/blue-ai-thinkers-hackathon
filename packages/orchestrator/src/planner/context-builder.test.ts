import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PreviewContextObservation, TranscriptObservation } from '@fork/contracts';
import type { SessionRecord, StoredExperiment, StoredIntent, StoredObservation } from '@fork/state';
import { buildPlanningContext } from './context-builder';

const T0 = '2026-09-12T15:00:00.000Z';

const turn = (id: string, text: string, seq: number): StoredObservation => ({
  observation: {
    id, sessionId: 's', captureEpoch: 'cap', capturedAt: T0, version: 1, kind: 'transcript', phase: 'final',
    providerItemId: id, audioTurnSequence: seq, orderReliable: true, streamId: 'mic', text,
    speaker: { label: null, verified: false },
  } satisfies TranscriptObservation,
  planStatus: 'pending', supersededBy: null, intentId: null, receivedSeq: seq,
});

const contextObservation: PreviewContextObservation = {
  id: 'c1', sessionId: 's', captureEpoch: 'cap', capturedAt: T0, version: 1, kind: 'preview_context', workspaceId: 'demo-1',
  revision: { source: 1, config: 1 }, route: '/signup', viewport: { width: 1280, height: 800 },
  focusId: 'start-trial', hover: { elementId: 'explore-sample', at: T0 }, selection: null,
  elements: [{ id: 'start-trial', role: 'button', label: 'Start trial', section: 'Signup', visible: true, box: { x: 0, y: 0, width: 1, height: 1 }, editable: ['size'] }],
};

const session: SessionRecord = {
  id: 's', projectConfigId: 'demo-product', captureEpoch: 'cap', capture: 'listening', prototypeAutonomyEnabled: true,
  workspaceId: 'demo-1', revision: { source: 1, config: 1 }, previewUrl: null, currentTopic: 'Start trial button',
  clarification: { intentId: 'int-9', question: 'Which button?', candidates: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], route: '/signup', contextObservationId: 'c1', createdAt: T0 },
  resumedAt: null, createdAt: T0, updatedAt: T0,
};

const experiment: StoredExperiment = {
  id: 'e1', sessionId: 's', intentId: 'int-1', status: 'visible', summary: 'Trying a larger Start trial button',
  origin: 'inferred_experiment', sourceObservationIds: ['t1'], revision: { source: 1, config: 1 }, checkpointId: 'chk',
  mockNotes: [], targetKey: 'element:start-trial', createdAt: T0, updatedAt: T0,
};

const intent: StoredIntent = {
  proposal: {
    id: 'int-1', sessionId: 's', captureEpoch: 'cap', sourceObservationIds: ['t1'], expectedRevision: { source: 1, config: 0 },
    summary: 'Trying a larger Start trial button', kind: 'preview_patch',
    patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' },
    targetEvidence: { contextObservationId: 'c1', elementId: 'start-trial', basis: ['explicit_label'], explanation: 'named' },
  },
  gateStatus: 'allowed', gateReason: null, dedupeKey: 'k', pendingPatch: null, createdAt: T0,
};

test('separates actionable new turns from context turns and exposes grounded evidence', () => {
  const built = buildPlanningContext({
    session,
    newTurns: [turn('t2', 'What if it were bigger?', 2)],
    recentTurns: [turn('t1', 'The Start trial button is small.', 1)],
    context: { observation: contextObservation, planStatus: 'planned', supersededBy: null, intentId: null, receivedSeq: 1 },
    experiments: [experiment, { ...experiment, id: 'e0', status: 'reverted' }],
    intents: new Map([['int-1', intent]]),
    repoMap: null,
    companyNotes: [{ path: 'fixtures/company/signup-flow-notes.md', excerpt: 'Start trial is the primary call to action.' }],
    repoExcerpts: [],
  });

  assert.deepEqual(built.newTurns, [{ id: 't2', text: 'What if it were bigger?', audioTurnSequence: 2 }]);
  assert.deepEqual(built.recentTurns, [{ id: 't1', text: 'The Start trial button is small.' }]);
  assert.equal(built.context?.observationId, 'c1');
  assert.equal(built.context?.focusId, 'start-trial');
  assert.equal(built.context?.hoverId, 'explore-sample');
  assert.equal(built.context?.selectionId, null);
  assert.deepEqual(built.context?.elements, [{ id: 'start-trial', role: 'button', label: 'Start trial', section: 'Signup', visible: true, editable: ['size'] }]);
  assert.equal(built.session.currentTopic, 'Start trial button');
  assert.equal(built.pendingClarification?.intentId, 'int-9');
  assert.deepEqual(built.companyNotes.length, 1);
});

test('only visible experiments are offered, each with the patch that produced it', () => {
  const built = buildPlanningContext({
    session, newTurns: [turn('t2', 'too big', 2)], recentTurns: [], context: null,
    experiments: [experiment, { ...experiment, id: 'e0', status: 'failed' }],
    intents: new Map([['int-1', intent]]), repoMap: null, companyNotes: [], repoExcerpts: [],
  });
  assert.deepEqual(built.visibleExperiments, [{
    id: 'e1', summary: 'Trying a larger Start trial button', targetKey: 'element:start-trial',
    patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' },
  }]);
  assert.equal(built.context, null);
});

test('the repo map is flattened to names, not whole files', () => {
  const built = buildPlanningContext({
    session, newTurns: [turn('t2', 'filter overdue', 2)], recentTurns: [], context: null, experiments: [],
    intents: new Map(), companyNotes: [], repoExcerpts: [],
    repoMap: {
      workspaceId: 'demo-1', origin: 'existing_repo', fingerprint: 'f', framework: { name: 'react-vite', verified: true },
      routes: [{ route: '/tasks', sources: [{ kind: 'repo', path: 'src/pages/Tasks.tsx', fingerprint: 'abc' }] }],
      relevantSources: [{ kind: 'repo', path: 'src/data/tasks.ts', fingerprint: 'def' }],
      mockCapabilities: ['synthetic tasks'], limitations: ['no backend'],
    },
  });
  assert.deepEqual(built.repoMap, {
    framework: 'react-vite', verified: true, routes: ['/tasks'],
    relevantSources: ['src/pages/Tasks.tsx', 'src/data/tasks.ts'],
    mockCapabilities: ['synthetic tasks'], limitations: ['no backend'],
  });
});
