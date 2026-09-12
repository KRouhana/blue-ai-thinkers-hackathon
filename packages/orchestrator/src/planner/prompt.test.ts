import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlanningContext } from './planner';
import { renderUserPrompt, SYSTEM_PROMPT } from './prompt';

const context: PlanningContext = {
  session: { id: 's', captureEpoch: 'cap', capture: 'listening', prototypeAutonomyEnabled: true, revision: { source: 1, config: 0 }, currentTopic: null },
  newTurns: [{ id: 't1', text: 'What if this button were bigger?', audioTurnSequence: 1 }],
  recentTurns: [], context: null, visibleExperiments: [], pendingClarification: null, repoMap: null,
  companyNotes: [], repoExcerpts: [],
};

test('the system prompt states the non-negotiables', () => {
  for (const phrase of ['never speak', 'negation', 'quoted', 'clarify', 'production', 'Hover alone']) {
    assert.ok(SYSTEM_PROMPT.includes(phrase), `system prompt is missing "${phrase}"`);
  }
});

test('the user prompt is a compact JSON rendering of the planning context', () => {
  const rendered = renderUserPrompt(context);
  const [preface, payload] = rendered.split('\n');
  assert.match(preface ?? '', /Planning context/);
  assert.deepEqual(JSON.parse(payload ?? '{}'), JSON.parse(JSON.stringify(context)));
});
