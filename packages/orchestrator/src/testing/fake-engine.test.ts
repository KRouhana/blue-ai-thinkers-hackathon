import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrototypeJob } from '@fork/contracts';
import { FakePrototypeEngine } from './fake-engine';

const job = (id: string, expectedRevision = { source: 1, config: 0 }): PrototypeJob => ({
  id, experimentId: 'e', sessionId: 's', workspaceId: 'demo-1', intentId: 'i', expectedRevision,
  brief: 'Add an overdue-only toggle', relevantSources: [], constraints: [],
  mockedIntegrations: ['dates are synthetic'], mode: 'demo_only', verification: 'compile_and_render',
});

test('prepare returns a rendered workspace at revision {1,0} with a repo map that says FIXTURE', async () => {
  const engine = new FakePrototypeEngine();
  const prepared = await engine.prepare({ sessionId: 's', projectConfigId: 'demo-product', mode: 'existing_repo' });
  assert.deepEqual(prepared.revision, { source: 1, config: 0 });
  assert.equal(prepared.renderState, 'rendered');
  assert.match(prepared.repoMap.limitations.join(' '), /FIXTURE/);
});

test('applyPatch enforces expected revision and bumps config; undo restores via checkpoint', async () => {
  const engine = new FakePrototypeEngine();
  await engine.prepare({ sessionId: 's', projectConfigId: 'demo-product', mode: 'existing_repo' });
  const stale = await engine.applyPatch({
    operationId: 'op1', sessionId: 's', workspaceId: 'demo-1', expectedRevision: { source: 0, config: 0 },
    patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' },
  });
  assert.equal(stale.applied, false);
  const ok = await engine.applyPatch({
    operationId: 'op2', sessionId: 's', workspaceId: 'demo-1', expectedRevision: { source: 1, config: 0 },
    patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' },
  });
  assert.equal(ok.applied, true);
  assert.deepEqual(ok.revision, { source: 1, config: 1 });
  assert.ok(ok.checkpointId);
  const undone = await engine.undo({
    operationId: 'op3', workspaceId: 'demo-1', expectedRevision: { source: 1, config: 1 }, checkpointId: ok.checkpointId,
  });
  assert.equal(undone.applied, true);
  assert.deepEqual(undone.revision, { source: 1, config: 2 });
  assert.equal(engine.appliedPatches().length, 1);
});

test('undo refuses an unknown checkpoint or a moved revision', async () => {
  const engine = new FakePrototypeEngine();
  await engine.prepare({ sessionId: 's', projectConfigId: 'demo-product', mode: 'existing_repo' });
  const unknown = await engine.undo({ operationId: 'op', workspaceId: 'demo-1', expectedRevision: { source: 1, config: 0 }, checkpointId: 'nope' });
  assert.equal(unknown.applied, false);
  const moved = await engine.undo({ operationId: 'op', workspaceId: 'demo-1', expectedRevision: { source: 9, config: 9 }, checkpointId: 'nope' });
  assert.equal(moved.applied, false);
});

test('runJob reports progress, honours abort, and can be told to fail', async () => {
  const engine = new FakePrototypeEngine({ jobDelayMs: 5 });
  await engine.prepare({ sessionId: 's', projectConfigId: 'demo-product', mode: 'existing_repo' });
  const states: string[] = [];
  const ready = await engine.runJob(job('j1'), (progress) => { states.push(progress.state); });
  assert.equal(ready.state, 'ready');
  assert.deepEqual(ready.resultingRevision, { source: 2, config: 0 });
  assert.deepEqual(states, ['queued', 'running', 'checking', 'ready']);

  const controller = new AbortController();
  const pending = engine.runJob(job('j2', { source: 2, config: 0 }), () => {}, controller.signal);
  controller.abort();
  assert.equal((await pending).state, 'cancelled');

  engine.failNextJob('TypeError: overdue is not defined');
  const failed = await engine.runJob(job('j3', { source: 2, config: 0 }), () => {});
  assert.equal(failed.state, 'failed');
  assert.equal(failed.check.compile, 'failed');
  assert.deepEqual(engine.currentRevision(), { source: 2, config: 0 });
});

test('runJob reports superseded when the workspace moved past the job revision', async () => {
  const engine = new FakePrototypeEngine({ jobDelayMs: 1 });
  await engine.prepare({ sessionId: 's', projectConfigId: 'demo-product', mode: 'existing_repo' });
  const result = await engine.runJob(job('j4', { source: 0, config: 0 }), () => {});
  assert.equal(result.state, 'superseded');
  assert.deepEqual(engine.currentRevision(), { source: 1, config: 0 });
});

test('cancel accepts only a running job', async () => {
  const engine = new FakePrototypeEngine({ jobDelayMs: 20 });
  await engine.prepare({ sessionId: 's', projectConfigId: 'demo-product', mode: 'existing_repo' });
  assert.deepEqual(await engine.cancel('nobody'), { accepted: false });
  const pending = engine.runJob(job('j5'), () => {});
  const accepted = await engine.cancel('j5');
  assert.deepEqual(accepted, { accepted: true });
  assert.equal((await pending).state, 'cancelled');
});

test('elementsFor exposes the fixture route registry', () => {
  const engine = new FakePrototypeEngine();
  assert.deepEqual(engine.elementsFor('/signup').map((element) => element.id), ['start-trial', 'explore-sample']);
  assert.deepEqual(engine.elementsFor('/nope'), []);
});
