/**
 * Replays scenarios.json through the real orchestrator and reports the action kind and outcome.
 *
 *   npm run replay -- --planner=fixture       deterministic scripted planner (expect 10/10)
 *   npm run replay -- --planner=live          the real model; results vary and are reported as-is
 *   npm run replay -- --only=structural       one scenario
 *
 * The engine is always the labelled FIXTURE engine: this exercises B's pipeline, not C's worker.
 */
import { fileURLToPath } from 'node:url';
import type { Observation, SessionSnapshot } from '@fork/contracts';
import {
  createOrchestrator, fixedClock, LlmPlanner, resolvePlannerModel, silentLogger, type Orchestrator, type Planner,
} from '@fork/orchestrator';
import {
  FakePrototypeEngine, FixturePlanner, loadScenarioFixtures, retargetObservation, scenarioPlannerTable,
  type Outcome, type ScenarioFixture,
} from '@fork/orchestrator/testing';
import { openSqliteStore, type StateStore } from '@fork/state';

const COMPANY_DOCS = fileURLToPath(new URL('../../../fixtures/company', import.meta.url));
// Fixture speech is timestamped from 15:00:01 onward; capture must open just before it, or the
// resume guard would (correctly) treat every scripted turn as speech from before the session.
const REPLAY_CLOCK = '2026-09-12T15:00:00.500Z';
const JOB_DELAY_MS = 150;
const POLL_MS = 10;
const POLL_BUDGET_MS = 3000;

interface Options {
  planner: 'fixture' | 'live';
  only: string | null;
}

function parseArgs(argv: readonly string[]): Options {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const planner = value('planner') ?? 'fixture';
  if (planner !== 'fixture' && planner !== 'live') throw new Error(`--planner must be fixture or live, got '${planner}'`);
  return { planner, only: value('only') };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

async function waitFor(predicate: () => boolean): Promise<boolean> {
  const deadline = Date.now() + POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(POLL_MS);
  }
  return false;
}

interface Run {
  store: StateStore;
  orchestrator: Orchestrator;
  engine: FakePrototypeEngine;
}

function buildRun(planner: Planner): Run {
  const store = openSqliteStore(':memory:');
  const engine = new FakePrototypeEngine({ jobDelayMs: JOB_DELAY_MS });
  const orchestrator = createOrchestrator({
    store,
    engine,
    planner,
    projects: [
      { id: 'demo-product', label: 'Fixture demo product', mode: 'existing_repo', workspaceRoot: null },
      { id: 'blank-template', label: 'Blank prepared template', mode: 'blank_template', workspaceRoot: null },
    ],
    config: { settleMs: 5 },
    clock: fixedClock(REPLAY_CLOCK),
    logger: silentLogger,
    companyDocsDir: COMPANY_DOCS,
  });
  return { store, orchestrator, engine };
}

const retarget = (observations: readonly Observation[], snapshot: SessionSnapshot): Observation[] =>
  observations.map((observation) => retargetObservation(observation, snapshot.id, snapshot.captureEpoch));

async function applyPreconditions(run: Run, snapshot: SessionSnapshot, fixture: ScenarioFixture): Promise<void> {
  if (fixture.preconditions.includes('paused')) {
    await run.orchestrator.applyControl(snapshot.id, { kind: 'pause' });
    return;
  }
  if (fixture.preTurns.length === 0) return;

  await run.orchestrator.ingestObservations(snapshot.id, retarget([fixture.contextObservation], snapshot));
  await run.orchestrator.ingestObservations(snapshot.id, retarget(fixture.preTurns, snapshot));

  if (fixture.preconditions.includes('running_job')) {
    // Leave the first job running so the next turn genuinely collides with it.
    await waitFor(() => run.store.listExperiments(snapshot.id, 10).some((experiment) => experiment.status === 'applying'));
    return;
  }
  await run.orchestrator.flush(snapshot.id);
}

function observedOutcomes(run: Run, sessionId: string): Set<Outcome> {
  const snapshot = run.orchestrator.getSnapshot(sessionId);
  const experiments = run.store.listExperiments(sessionId, 50);
  const observed = new Set<Outcome>();
  if (snapshot?.clarification) observed.add('clarification_shown');
  if (snapshot?.capture === 'paused') observed.add('pause');
  if (experiments.length === 0) observed.add('no_experiment');

  const elementPatches = experiments.filter((experiment) => experiment.targetKey.startsWith('element:'));
  const jobs = experiments.filter((experiment) => experiment.targetKey.startsWith('job:'));
  if (elementPatches.some((experiment) => experiment.status === 'visible')) observed.add('preview_patch_visible');
  if (elementPatches.some((experiment) => experiment.status === 'reverted')
    || elementPatches.filter((experiment) => experiment.status === 'visible').length > 1) {
    observed.add('undo_or_smaller_patch');
  }
  if (jobs.some((experiment) => experiment.status === 'visible')) observed.add('job_ready');
  if (jobs.some((experiment) => experiment.status === 'superseded')) observed.add('job_superseded');
  return observed;
}

interface Result {
  id: string;
  expected: string;
  kind: string;
  gate: string;
  observed: string;
  passed: boolean;
  note: string;
}

async function replay(fixture: ScenarioFixture, planner: Planner): Promise<Result> {
  const run = buildRun(planner);
  try {
    const projectConfigId = fixture.preconditions.includes('blank_template') ? 'blank-template' : 'demo-product';
    const created = await run.orchestrator.createSession({ projectConfigId });
    const snapshot = await run.orchestrator.setCapture(created.snapshot.id, { action: 'start', prototypeAutonomyEnabled: true });

    await applyPreconditions(run, snapshot, fixture);

    // The preview re-reports itself at its current revision before the next thing is said, exactly
    // as Track A's collector does after a change lands. Without it a correction cites a stale screen.
    const current = run.orchestrator.getSnapshot(snapshot.id)!;
    const refreshed: Observation = {
      ...fixture.contextObservation,
      id: `${fixture.contextObservation.id}-refreshed`,
      capturedAt: '2026-09-12T15:00:01.900Z',
      revision: current.revision,
    };
    await run.orchestrator.ingestObservations(snapshot.id, retarget([refreshed], snapshot));
    await run.orchestrator.ingestObservations(snapshot.id, retarget(fixture.turns, snapshot));
    await run.orchestrator.flush(snapshot.id);

    const intents = run.orchestrator.listIntents(snapshot.id, 50);
    const last = intents.at(-1);
    const observed = observedOutcomes(run, snapshot.id);
    const passed = fixture.acceptableOutcomes.some((outcome) => observed.has(outcome));
    return {
      id: fixture.id,
      expected: fixture.expected,
      kind: last?.proposal.kind ?? 'none',
      gate: last ? `${last.gateStatus}${last.gateReason ? ` (${last.gateReason.split(':')[0]})` : ''}` : 'not planned',
      observed: [...observed].join(', ') || 'nothing',
      passed,
      note: fixture.note,
    };
  } finally {
    run.orchestrator.dispose();
    run.store.close();
  }
}

function buildPlanner(options: Options): { planner: Planner; description: string } {
  if (options.planner === 'fixture') {
    return { planner: new FixturePlanner(scenarioPlannerTable()), description: 'FIXTURE (scripted replay, no model call)' };
  }
  const { provider, modelId } = resolvePlannerModel(process.env);
  return { planner: LlmPlanner.fromEnv(process.env, silentLogger), description: `LIVE ${provider}/${modelId}` };
}

function printTable(results: readonly Result[]): void {
  const width = (pick: (result: Result) => string, header: string): number =>
    Math.max(header.length, ...results.map((result) => pick(result).length));
  const columns: Array<[string, (result: Result) => string]> = [
    ['scenario', (result) => result.id],
    ['expected', (result) => result.expected],
    ['planner kind', (result) => result.kind],
    ['gate', (result) => result.gate],
    ['observed', (result) => result.observed],
    ['', (result) => (result.passed ? 'PASS' : 'FAIL')],
  ];
  const widths = columns.map(([header, pick]) => width(pick, header));
  const row = (cells: readonly string[]): string => cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join('  ');
  console.log(row(columns.map(([header]) => header)));
  console.log(widths.map((size) => '-'.repeat(size)).join('  '));
  for (const result of results) console.log(row(columns.map(([, pick]) => pick(result))));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const fixtures = loadScenarioFixtures().filter((fixture) => !options.only || fixture.id === options.only);
  if (fixtures.length === 0) throw new Error(`no scenario matched --only=${options.only}`);

  const { planner, description } = buildPlanner(options);
  console.log(`Planner: ${description}`);
  console.log('Engine:  FIXTURE (in-memory; no files are edited and no code is generated)');
  console.log('');

  const results: Result[] = [];
  for (const fixture of fixtures) results.push(await replay(fixture, planner));

  printTable(results);
  const passed = results.filter((result) => result.passed).length;
  console.log('');
  console.log(`${passed}/${results.length} scenarios reached an acceptable outcome.`);

  if (options.planner === 'fixture' && passed !== results.length) {
    console.error('Fixture replay is deterministic: a FAIL here is a real pipeline regression.');
    process.exit(1);
  }
  if (options.planner === 'live') {
    console.log('Live planner results vary between runs; this table is a report, not a pass/fail gate.');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
