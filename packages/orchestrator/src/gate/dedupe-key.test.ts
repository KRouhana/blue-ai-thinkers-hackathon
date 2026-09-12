import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlannerProposal } from '@fork/contracts';
import { dedupeKeyFor, resolvedClarificationKey } from './dedupe-key';

const p = (over: Record<string, unknown> = {}): PlannerProposal => ({
  id: 'i1', sessionId: 's', captureEpoch: 'c', sourceObservationIds: ['t1', 'c1'],
  expectedRevision: { source: 1, config: 0 }, summary: 'x', kind: 'preview_patch',
  patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' },
  targetEvidence: { contextObservationId: 'c1', elementId: 'start-trial', basis: ['explicit_label'], explanation: 'e' },
  ...over,
} as unknown as PlannerProposal);

test('same sources + same action → same key; intent id and source order do not matter', () => {
  assert.equal(dedupeKeyFor('s', p()), dedupeKeyFor('s', p({ id: 'i2', sourceObservationIds: ['c1', 't1'] })));
});

test('different value or session → different key', () => {
  assert.notEqual(dedupeKeyFor('s', p()), dedupeKeyFor('s', p({ patch: { kind: 'set_size', elementId: 'start-trial', value: 'md' } })));
  assert.notEqual(dedupeKeyFor('s', p()), dedupeKeyFor('s2', p()));
});

test('resolved clarification key is stable', () => {
  assert.equal(resolvedClarificationKey('int-9'), 'clarify:int-9:resolved');
});
