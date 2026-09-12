import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RepoMap } from '@fork/contracts';
import type { PlanningContext } from './planner';
import type { PlannerOutput } from './output-schema';
import { toProposal, type ProposalIds } from './to-proposal';

const ids: ProposalIds = {
  id: 'int-1', sessionId: 's', captureEpoch: 'cap', sourceObservationIds: ['t1', 'c1'], expectedRevision: { source: 1, config: 0 },
};

const context: PlanningContext['context'] = {
  observationId: 'c1', route: '/signup', revision: { source: 1, config: 0 }, focusId: null, hoverId: null, selectionId: null,
  elements: [
    { id: 'start-trial', role: 'button', label: 'Start trial', section: 'Signup', visible: true, editable: ['size', 'background', 'label', 'radius'] },
    { id: 'explore-sample', role: 'button', label: 'Explore sample', section: 'Signup', visible: true, editable: ['size', 'background', 'label', 'radius'] },
  ],
};

const planningContext = (over: Partial<PlanningContext> = {}): PlanningContext => ({
  session: { id: 's', captureEpoch: 'cap', capture: 'listening', prototypeAutonomyEnabled: true, revision: { source: 1, config: 0 }, currentTopic: null },
  newTurns: [{ id: 't1', text: 'What if this button were bigger?', audioTurnSequence: 1 }],
  recentTurns: [],
  context,
  visibleExperiments: [],
  pendingClarification: null,
  repoMap: null,
  companyNotes: [],
  repoExcerpts: [],
  ...over,
});

const repoMap: RepoMap = {
  workspaceId: 'demo-1', origin: 'existing_repo', fingerprint: 'f', framework: { name: 'react-vite', verified: false },
  routes: [{ route: '/tasks', sources: [{ kind: 'repo', path: 'src/pages/Tasks.tsx', fingerprint: 'abc' }] }],
  relevantSources: [{ kind: 'repo', path: 'src/data/tasks.ts', fingerprint: 'def' }],
  mockCapabilities: [], limitations: [],
};

const output = (over: Partial<PlannerOutput> = {}): PlannerOutput => ({
  kind: 'observe', summary: 'Discussion only', reason: 'nothing actionable', currentTopic: null, resolvesClarification: false,
  patch: null, targetEvidence: null, clarify: null, prototype: null, undoExperimentId: null, ...over,
});

test('converts a preview_patch output into a validated proposal citing the observed context', () => {
  const result = toProposal(output({
    kind: 'preview_patch', summary: 'Try a larger Start trial button',
    patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' },
    targetEvidence: { elementId: 'start-trial', basis: ['explicit_label'], explanation: 'The talk names the visible Start trial button.' },
  }), ids, planningContext(), null);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.proposal.kind, 'preview_patch');
  if (result.proposal.kind !== 'preview_patch') return;
  assert.deepEqual(result.proposal.patch, { kind: 'set_size', elementId: 'start-trial', value: 'lg' });
  assert.equal(result.proposal.targetEvidence.contextObservationId, 'c1');
  assert.equal(result.proposal.sourceObservationIds.length, 2);
  assert.equal(result.pendingPatch, null);
});

test('coerces a visibility value delivered as a string', () => {
  const result = toProposal(output({
    kind: 'preview_patch', summary: 'Hide the banner',
    patch: { kind: 'set_visibility', elementId: 'start-trial', value: 'false' },
    targetEvidence: { elementId: 'start-trial', basis: ['explicit_label'], explanation: 'named' },
  }), ids, planningContext(), null);
  assert.equal(result.ok, true);
  if (!result.ok || result.proposal.kind !== 'preview_patch') return;
  assert.deepEqual(result.proposal.patch, { kind: 'set_visibility', elementId: 'start-trial', value: false });
});

test('a size value outside the token set becomes a hold, never a guess', () => {
  const result = toProposal(output({
    kind: 'preview_patch', summary: 'Try huge',
    patch: { kind: 'set_size', elementId: 'start-trial', value: 'huge' },
    targetEvidence: { elementId: 'start-trial', basis: ['explicit_label'], explanation: 'named' },
  }), ids, planningContext(), null);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.hold.kind, 'hold');
  assert.match(result.reason, /planner output invalid/);
});

test('a patch without screen context becomes a hold', () => {
  const result = toProposal(output({
    kind: 'preview_patch', summary: 'Try a larger button',
    patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' },
    targetEvidence: { elementId: 'start-trial', basis: ['explicit_label'], explanation: 'named' },
  }), ids, planningContext({ context: null }), null);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /screen context/);
});

test('a patch with no target evidence basis becomes a hold instead of inventing one', () => {
  const result = toProposal(output({
    kind: 'preview_patch', summary: 'Try a larger button',
    patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' },
    targetEvidence: { elementId: 'start-trial', basis: [], explanation: 'named' },
  }), ids, planningContext(), null);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /basis/);
});

test('clarify candidates take their labels from the observed context and carry the pending patch', () => {
  const result = toProposal(output({
    kind: 'clarify', summary: 'Which button?',
    clarify: {
      question: 'Which button should be red?',
      candidateElementIds: ['start-trial', 'explore-sample', 'ghost'],
      pendingPatch: { kind: 'set_background', value: 'red' },
    },
  }), ids, planningContext(), null);

  assert.equal(result.ok, true);
  if (!result.ok || result.proposal.kind !== 'clarify') return;
  assert.deepEqual(result.proposal.candidates, [
    { id: 'start-trial', label: 'Start trial' },
    { id: 'explore-sample', label: 'Explore sample' },
  ]);
  assert.deepEqual(result.pendingPatch, { kind: 'set_background', value: 'red' });
});

test('clarify with fewer than two resolvable candidates becomes a hold', () => {
  const result = toProposal(output({
    kind: 'clarify', summary: 'Which?',
    clarify: { question: 'Which one?', candidateElementIds: ['ghost', 'phantom'], pendingPatch: null },
  }), ids, planningContext(), null);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /candidates/);
});

test('prototype_change keeps only source paths the repo map actually lists', () => {
  const result = toProposal(output({
    kind: 'prototype_change', summary: 'Prototype an overdue filter',
    prototype: {
      brief: 'Add a client-side overdue-only toggle to the sample task table.',
      relevantSourcePaths: ['src/pages/Tasks.tsx', 'src/data/tasks.ts', 'src/invented/Nope.tsx'],
      constraints: ['Use existing components'],
      mockedIntegrations: ['Task due dates are synthetic'],
    },
  }), ids, planningContext(), repoMap);

  assert.equal(result.ok, true);
  if (!result.ok || result.proposal.kind !== 'prototype_change') return;
  assert.deepEqual(result.proposal.relevantSources.map((source) => source.path), ['src/pages/Tasks.tsx', 'src/data/tasks.ts']);
  assert.deepEqual(result.proposal.mockedIntegrations, ['Task due dates are synthetic']);
});

test('prototype_change without a repo map keeps no invented sources', () => {
  const result = toProposal(output({
    kind: 'prototype_change', summary: 'Prototype a list',
    prototype: { brief: 'Create an operations request list.', relevantSourcePaths: ['src/App.tsx'], constraints: [], mockedIntegrations: [] },
  }), ids, planningContext(), null);
  assert.equal(result.ok, true);
  if (!result.ok || result.proposal.kind !== 'prototype_change') return;
  assert.deepEqual(result.proposal.relevantSources, []);
});

test('undo needs an experiment id; observe, hold, and pause pass through', () => {
  const missing = toProposal(output({ kind: 'undo', summary: 'Go back' }), ids, planningContext(), null);
  assert.equal(missing.ok, false);

  const undo = toProposal(output({ kind: 'undo', summary: 'Go back', undoExperimentId: 'exp-1' }), ids, planningContext(), null);
  assert.equal(undo.ok, true);
  if (undo.ok) assert.equal(undo.proposal.kind, 'undo');

  for (const kind of ['observe', 'hold', 'pause'] as const) {
    const result = toProposal(output({ kind, summary: 'Quiet', reason: 'off topic' }), ids, planningContext(), null);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.proposal.kind, kind);
  }
});

test('an empty summary falls back to a readable one and long fields are trimmed', () => {
  const result = toProposal(output({ kind: 'observe', summary: '', reason: 'x'.repeat(400) }), ids, planningContext(), null);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.proposal.summary.length > 0);
  if (result.proposal.kind === 'observe') assert.equal(result.proposal.reason.length, 300);
});
