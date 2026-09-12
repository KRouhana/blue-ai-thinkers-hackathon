import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlannerProposal, PreviewContextObservation, TranscriptObservation } from '@fork/contracts';
import type { SessionRecord, StoredExperiment, StoredObservation } from '@fork/state';
import { DEFAULT_CONFIG } from '../config';
import { dedupeKeyFor } from './dedupe-key';
import { runGate, type GateCode, type GateInput } from './gate';

const T0 = '2026-09-12T15:00:00.000Z';

const session: SessionRecord = {
  id: 's', projectConfigId: 'p', captureEpoch: 'cap', capture: 'listening', prototypeAutonomyEnabled: true,
  workspaceId: 'w', revision: { source: 1, config: 0 }, previewUrl: null, currentTopic: null, clarification: null,
  resumedAt: null, createdAt: T0, updatedAt: T0,
};

const speech: TranscriptObservation = {
  id: 't1', sessionId: 's', captureEpoch: 'cap', capturedAt: T0, version: 1, kind: 'transcript', phase: 'final',
  providerItemId: 't1', audioTurnSequence: 1, orderReliable: true, streamId: 'mic',
  text: 'What if this button were bigger?', speaker: { label: null, verified: false },
};

const context: PreviewContextObservation = {
  id: 'c1', sessionId: 's', captureEpoch: 'cap', capturedAt: T0, version: 1, kind: 'preview_context', workspaceId: 'w',
  revision: { source: 1, config: 0 }, route: '/signup', viewport: { width: 1280, height: 800 },
  focusId: null, hover: null, selection: null,
  elements: [
    { id: 'start-trial', role: 'button', label: 'Start trial', visible: true, box: { x: 0, y: 0, width: 1, height: 1 }, editable: ['size', 'background', 'label', 'radius'] },
    { id: 'hidden-btn', role: 'button', label: 'Hidden', visible: false, box: { x: 0, y: 0, width: 1, height: 1 }, editable: ['size'] },
    { id: 'task-table', role: 'table', label: 'Tasks', visible: true, box: { x: 0, y: 0, width: 1, height: 1 }, editable: [] },
  ],
};

const stored = (o: TranscriptObservation | PreviewContextObservation, extra: Partial<StoredObservation> = {}): StoredObservation => ({
  observation: o, planStatus: 'pending', supersededBy: null, intentId: null, receivedSeq: 1, ...extra,
});

function proposal(over: Record<string, unknown> = {}): PlannerProposal {
  const merged: Record<string, unknown> = {
    id: 'i1', sessionId: 's', captureEpoch: 'cap', sourceObservationIds: ['t1', 'c1'],
    expectedRevision: { source: 1, config: 0 }, summary: 'Try a larger Start trial button', kind: 'preview_patch',
    patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' },
    targetEvidence: { contextObservationId: 'c1', elementId: 'start-trial', basis: ['explicit_label'], explanation: 'Names the button.' },
    ...over,
  };
  const defined = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
  return defined as unknown as PlannerProposal;
}

const baseInput = (candidate: PlannerProposal, over: Partial<GateInput> = {}): GateInput => ({
  proposal: candidate,
  session,
  config: DEFAULT_CONFIG,
  observations: new Map([['t1', stored(speech)], ['c1', stored(context)]]),
  experiments: [],
  hasDedupeKey: () => false,
  dedupeKey: dedupeKeyFor('s', candidate),
  ...over,
});

const codeOf = (input: GateInput): GateCode | 'allowed' => {
  const result = runGate(input);
  return result.allowed ? 'allowed' : result.code;
};

const patchOnly = { patch: undefined, targetEvidence: undefined };

test('allows the canonical grounded preview patch', () => {
  const candidate = proposal();
  assert.deepEqual(runGate(baseInput(candidate)), { allowed: true, dedupeKey: dedupeKeyFor('s', candidate) });
});

test('rejects mutation while paused / stopped / autonomy off', () => {
  for (const override of [{ capture: 'paused' as const }, { capture: 'stopped' as const }, { prototypeAutonomyEnabled: false }]) {
    assert.equal(codeOf(baseInput(proposal(), { session: { ...session, ...override } })), 'session_disabled');
  }
});

test('observe/hold pass even when paused', () => {
  const observe = proposal({ kind: 'observe', reason: 'off topic', ...patchOnly });
  assert.equal(codeOf(baseInput(observe, { session: { ...session, capture: 'paused' } })), 'allowed');
});

test('rejects superseded, partial, wrong-epoch, and missing sources', () => {
  const cases: Array<[Partial<StoredObservation> | null, GateCode]> = [
    [{ supersededBy: 't2' }, 'source_superseded'],
    [{ observation: { ...speech, phase: 'partial' } }, 'source_not_final'],
    [{ observation: { ...speech, captureEpoch: 'old' } }, 'source_wrong_epoch'],
    [null, 'source_missing'],
  ];
  for (const [extra, code] of cases) {
    const observations = new Map([['c1', stored(context)]]);
    if (extra) observations.set('t1', stored(speech, extra));
    assert.equal(codeOf(baseInput(proposal(), { observations })), code);
  }
});

test('rejects hidden, non-editable, unknown, and mismatched targets', () => {
  const cases: Array<[Record<string, unknown>, GateCode]> = [
    [{ patch: { kind: 'set_size', elementId: 'hidden-btn', value: 'lg' }, targetEvidence: { contextObservationId: 'c1', elementId: 'hidden-btn', basis: ['explicit_label'], explanation: 'e' } }, 'target_hidden'],
    [{ patch: { kind: 'set_size', elementId: 'task-table', value: 'lg' }, targetEvidence: { contextObservationId: 'c1', elementId: 'task-table', basis: ['route'], explanation: 'e' } }, 'target_not_editable'],
    [{ patch: { kind: 'set_size', elementId: 'nope', value: 'lg' }, targetEvidence: { contextObservationId: 'c1', elementId: 'nope', basis: ['route'], explanation: 'e' } }, 'target_missing'],
    [{ targetEvidence: { contextObservationId: 'c1', elementId: 'task-table', basis: ['route'], explanation: 'e' } }, 'target_mismatch'],
  ];
  for (const [over, code] of cases) {
    assert.equal(codeOf(baseInput(proposal(over))), code);
  }
});

test('rejects operations not in config.allowedOperations and jobs without a workspace', () => {
  assert.equal(codeOf(baseInput(proposal(), { config: { ...DEFAULT_CONFIG, allowedOperations: ['undo'] } })), 'operation_not_permitted');
  const job = proposal({ kind: 'prototype_change', brief: 'Add filter', relevantSources: [], constraints: [], mockedIntegrations: [], ...patchOnly });
  assert.equal(codeOf(baseInput(job, { session: { ...session, workspaceId: null } })), 'no_workspace');
});

test('rejects absolute or traversing source paths in prototype_change', () => {
  const forged = proposal({
    kind: 'prototype_change', brief: 'x', constraints: [], mockedIntegrations: [], ...patchOnly,
    relevantSources: [{ kind: 'repo', path: '/etc/passwd', fingerprint: 'f' }],
  });
  assert.equal(codeOf(baseInput(forged)), 'path_not_allowed');
  const traversal = proposal({
    kind: 'prototype_change', brief: 'x', constraints: [], mockedIntegrations: [], ...patchOnly,
    relevantSources: [{ kind: 'repo', path: '../outside.ts', fingerprint: 'f' }],
  });
  assert.equal(codeOf(baseInput(traversal)), 'path_not_allowed');
});

test('rejects oversize label and brief', () => {
  assert.equal(codeOf(baseInput(proposal({ patch: { kind: 'set_label', elementId: 'start-trial', value: 'x'.repeat(61) } }))), 'size_bounds');
  const job = proposal({ kind: 'prototype_change', brief: 'x'.repeat(601), relevantSources: [], constraints: [], mockedIntegrations: [], ...patchOnly });
  assert.equal(codeOf(baseInput(job)), 'size_bounds');
});

test('rejects duplicates', () => {
  assert.equal(codeOf(baseInput(proposal(), { hasDedupeKey: () => true })), 'duplicate');
});

test('rejects revision mismatch and stale context', () => {
  assert.equal(codeOf(baseInput(proposal({ expectedRevision: { source: 0, config: 0 } }))), 'revision_mismatch');
  const staleContext = stored({ ...context, revision: { source: 0, config: 0 } });
  assert.equal(codeOf(baseInput(proposal(), { observations: new Map([['t1', stored(speech)], ['c1', staleContext]]) })), 'stale_context');
});

test('undo requires a visible experiment with a checkpoint', () => {
  const undo = proposal({ kind: 'undo', experimentId: 'e1', ...patchOnly });
  const experiment = (status: StoredExperiment['status'], checkpointId: string | null): StoredExperiment => ({
    id: 'e1', sessionId: 's', intentId: 'i0', status, summary: 's', origin: 'inferred_experiment',
    sourceObservationIds: [], revision: { source: 1, config: 1 }, checkpointId, mockNotes: [],
    targetKey: 'element:start-trial', createdAt: T0, updatedAt: T0,
  });
  assert.equal(codeOf(baseInput(undo, { experiments: [experiment('visible', 'chk-1')] })), 'allowed');
  assert.equal(codeOf(baseInput(undo, { experiments: [experiment('reverted', 'chk-1')] })), 'undo_not_applicable');
  assert.equal(codeOf(baseInput(undo, { experiments: [experiment('visible', null)] })), 'undo_not_applicable');
  assert.equal(codeOf(baseInput(undo)), 'undo_not_applicable');
});

test('clarify candidates must be visible elements of the observed context', () => {
  const ok = proposal({
    kind: 'clarify', question: 'Which button?', ...patchOnly,
    candidates: [{ id: 'start-trial', label: 'Start trial' }, { id: 'task-table', label: 'Tasks' }],
  });
  assert.equal(codeOf(baseInput(ok)), 'allowed');
  const ghost = proposal({
    kind: 'clarify', question: 'Which?', ...patchOnly,
    candidates: [{ id: 'start-trial', label: 'Start trial' }, { id: 'ghost', label: 'Ghost' }],
  });
  assert.equal(codeOf(baseInput(ghost)), 'candidates_invalid');
  const hidden = proposal({
    kind: 'clarify', question: 'Which?', ...patchOnly,
    candidates: [{ id: 'start-trial', label: 'Start trial' }, { id: 'hidden-btn', label: 'Hidden' }],
  });
  assert.equal(codeOf(baseInput(hidden)), 'candidates_invalid');
});

test('pause is gated by session state but needs no target', () => {
  assert.equal(codeOf(baseInput(proposal({ kind: 'pause', ...patchOnly }))), 'allowed');
  assert.equal(codeOf(baseInput(proposal({ kind: 'pause', ...patchOnly }), { session: { ...session, capture: 'stopped' } })), 'session_disabled');
});
