import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plannerProposalSchema, previewPatchSchema } from './planner';
import type { PlannerProposal } from '../types';

const base = { id: 'intent-1', sessionId: 'meeting-1', captureEpoch: 'capture-1',
  sourceObservationIds: ['speech-1', 'ctx-1'], expectedRevision: { source: 1, config: 0 } };

test('accepts the contract example preview_patch proposal', () => {
  const proposal: PlannerProposal = { ...base, summary: 'Try a larger Start trial button', kind: 'preview_patch',
    patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' },
    targetEvidence: { contextObservationId: 'ctx-1', elementId: 'start-trial',
      basis: ['explicit_label', 'recent_referent'], explanation: 'The current discussion names the visible Start trial button.' } };
  assert.deepEqual(plannerProposalSchema.parse(proposal), proposal);
});

test('rejects a size value outside the token set', () => {
  assert.equal(previewPatchSchema.safeParse({ kind: 'set_size', elementId: 'x', value: 'huge' }).success, false);
});

test('rejects a clarify proposal with fewer than two candidates', () => {
  const bad = { ...base, summary: 'Which button?', kind: 'clarify', question: 'Which button?', candidates: [{ id: 'a', label: 'A' }] };
  assert.equal(plannerProposalSchema.safeParse(bad).success, false);
});

test('rejects a prototype_change brief over 600 chars', () => {
  const bad = { ...base, summary: 'x', kind: 'prototype_change', brief: 'x'.repeat(601), relevantSources: [], constraints: [], mockedIntegrations: [] };
  assert.equal(plannerProposalSchema.safeParse(bad).success, false);
});

test('accepts observe/hold/undo/pause shapes', () => {
  assert.equal(plannerProposalSchema.safeParse({ ...base, summary: 'x', kind: 'observe', reason: 'off-topic' }).success, true);
  assert.equal(plannerProposalSchema.safeParse({ ...base, summary: 'x', kind: 'hold', reason: 'incomplete' }).success, true);
  assert.equal(plannerProposalSchema.safeParse({ ...base, summary: 'x', kind: 'undo', experimentId: 'exp-1' }).success, true);
  assert.equal(plannerProposalSchema.safeParse({ ...base, summary: 'x', kind: 'pause' }).success, true);
});
