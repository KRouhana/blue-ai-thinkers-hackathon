import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlannerProposal } from '@fork/contracts';
import type { StoredExperiment } from '@fork/state';
import { targetKeyFor } from './target-key';

const base = { id: 'i', sessionId: 's', captureEpoch: 'c', sourceObservationIds: ['t'], expectedRevision: { source: 1, config: 0 }, summary: 's' };

const experiment: StoredExperiment = {
  id: 'e1', sessionId: 's', intentId: 'i0', status: 'visible', summary: 's', origin: 'inferred_experiment',
  sourceObservationIds: [], revision: { source: 1, config: 1 }, checkpointId: 'chk', mockNotes: [],
  targetKey: 'element:start-trial', createdAt: 'T', updatedAt: 'T',
};

test('patches key on the element, jobs on the workspace, undo inherits its experiment key', () => {
  const patch: PlannerProposal = { ...base, kind: 'preview_patch', patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' },
    targetEvidence: { contextObservationId: 'c', elementId: 'start-trial', basis: ['route'], explanation: 'e' } };
  assert.equal(targetKeyFor(patch, 'demo-1', []), 'element:start-trial');

  const job: PlannerProposal = { ...base, kind: 'prototype_change', brief: 'b', relevantSources: [], constraints: [], mockedIntegrations: [] };
  assert.equal(targetKeyFor(job, 'demo-1', []), 'job:demo-1');
  assert.equal(targetKeyFor(job, null, []), 'job:none');

  const undo: PlannerProposal = { ...base, kind: 'undo', experimentId: 'e1' };
  assert.equal(targetKeyFor(undo, 'demo-1', [experiment]), 'element:start-trial');
  assert.equal(targetKeyFor(undo, 'demo-1', []), 'undo:e1');

  assert.equal(targetKeyFor({ ...base, kind: 'observe', reason: 'r' }, 'demo-1', []), 'none:observe');
});
