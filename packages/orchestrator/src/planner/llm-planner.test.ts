import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LlmPlanner } from './llm-planner';
import type { PlanningContext } from './planner';

const context: PlanningContext = {
  session: { id: 's', captureEpoch: 'cap', capture: 'listening', prototypeAutonomyEnabled: true, revision: { source: 1, config: 0 }, currentTopic: null },
  newTurns: [{ id: 't1', text: 'What if this button were bigger?', audioTurnSequence: 1 }],
  recentTurns: [], context: null, visibleExperiments: [], pendingClarification: null, repoMap: null,
  companyNotes: [], repoExcerpts: [],
};

const valid = {
  kind: 'preview_patch', summary: 'Trying a larger Start trial button', reason: 'named in the discussion',
  currentTopic: 'Start trial button', resolvesClarification: false,
  patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' },
  targetEvidence: { elementId: 'start-trial', basis: ['explicit_label'], explanation: 'named' },
  clarify: null, prototype: null, undoExperimentId: null,
};

test('reports its label so a live run is never confused with a fixture run', () => {
  assert.equal(new LlmPlanner({ generate: async () => valid }).label, 'live');
});

test('a valid structured object is returned as planner output', async () => {
  const planner = new LlmPlanner({ generate: async () => valid });
  const output = await planner.plan(context);
  assert.equal(output.kind, 'preview_patch');
  assert.equal(output.patch?.value, 'lg');
});

test('the system and user prompts are what the model actually receives', async () => {
  const seen: Array<{ system: string; prompt: string }> = [];
  const planner = new LlmPlanner({ generate: async (input) => { seen.push(input); return valid; } });
  await planner.plan(context);
  assert.match(seen[0]?.system ?? '', /never speak/);
  assert.match(seen[0]?.prompt ?? '', /Planning context/);
  assert.match(seen[0]?.prompt ?? '', /What if this button were bigger\?/);
});

test('output that does not match the schema becomes a hold, not an exception', async () => {
  const planner = new LlmPlanner({ generate: async () => ({ kind: 'launch_rocket' }) });
  const output = await planner.plan(context);
  assert.equal(output.kind, 'hold');
  assert.match(output.reason, /invalid/);
});

test('a thrown generate error becomes a hold that names the failure', async () => {
  const planner = new LlmPlanner({ generate: async () => { throw new Error('429 rate limited'); } });
  const output = await planner.plan(context);
  assert.equal(output.kind, 'hold');
  assert.match(output.reason, /planner unavailable: 429 rate limited/);
});

test('a generate call that never settles times out into a hold', async () => {
  const planner = new LlmPlanner({ generate: () => new Promise(() => {}), timeoutMs: 10 });
  const output = await planner.plan(context);
  assert.equal(output.kind, 'hold');
  assert.match(output.reason, /timed out/);
});
