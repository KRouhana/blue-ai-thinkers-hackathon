import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Observation, OutputPayload, PlannerProposal, PreviewContextObservation, PrototypeEngine, SessionSnapshot, TranscriptObservation } from '@fork/contracts';
import { openSqliteStore, type StateStore } from '@fork/state';
import { fixedClock } from './clock';
import { OrchestratorError } from './errors';
import { silentLogger } from './logger';
import { createOrchestrator, type Orchestrator } from './orchestrator';
import type { PlannerOutput } from './planner/output-schema';
import type { Planner, PlanningContext } from './planner/planner';
import { FakePrototypeEngine } from './testing/fake-engine';
import { FixturePlanner } from './testing/fixture-planner';
import { loadScenarioFixtures, retargetObservation, scenarioPlannerTable, type ScenarioFixture } from './testing/scenario-fixtures';

const COMPANY_DOCS = fileURLToPath(new URL('../../../fixtures/company', import.meta.url));
const CLOCK_TIME = '2026-09-12T15:00:00.000Z';

const FIXTURES = new Map(loadScenarioFixtures().map((fixture) => [fixture.id, fixture]));
const fixture = (id: string): ScenarioFixture => {
  const found = FIXTURES.get(id);
  if (!found) throw new Error(`unknown scenario fixture ${id}`);
  return found;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

interface Harness {
  store: StateStore;
  engine: FakePrototypeEngine;
  orchestrator: Orchestrator;
  payloads: OutputPayload[];
  subscribe: (sessionId: string) => void;
}

function boot(options: { planner?: Planner; table?: Map<string, PlannerOutput>; jobDelayMs?: number; engine?: PrototypeEngine } = {}): Harness {
  const store = openSqliteStore(':memory:');
  const engine = new FakePrototypeEngine({ jobDelayMs: options.jobDelayMs ?? 2 });
  const orchestrator = createOrchestrator({
    store,
    engine: options.engine ?? engine,
    planner: options.planner ?? new FixturePlanner(options.table ?? scenarioPlannerTable()),
    projects: [
      { id: 'demo-product', label: 'Fixture demo product', mode: 'existing_repo', workspaceRoot: null },
      { id: 'blank-template', label: 'Blank prepared template', mode: 'blank_template', workspaceRoot: null },
    ],
    config: { settleMs: 1 },
    clock: fixedClock(CLOCK_TIME),
    logger: silentLogger,
    companyDocsDir: COMPANY_DOCS,
  });
  const payloads: OutputPayload[] = [];
  return {
    store, engine, orchestrator, payloads,
    subscribe: (sessionId) => { orchestrator.subscribe(sessionId, (event) => { payloads.push(event.payload); }); },
  };
}

async function startSession(harness: Harness, projectConfigId = 'demo-product'): Promise<SessionSnapshot> {
  const created = await harness.orchestrator.createSession({ projectConfigId });
  harness.subscribe(created.snapshot.id);
  return harness.orchestrator.setCapture(created.snapshot.id, { action: 'start', prototypeAutonomyEnabled: true });
}

const retarget = (observations: readonly Observation[], snapshot: SessionSnapshot): Observation[] =>
  observations.map((observation) => retargetObservation(observation, snapshot.id, snapshot.captureEpoch));

async function play(harness: Harness, snapshot: SessionSnapshot, scenario: ScenarioFixture, turns = scenario.turns): Promise<void> {
  await harness.orchestrator.ingestObservations(snapshot.id, retarget([scenario.contextObservation], snapshot));
  await harness.orchestrator.ingestObservations(snapshot.id, retarget(turns, snapshot));
  await harness.orchestrator.flush(snapshot.id);
}

const statuses = (payloads: readonly OutputPayload[]): string[] =>
  payloads.flatMap((payload) => (payload.kind === 'status' ? [payload.message] : []));

const visibleExperiments = (store: StateStore, sessionId: string) =>
  store.listExperiments(sessionId, 50).filter((experiment) => experiment.status === 'visible');

const proposalsOf = (store: StateStore, sessionId: string): PlannerProposal[] =>
  store.listIntents(sessionId, 50).map((intent) => intent.proposal);

// ── the first success: ordinary speech becomes a reversible experiment ──
test('suggestion: a finalized turn plus valid screen context produces one undoable experiment', async () => {
  const harness = boot();
  const snapshot = await startSession(harness);
  await play(harness, snapshot, fixture('suggestion'));

  const current = harness.orchestrator.getSnapshot(snapshot.id)!;
  assert.deepEqual(current.revision, { source: 1, config: 1 });
  assert.equal(current.experiments.filter((experiment) => experiment.status === 'visible').length, 1);
  assert.equal(current.currentTopic, 'Start trial button');
  assert.deepEqual(statuses(harness.payloads).filter((message) => message.includes('Undo')), ['Trying a larger Start trial button — Undo']);
  assert.deepEqual(harness.engine.appliedPatches(), [{ kind: 'set_size', elementId: 'start-trial', value: 'lg' }]);
  harness.store.close();
});

test('a duplicate delivery of the same finalized turn still produces exactly one experiment', async () => {
  const harness = boot();
  const snapshot = await startSession(harness);
  const scenario = fixture('suggestion');
  await play(harness, snapshot, scenario);
  const report = await harness.orchestrator.ingestObservations(snapshot.id, retarget(scenario.turns, snapshot));
  await harness.orchestrator.flush(snapshot.id);

  assert.equal(report.accepted, 0);
  assert.equal(report.duplicates.length, scenario.turns.length);
  assert.equal(visibleExperiments(harness.store, snapshot.id).length, 1);
  assert.equal(harness.engine.appliedPatches().length, 1);
  harness.store.close();
});

test('a corrected final replaces its prior segment before planning runs', async () => {
  const scenario = fixture('suggestion');
  const original = scenario.turns.at(-1)!;
  const corrected: TranscriptObservation = { ...original, id: 'corrected-1', version: 2, supersedesObservationId: original.id };
  const table = scenarioPlannerTable();
  table.set('corrected-1', scenario.fixtureOutput);

  const harness = boot({ table });
  const snapshot = await startSession(harness);
  await harness.orchestrator.ingestObservations(snapshot.id, retarget([scenario.contextObservation, ...scenario.turns], snapshot));
  await harness.orchestrator.ingestObservations(snapshot.id, retarget([corrected], snapshot));
  await harness.orchestrator.flush(snapshot.id);

  const proposals = proposalsOf(harness.store, snapshot.id);
  assert.equal(proposals.length, 1);
  assert.ok(proposals[0]!.sourceObservationIds.includes('corrected-1'));
  assert.ok(!proposals[0]!.sourceObservationIds.includes(original.id));
  harness.store.close();
});

test('caption deltas never reach the planner', async () => {
  const scenario = fixture('suggestion');
  const partial: TranscriptObservation = { ...scenario.turns.at(-1)!, id: 'partial-1', phase: 'partial' };
  const harness = boot();
  const snapshot = await startSession(harness);
  const report = await harness.orchestrator.ingestObservations(snapshot.id, retarget([scenario.contextObservation, partial], snapshot));
  await harness.orchestrator.flush(snapshot.id);

  assert.equal(report.ignoredPartials, 1);
  assert.equal(harness.store.getObservation('partial-1'), null);
  assert.equal(proposalsOf(harness.store, snapshot.id).length, 0);
  harness.store.close();
});

// ── host authority ────────────────────────────────────────────────────
test('pause blocks mutation, resume does not replay the paused speech, and later speech plans normally', async () => {
  const harness = boot();
  const snapshot = await startSession(harness);
  const paused = await harness.orchestrator.applyControl(snapshot.id, { kind: 'pause' });
  assert.equal(paused.capture, 'paused');

  const scenario = fixture('suggestion');
  await play(harness, snapshot, scenario);
  assert.equal(visibleExperiments(harness.store, snapshot.id).length, 0);
  assert.equal(harness.store.getObservation(scenario.turns.at(-1)!.id)?.planStatus, 'skipped');

  const resumed = await harness.orchestrator.applyControl(snapshot.id, { kind: 'resume' });
  assert.equal(resumed.capture, 'listening');
  await harness.orchestrator.flush(snapshot.id);
  assert.equal(visibleExperiments(harness.store, snapshot.id).length, 0, 'paused speech must not be replayed on resume');

  const later = fixture('correction');
  const followUp: TranscriptObservation = { ...later.turns.at(-1)!, id: 'after-resume', capturedAt: '2026-09-12T15:00:30.000Z' };
  await harness.orchestrator.ingestObservations(snapshot.id, retarget([followUp], snapshot));
  assert.equal(harness.store.getObservation('after-resume')?.planStatus, 'pending', 'speech after resume is eligible again');
  await harness.orchestrator.flush(snapshot.id);
  assert.equal(harness.store.getObservation('after-resume')?.planStatus, 'planned');
  harness.orchestrator.dispose();
  harness.store.close();
});

test('stop cancels the active writer, closes capture, and skips pending speech', async () => {
  const harness = boot({ jobDelayMs: 200 });
  const snapshot = await startSession(harness);
  const scenario = fixture('structural');
  await harness.orchestrator.ingestObservations(snapshot.id, retarget([scenario.contextObservation, ...scenario.turns], snapshot));
  await sleep(40);

  const stopped = await harness.orchestrator.applyControl(snapshot.id, { kind: 'stop' });
  assert.equal(stopped.capture, 'stopped');
  assert.equal(stopped.prototypeAutonomyEnabled, false);
  const experiments = harness.store.listExperiments(snapshot.id, 10);
  assert.equal(experiments.length, 1);
  assert.equal(experiments[0]?.status, 'superseded');
  assert.deepEqual(harness.orchestrator.getSnapshot(snapshot.id)?.revision, { source: 1, config: 0 });
  harness.store.close();
});

test('restarting capture opens a new epoch and observations from the old epoch are reported, not planned', async () => {
  const harness = boot();
  const first = await startSession(harness);
  const second = await harness.orchestrator.setCapture(first.id, { action: 'start', prototypeAutonomyEnabled: true });
  assert.notEqual(second.captureEpoch, first.captureEpoch);

  const scenario = fixture('suggestion');
  const report = await harness.orchestrator.ingestObservations(first.id, retarget([scenario.contextObservation, ...scenario.turns], first));
  await harness.orchestrator.flush(first.id);
  assert.equal(report.accepted, 0);
  assert.equal(report.staleEpoch.length, scenario.turns.length + 1);
  assert.equal(visibleExperiments(harness.store, first.id).length, 0);
  harness.store.close();
});

// ── quiet uncertainty ─────────────────────────────────────────────────
test('ambiguity asks one silent question, and the host answer applies the pending patch exactly once', async () => {
  const harness = boot();
  const snapshot = await startSession(harness);
  await play(harness, snapshot, fixture('ambiguity'));

  const clarification = harness.orchestrator.getSnapshot(snapshot.id)?.clarification;
  assert.ok(clarification, 'expected a pending clarification');
  assert.deepEqual(clarification!.candidates.map((candidate) => candidate.id), ['start-trial', 'explore-sample']);
  assert.ok(harness.payloads.some((payload) => payload.kind === 'clarification'));
  assert.equal(visibleExperiments(harness.store, snapshot.id).length, 0);

  await harness.orchestrator.applyControl(snapshot.id, { kind: 'clarification_answer', intentId: clarification!.intentId, candidateId: 'explore-sample' });
  await harness.orchestrator.flush(snapshot.id);

  assert.deepEqual(harness.engine.appliedPatches(), [{ kind: 'set_size', elementId: 'explore-sample', value: 'lg' }]);
  assert.equal(harness.orchestrator.getSnapshot(snapshot.id)?.clarification, null);

  await assert.rejects(
    harness.orchestrator.applyControl(snapshot.id, { kind: 'clarification_answer', intentId: clarification!.intentId, candidateId: 'start-trial' }),
    (error: unknown) => error instanceof OrchestratorError && error.status === 409,
  );
  assert.equal(harness.engine.appliedPatches().length, 1);
  harness.store.close();
});

test('a later turn can resolve the pending question without a wake word', async () => {
  const ambiguity = fixture('ambiguity');
  const resolvingTurn: TranscriptObservation = {
    ...ambiguity.turns.at(-1)!, id: 'resolve-1', capturedAt: '2026-09-12T15:00:08.000Z',
    text: 'I mean the Explore sample button.',
  };
  const table = scenarioPlannerTable();
  table.set('resolve-1', {
    kind: 'preview_patch', summary: 'Trying a larger Explore sample button', reason: 'the pending question is answered',
    currentTopic: 'Explore sample button', resolvesClarification: true,
    patch: { kind: 'set_size', elementId: 'explore-sample', value: 'lg' },
    targetEvidence: { elementId: 'explore-sample', basis: ['explicit_label'], explanation: 'The speaker named Explore sample.' },
    clarify: null, prototype: null, undoExperimentId: null,
  });

  const harness = boot({ table });
  const snapshot = await startSession(harness);
  await play(harness, snapshot, ambiguity);
  const clarification = harness.orchestrator.getSnapshot(snapshot.id)!.clarification!;

  await harness.orchestrator.ingestObservations(snapshot.id, retarget([resolvingTurn], snapshot));
  await harness.orchestrator.flush(snapshot.id);

  assert.deepEqual(harness.engine.appliedPatches(), [{ kind: 'set_size', elementId: 'explore-sample', value: 'lg' }]);
  assert.equal(harness.orchestrator.getSnapshot(snapshot.id)?.clarification, null);
  await assert.rejects(
    harness.orchestrator.applyControl(snapshot.id, { kind: 'clarification_answer', intentId: clarification.intentId, candidateId: 'start-trial' }),
    (error: unknown) => error instanceof OrchestratorError && error.status === 409,
  );
  harness.store.close();
});

test('an optional click on a candidate resolves the pending question, and only once', async () => {
  const harness = boot();
  const snapshot = await startSession(harness);
  const ambiguity = fixture('ambiguity');
  await play(harness, snapshot, ambiguity);
  assert.ok(harness.orchestrator.getSnapshot(snapshot.id)?.clarification);

  const clicked: PreviewContextObservation = {
    ...ambiguity.contextObservation, id: 'ctx-click', capturedAt: '2026-09-12T15:00:15.000Z',
    selection: { elementId: 'explore-sample', at: '2026-09-12T15:00:15.000Z' },
  };
  await harness.orchestrator.ingestObservations(snapshot.id, retarget([clicked], snapshot));
  await harness.orchestrator.flush(snapshot.id);

  assert.deepEqual(harness.engine.appliedPatches(), [{ kind: 'set_size', elementId: 'explore-sample', value: 'lg' }]);
  assert.equal(harness.orchestrator.getSnapshot(snapshot.id)?.clarification, null);

  const clickedAgain: PreviewContextObservation = { ...clicked, id: 'ctx-click-2', capturedAt: '2026-09-12T15:00:16.000Z' };
  await harness.orchestrator.ingestObservations(snapshot.id, retarget([clickedAgain], snapshot));
  await harness.orchestrator.flush(snapshot.id);
  assert.equal(harness.engine.appliedPatches().length, 1, 'an already-applied request is never repeated');
  harness.store.close();
});

test('a pending question expires when the screen moves on', async () => {
  const harness = boot();
  const snapshot = await startSession(harness);
  await play(harness, snapshot, fixture('ambiguity'));
  assert.ok(harness.orchestrator.getSnapshot(snapshot.id)?.clarification);

  const moved: PreviewContextObservation = {
    ...fixture('structural').contextObservation, id: 'ctx-moved', capturedAt: '2026-09-12T15:00:20.000Z',
  };
  await harness.orchestrator.ingestObservations(snapshot.id, retarget([moved], snapshot));

  assert.equal(harness.orchestrator.getSnapshot(snapshot.id)?.clarification, null);
  assert.match(statuses(harness.payloads).join(' | '), /Question expired/);
  harness.store.close();
});

// ── corrections ───────────────────────────────────────────────────────
test('correction: a smaller size lands as a new grounded experiment, not a code job', async () => {
  const table = scenarioPlannerTable();
  const harness = boot({ table });
  const snapshot = await startSession(harness);
  const scenario = fixture('correction');

  await play(harness, snapshot, scenario, scenario.preTurns);
  assert.equal(visibleExperiments(harness.store, snapshot.id).length, 1);

  // The screen re-reports itself at the new config revision, then the correction is spoken.
  const refreshed: PreviewContextObservation = {
    ...scenario.contextObservation, id: 'ctx-after', capturedAt: '2026-09-12T15:00:10.000Z', revision: { source: 1, config: 1 },
  };
  const correctionTurn: TranscriptObservation = { ...scenario.turns.at(-1)!, id: 'correction-late', capturedAt: '2026-09-12T15:00:12.000Z' };
  table.set('correction-late', scenario.fixtureOutput);

  await harness.orchestrator.ingestObservations(snapshot.id, retarget([refreshed], snapshot));
  await harness.orchestrator.ingestObservations(snapshot.id, retarget([correctionTurn], snapshot));
  await harness.orchestrator.flush(snapshot.id);

  assert.deepEqual(harness.engine.appliedPatches(), [
    { kind: 'set_size', elementId: 'start-trial', value: 'lg' },
    { kind: 'set_size', elementId: 'start-trial', value: 'md' },
  ]);
  assert.match(statuses(harness.payloads).join(' | '), /Trying a smaller Start trial button — Undo/);
  assert.equal(harness.store.listIntents(snapshot.id, 10).every((intent) => intent.proposal.kind !== 'prototype_change'), true);
  harness.store.close();
});

test('a correction citing a screen snapshot older than the current preview is refused, not applied blindly', async () => {
  const harness = boot();
  const snapshot = await startSession(harness);
  const scenario = fixture('correction');

  await play(harness, snapshot, scenario, scenario.preTurns);
  // No refreshed context: the only snapshot valid at speech time is the pre-change one.
  await harness.orchestrator.ingestObservations(snapshot.id, retarget(scenario.turns, snapshot));
  await harness.orchestrator.flush(snapshot.id);

  assert.deepEqual(harness.engine.appliedPatches(), [{ kind: 'set_size', elementId: 'start-trial', value: 'lg' }]);
  const refusal = harness.store.listIntents(snapshot.id, 10).at(-1);
  assert.equal(refusal?.gateStatus, 'rejected');
  assert.match(refusal?.gateReason ?? '', /stale_context/);
  harness.store.close();
});

test('an inferred undo reverts the visible experiment', async () => {
  const scenario = fixture('correction');
  const table = scenarioPlannerTable();
  const undoTurn: TranscriptObservation = { ...scenario.turns.at(-1)!, id: 'undo-1', text: 'No, keep the original size.', capturedAt: '2026-09-12T15:00:12.000Z' };
  const harness = boot({ table });
  const snapshot = await startSession(harness);
  await play(harness, snapshot, scenario, scenario.preTurns);
  const experimentId = visibleExperiments(harness.store, snapshot.id)[0]!.id;
  table.set('undo-1', {
    kind: 'undo', summary: 'Reverting the size experiment', reason: 'the team wants the original size back',
    currentTopic: null, resolvesClarification: false, patch: null, targetEvidence: null, clarify: null,
    prototype: null, undoExperimentId: experimentId,
  });

  await harness.orchestrator.ingestObservations(snapshot.id, retarget([undoTurn], snapshot));
  await harness.orchestrator.flush(snapshot.id);

  assert.equal(harness.store.getExperiment(experimentId)?.status, 'reverted');
  assert.match(statuses(harness.payloads).join(' | '), /Reverted: Trying a larger Start trial button/);
  harness.store.close();
});

// ── structural work ───────────────────────────────────────────────────
test('structural: a real job runs to ready and bumps the source revision', async () => {
  const harness = boot();
  const snapshot = await startSession(harness);
  await play(harness, snapshot, fixture('structural'));

  const current = harness.orchestrator.getSnapshot(snapshot.id)!;
  assert.deepEqual(current.revision, { source: 2, config: 0 });
  assert.equal(current.previewUrl, 'http://localhost:4173');
  const jobStates = harness.payloads.flatMap((payload) => (payload.kind === 'job' ? [payload.progress.state] : []));
  assert.deepEqual(jobStates, ['queued', 'running', 'checking', 'ready']);
  const experiment = visibleExperiments(harness.store, snapshot.id)[0];
  assert.match(experiment?.summary ?? '', /^Prototyping: Add a client-side overdue-only toggle/);
  assert.ok(experiment?.mockNotes.some((note) => note.includes('FIXTURE')));
  harness.store.close();
});

test('from zero: a blank prepared template still produces one job', async () => {
  const harness = boot();
  const snapshot = await startSession(harness, 'blank-template');
  await play(harness, snapshot, fixture('from_zero'));

  assert.deepEqual(harness.orchestrator.getSnapshot(snapshot.id)?.revision, { source: 2, config: 0 });
  assert.equal(visibleExperiments(harness.store, snapshot.id).length, 1);
  harness.store.close();
});

test('late result: a newer direction supersedes the running job instead of both landing', async () => {
  const harness = boot({ jobDelayMs: 200 });
  const snapshot = await startSession(harness);
  const scenario = fixture('late_result');

  await harness.orchestrator.ingestObservations(snapshot.id, retarget([scenario.contextObservation, ...scenario.preTurns], snapshot));
  await sleep(40);
  await harness.orchestrator.ingestObservations(snapshot.id, retarget(scenario.turns, snapshot));
  await sleep(40);
  await harness.orchestrator.flush(snapshot.id);

  const experiments = harness.store.listExperiments(snapshot.id, 10);
  assert.equal(experiments.length, 2);
  assert.equal(experiments[0]?.status, 'superseded');
  assert.equal(experiments[1]?.status, 'visible');
  assert.deepEqual(harness.orchestrator.getSnapshot(snapshot.id)?.revision, { source: 2, config: 0 });
  assert.match(statuses(harness.payloads).join(' | '), /Discarded a late result/);
  harness.store.close();
});

test('a failed job reports the diagnostic and leaves the preview revision alone', async () => {
  const harness = boot();
  const snapshot = await startSession(harness);
  harness.engine.failNextJob('TypeError: overdue is not defined');
  await play(harness, snapshot, fixture('structural'));

  assert.deepEqual(harness.orchestrator.getSnapshot(snapshot.id)?.revision, { source: 1, config: 0 });
  assert.equal(harness.store.listExperiments(snapshot.id, 10)[0]?.status, 'failed');
  assert.match(statuses(harness.payloads).join(' | '), /Could not apply: TypeError: overdue is not defined/);
  harness.store.close();
});

// ── refusals ──────────────────────────────────────────────────────────
test('a gate rejection is recorded on the intent and produces no experiment or event noise', async () => {
  const harness = boot();
  const snapshot = await startSession(harness);
  await harness.orchestrator.applyControl(snapshot.id, { kind: 'pause' });
  const before = harness.payloads.length;

  const scenario = fixture('pause');
  await harness.orchestrator.ingestObservations(snapshot.id, retarget([scenario.contextObservation], snapshot));
  await harness.orchestrator.ingestObservations(snapshot.id, retarget(scenario.turns, snapshot));
  await harness.orchestrator.flush(snapshot.id);

  assert.equal(harness.store.listExperiments(snapshot.id, 10).length, 0);
  assert.equal(harness.payloads.length, before, 'a refusal is quiet');
  harness.store.close();
});

test('production requests never mutate anything', async () => {
  const harness = boot();
  const snapshot = await startSession(harness);
  await play(harness, snapshot, fixture('production'));

  assert.equal(harness.store.listExperiments(snapshot.id, 10).length, 0);
  assert.deepEqual(harness.orchestrator.getSnapshot(snapshot.id)?.revision, { source: 1, config: 0 });
  assert.equal(proposalsOf(harness.store, snapshot.id)[0]?.kind, 'observe');
  harness.store.close();
});

test('negation and quotation are observed, never executed', async () => {
  for (const id of ['negation', 'quotation'] as const) {
    const harness = boot();
    const snapshot = await startSession(harness);
    await play(harness, snapshot, fixture(id));
    assert.equal(harness.store.listExperiments(snapshot.id, 10).length, 0, `${id} must not mutate`);
    assert.equal(harness.engine.appliedPatches().length, 0);
    harness.store.close();
  }
});

// ── resilience ────────────────────────────────────────────────────────
test('a planner failure is reported once and later speech still plans', async () => {
  let calls = 0;
  const table = scenarioPlannerTable();
  const fallback = new FixturePlanner(table);
  const flaky: Planner = {
    label: 'fixture',
    plan: async (context: PlanningContext) => {
      calls += 1;
      if (calls === 1) throw new Error('planner exploded');
      return fallback.plan(context);
    },
  };

  const harness = boot({ planner: flaky });
  const snapshot = await startSession(harness);
  const first = fixture('production');
  await play(harness, snapshot, first);
  assert.ok(harness.payloads.some((payload) => payload.kind === 'error' && payload.code === 'planner_failed'));
  assert.equal(harness.store.getObservation(first.turns.at(-1)!.id)?.planStatus, 'failed');

  await play(harness, snapshot, fixture('suggestion'));
  assert.equal(visibleExperiments(harness.store, snapshot.id).length, 1);
  harness.store.close();
});

test('createSession refuses a project that is not in the server allowlist', async () => {
  const harness = boot();
  await assert.rejects(
    harness.orchestrator.createSession({ projectConfigId: '../../etc' }),
    (error: unknown) => error instanceof OrchestratorError && error.code === 'project_not_allowed',
  );
  harness.store.close();
});

test('the orchestrator reports which planner and engine are actually wired', async () => {
  const harness = boot();
  assert.equal(harness.orchestrator.plannerLabel, 'fixture');
  assert.equal(harness.orchestrator.engineLabel, 'FIXTURE');
  harness.store.close();
});

test('events replay from a cursor so a reconnecting client can catch up', async () => {
  const harness = boot();
  const snapshot = await startSession(harness);
  await play(harness, snapshot, fixture('suggestion'));

  const all = harness.orchestrator.listEvents(snapshot.id, 0, 100);
  assert.ok(all.length >= 3);
  const tail = harness.orchestrator.listEvents(snapshot.id, all[0]!.sequence, 100);
  assert.deepEqual(tail.map((event) => event.sequence), all.slice(1).map((event) => event.sequence));
  assert.equal(harness.orchestrator.getSnapshot(snapshot.id)?.lastEventSequence, all.at(-1)?.sequence);
  harness.store.close();
});
