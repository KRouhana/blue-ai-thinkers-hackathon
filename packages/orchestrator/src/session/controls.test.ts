import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openSqliteStore } from '@fork/state';
import { fixedClock } from '../clock';
import { OrchestratorError } from '../errors';
import { silentLogger } from '../logger';
import { createOrchestrator, type Orchestrator } from '../orchestrator';
import { FakePrototypeEngine } from '../testing/fake-engine';
import { FixturePlanner } from '../testing/fixture-planner';

function boot(): { orchestrator: Orchestrator; close: () => void } {
  const store = openSqliteStore(':memory:');
  const orchestrator = createOrchestrator({
    store,
    engine: new FakePrototypeEngine({ jobDelayMs: 1 }),
    planner: new FixturePlanner(new Map()),
    projects: [{ id: 'demo-product', label: 'Fixture demo product', mode: 'existing_repo', workspaceRoot: null }],
    config: { settleMs: 1 },
    clock: fixedClock('2026-09-12T15:00:00.000Z'),
    logger: silentLogger,
  });
  return { orchestrator, close: () => { orchestrator.dispose(); store.close(); } };
}

const rejectsWith = (code: string, status: number) => (error: unknown): boolean =>
  error instanceof OrchestratorError && error.code === code && error.status === status;

test('controls on an unknown session are a 404, not a crash', async () => {
  const { orchestrator, close } = boot();
  await assert.rejects(orchestrator.applyControl('nope', { kind: 'pause' }), rejectsWith('session_not_found', 404));
  await assert.rejects(orchestrator.setCapture('nope', { action: 'start' }), rejectsWith('session_not_found', 404));
  assert.equal(orchestrator.getSnapshot('nope'), null);
  close();
});

test('pause and resume are rejected from the wrong state', async () => {
  const { orchestrator, close } = boot();
  const created = await orchestrator.createSession({ projectConfigId: 'demo-product' });
  const id = created.snapshot.id;

  await assert.rejects(orchestrator.applyControl(id, { kind: 'pause' }), rejectsWith('invalid_state', 409));
  await orchestrator.setCapture(id, { action: 'start', prototypeAutonomyEnabled: true });
  await assert.rejects(orchestrator.applyControl(id, { kind: 'resume' }), rejectsWith('invalid_state', 409));
  await orchestrator.applyControl(id, { kind: 'pause' });
  await assert.rejects(orchestrator.applyControl(id, { kind: 'pause' }), rejectsWith('invalid_state', 409));
  close();
});

test('undo, cancel_job, and clarification_answer validate their target', async () => {
  const { orchestrator, close } = boot();
  const created = await orchestrator.createSession({ projectConfigId: 'demo-product' });
  const id = created.snapshot.id;
  await orchestrator.setCapture(id, { action: 'start', prototypeAutonomyEnabled: true });

  await assert.rejects(orchestrator.applyControl(id, { kind: 'undo', experimentId: 'missing' }), rejectsWith('experiment_not_found', 404));
  await assert.rejects(orchestrator.applyControl(id, { kind: 'cancel_job', jobId: 'missing' }), rejectsWith('job_not_found', 404));
  await assert.rejects(
    orchestrator.applyControl(id, { kind: 'clarification_answer', intentId: 'missing', candidateId: 'x' }),
    rejectsWith('clarification_mismatch', 409),
  );
  close();
});

test('creating a session prepares a workspace, stores its map, and starts stopped', async () => {
  const { orchestrator, close } = boot();
  const created = await orchestrator.createSession({ projectConfigId: 'demo-product' });

  assert.equal(created.snapshot.capture, 'stopped');
  assert.equal(created.snapshot.prototypeAutonomyEnabled, false);
  assert.equal(created.snapshot.workspaceId, 'demo-1');
  assert.deepEqual(created.snapshot.revision, { source: 1, config: 0 });
  assert.match(created.repoMap.limitations.join(' '), /FIXTURE/);
  close();
});

test('autonomy is granted explicitly and cleared by stop', async () => {
  const { orchestrator, close } = boot();
  const created = await orchestrator.createSession({ projectConfigId: 'demo-product' });
  const id = created.snapshot.id;

  const listening = await orchestrator.setCapture(id, { action: 'start' });
  assert.equal(listening.capture, 'listening');
  assert.equal(listening.prototypeAutonomyEnabled, false, 'autonomy is never implied by starting capture');

  const granted = await orchestrator.setCapture(id, { action: 'start', prototypeAutonomyEnabled: true });
  assert.equal(granted.prototypeAutonomyEnabled, true);

  const stopped = await orchestrator.setCapture(id, { action: 'stop' });
  assert.equal(stopped.capture, 'stopped');
  assert.equal(stopped.prototypeAutonomyEnabled, false);
  close();
});
