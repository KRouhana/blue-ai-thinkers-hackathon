import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadScenarioFixtures, retargetObservation, SCENARIOS_PATH } from './scenario-fixtures';

const jsonIds = (JSON.parse(readFileSync(SCENARIOS_PATH, 'utf8')) as Array<{ id: string }>).map((entry) => entry.id);

test('every scenario in scenarios.json has a replayable fixture', () => {
  const fixtures = loadScenarioFixtures();
  assert.deepEqual(fixtures.map((fixture) => fixture.id), jsonIds);
  assert.equal(fixtures.length, 10);
  for (const fixture of fixtures) {
    assert.ok(fixture.turns.length >= 1, `${fixture.id} has no turns`);
    assert.ok(fixture.fixtureOutput.kind.length > 0);
    assert.ok(fixture.acceptableOutcomes.length >= 1);
    assert.equal(fixture.contextObservation.kind, 'preview_context');
    assert.equal(fixture.expected.length > 0, true);
  }
});

test('scenarios that need a precondition carry the scripted turn that establishes it', () => {
  const byId = new Map(loadScenarioFixtures().map((fixture) => [fixture.id, fixture]));
  const correction = byId.get('correction');
  assert.ok(correction?.preconditions.includes('visible_size_experiment'));
  assert.ok((correction?.preTurns.length ?? 0) >= 1);
  assert.equal(correction?.preOutput?.kind, 'preview_patch');

  const late = byId.get('late_result');
  assert.ok(late?.preconditions.includes('running_job'));
  assert.equal(late?.preOutput?.kind, 'prototype_change');

  assert.ok(byId.get('pause')?.preconditions.includes('paused'));
  assert.ok(byId.get('from_zero')?.preconditions.includes('blank_template'));
});

test('scenarios whose expectation is no mutation are not scripted to mutate silently', () => {
  const byId = new Map(loadScenarioFixtures().map((fixture) => [fixture.id, fixture]));
  assert.equal(byId.get('negation')?.fixtureOutput.kind, 'observe');
  assert.equal(byId.get('quotation')?.fixtureOutput.kind, 'observe');
  assert.equal(byId.get('production')?.fixtureOutput.kind, 'observe');
  // The paused scenario deliberately scripts an actionable output: the gate, not the planner, must refuse it.
  assert.equal(byId.get('pause')?.fixtureOutput.kind, 'preview_patch');
  assert.deepEqual(byId.get('pause')?.acceptableOutcomes, ['no_experiment']);
});

test('retargeting rewrites session and epoch without touching the payload', () => {
  const fixture = loadScenarioFixtures()[0]!;
  const retargeted = retargetObservation(fixture.turns[0]!, 'ses-9', 'cap-9');
  assert.equal(retargeted.sessionId, 'ses-9');
  assert.equal(retargeted.captureEpoch, 'cap-9');
  assert.equal(retargeted.id, fixture.turns[0]!.id);
  assert.equal(fixture.turns[0]!.sessionId, 'fixture-session');
});

test('fixture utterances come from scenarios.json, not from invented text', () => {
  const scenarios = JSON.parse(readFileSync(SCENARIOS_PATH, 'utf8')) as Array<{ id: string; utterance: string }>;
  const byId = new Map(loadScenarioFixtures().map((fixture) => [fixture.id, fixture]));
  for (const scenario of scenarios) {
    const fixture = byId.get(scenario.id)!;
    assert.equal(fixture.turns.at(-1)?.text, scenario.utterance);
  }
});

test('the fixture planner replay table is keyed by the turn ids the orchestrator will see', () => {
  const fixtures = loadScenarioFixtures();
  const keys = fixtures.flatMap((fixture) => [fixture.turns.at(-1)!.id, ...(fixture.preTurns.length > 0 ? [fixture.preTurns.at(-1)!.id] : [])]);
  assert.equal(new Set(keys).size, keys.length, 'turn ids must be unique across fixtures');
});
