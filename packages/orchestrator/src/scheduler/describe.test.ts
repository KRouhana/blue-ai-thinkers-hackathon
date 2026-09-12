import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describePatch, describePatchRelative, describeProposal } from './describe';

test('describes size/background/label/radius/visibility patches in plain words', () => {
  assert.equal(describePatch({ kind: 'set_size', elementId: 'x', value: 'lg' }, 'Start trial'), 'Trying a larger Start trial button');
  assert.equal(describePatch({ kind: 'set_size', elementId: 'x', value: 'sm' }, 'Start trial'), 'Trying a smaller Start trial button');
  assert.equal(describePatch({ kind: 'set_background', elementId: 'x', value: 'red' }, 'Explore sample'), 'Trying a red Explore sample button');
  assert.equal(describePatch({ kind: 'set_label', elementId: 'x', value: 'Get started' }, 'Start trial'), 'Trying the label "Get started" on Start trial');
  assert.equal(describePatch({ kind: 'set_visibility', elementId: 'x', value: false }, 'Banner'), 'Trying Banner hidden');
  assert.equal(describePatch({ kind: 'set_radius', elementId: 'x', value: 'pill' }, 'Start trial'), 'Trying a pill-shaped Start trial button');
  assert.equal(describePatch({ kind: 'set_radius', elementId: 'x', value: 'none' }, 'Start trial'), 'Trying a square Start trial button');
});

test('relative wording compares against the previous size when it is known', () => {
  assert.equal(describePatchRelative({ kind: 'set_size', elementId: 'x', value: 'md' }, 'Start trial', 'lg'), 'Trying a smaller Start trial button');
  assert.equal(describePatchRelative({ kind: 'set_size', elementId: 'x', value: 'xl' }, 'Start trial', 'lg'), 'Trying a larger Start trial button');
  assert.equal(describePatchRelative({ kind: 'set_size', elementId: 'x', value: 'md' }, 'Start trial', null), 'Trying a smaller Start trial button');
});

test('describeProposal summarises jobs and falls back to the planner summary', () => {
  const base = { id: 'i', sessionId: 's', captureEpoch: 'c', sourceObservationIds: ['t'], expectedRevision: { source: 1, config: 0 } };
  assert.equal(
    describeProposal({ ...base, summary: 'ignored', kind: 'prototype_change', brief: 'Add an overdue filter', relevantSources: [], constraints: [], mockedIntegrations: [] }, null),
    'Prototyping: Add an overdue filter',
  );
  assert.equal(describeProposal({ ...base, summary: 'Waiting for a complete idea', kind: 'hold', reason: 'incomplete' }, null), 'Waiting for a complete idea');
  assert.equal(
    describeProposal({ ...base, summary: 'x', kind: 'preview_patch', patch: { kind: 'set_size', elementId: 'e', value: 'lg' },
      targetEvidence: { contextObservationId: 'c1', elementId: 'e', basis: ['route'], explanation: 'e' } }, 'Start trial'),
    'Trying a larger Start trial button',
  );
});
