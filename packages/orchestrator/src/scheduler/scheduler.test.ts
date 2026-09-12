import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  OutputPayload, PatchRequest, PatchResult, PrepareRequest, PreparedWorkspace, PrototypeEngine, PrototypeJob,
  PrototypeResult, Revision, SessionSnapshot, WorkerProgress,
} from '@fork/contracts';
import { openSqliteStore, type SessionRecord, type StateStore, type StoredExperiment } from '@fork/state';
import { fixedClock } from '../clock';
import { DEFAULT_CONFIG } from '../config';
import { EventBus } from '../events/event-bus';
import { silentLogger } from '../logger';
import { Scheduler } from './scheduler';
import type { WorkItem } from './types';

const T0 = '2026-09-12T15:00:00.000Z';
const SESSION_ID = 's';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((inner) => { resolve = inner; });
  return { promise, resolve };
}

const same = (a: Revision, b: Revision): boolean => a.source === b.source && a.config === b.config;

/** Test engine whose jobs finish only when the test says so, so queue behaviour is deterministic. */
class GatedEngine implements PrototypeEngine {
  readonly label = 'FIXTURE' as const;
  revision: Revision = { source: 1, config: 0 };
  readonly patchRequests: PatchRequest[] = [];
  readonly started: Array<{ job: PrototypeJob; gate: Deferred<PrototypeResult> }> = [];
  readonly cancelled: string[] = [];
  undoApplied = 0;

  async prepare(_request: PrepareRequest): Promise<PreparedWorkspace> {
    throw new Error('prepare is not used by the scheduler');
  }

  async applyPatch(request: PatchRequest): Promise<PatchResult> {
    this.patchRequests.push(request);
    if (!same(request.expectedRevision, this.revision)) {
      return { operationId: request.operationId, applied: false, revision: this.revision, checkpointId: null, diagnostic: 'revision mismatch' };
    }
    this.revision = { ...this.revision, config: this.revision.config + 1 };
    return { operationId: request.operationId, applied: true, revision: this.revision, checkpointId: `chk-${this.patchRequests.length}` };
  }

  async undo(request: { operationId: string; workspaceId: string; expectedRevision: Revision; checkpointId: string }): Promise<PatchResult> {
    if (!same(request.expectedRevision, this.revision)) {
      return { operationId: request.operationId, applied: false, revision: this.revision, checkpointId: null, diagnostic: 'revision mismatch' };
    }
    this.undoApplied += 1;
    this.revision = { ...this.revision, config: this.revision.config + 1 };
    return { operationId: request.operationId, applied: true, revision: this.revision, checkpointId: `undo-${this.undoApplied}` };
  }

  async runJob(job: PrototypeJob, progress: (event: WorkerProgress) => void, signal?: AbortSignal): Promise<PrototypeResult> {
    const gate = deferred<PrototypeResult>();
    this.started.push({ job, gate });
    progress({ jobId: job.id, state: 'running', message: 'running' });
    signal?.addEventListener('abort', () => {
      this.recordCancel(job.id);
      gate.resolve(this.result(job, 'cancelled'));
    }, { once: true });
    return gate.promise;
  }

  async cancel(jobId: string): Promise<{ accepted: boolean }> {
    const entry = this.started.find(({ job }) => job.id === jobId);
    if (!entry) return { accepted: false };
    this.recordCancel(jobId);
    entry.gate.resolve(this.result(entry.job, 'cancelled'));
    return { accepted: true };
  }

  /** Abort signal and explicit cancel both arrive for one stop; count the job once. */
  private recordCancel(jobId: string): void {
    if (!this.cancelled.includes(jobId)) this.cancelled.push(jobId);
  }

  finish(jobId: string, state: PrototypeResult['state'], diagnostics: string[] = []): void {
    const entry = this.started.find(({ job }) => job.id === jobId);
    if (!entry) throw new Error(`job ${jobId} was never started`);
    if (state === 'ready') this.revision = { source: this.revision.source + 1, config: this.revision.config };
    entry.gate.resolve(this.result(entry.job, state, diagnostics));
  }

  private result(job: PrototypeJob, state: PrototypeResult['state'], diagnostics: string[] = []): PrototypeResult {
    return {
      jobId: job.id, workspaceId: 'demo-1', state, basedOn: job.expectedRevision, resultingRevision: this.revision,
      checkpointId: state === 'ready' ? `job-chk-${job.id}` : null, previewUrl: 'http://localhost:4173',
      changedFiles: state === 'ready' ? ['src/pages/Tasks.tsx'] : [], mockNotes: job.mockedIntegrations,
      check: state === 'ready'
        ? { compile: 'passed', page: 'rendered', diagnostics: [] }
        : { compile: state === 'failed' ? 'failed' : 'not_checked', page: 'not_checked', diagnostics },
    };
  }
}

const session = (revision: Revision = { source: 1, config: 0 }): SessionRecord => ({
  id: SESSION_ID, projectConfigId: 'demo-product', captureEpoch: 'cap', capture: 'listening', prototypeAutonomyEnabled: true,
  workspaceId: 'demo-1', revision, previewUrl: 'http://localhost:4173', currentTopic: null, clarification: null,
  resumedAt: null, createdAt: T0, updatedAt: T0,
});

function seedExperiment(store: StateStore, id: string, targetKey: string, summary: string): StoredExperiment {
  store.insertIntent(SESSION_ID, {
    proposal: { id: `int-${id}`, sessionId: SESSION_ID, captureEpoch: 'cap', sourceObservationIds: ['t1'],
      expectedRevision: { source: 1, config: 0 }, summary, kind: 'observe', reason: 'seed' },
    gateStatus: 'allowed', gateReason: null, dedupeKey: null, pendingPatch: null, createdAt: T0,
  });
  return store.insertExperiment({
    id, sessionId: SESSION_ID, intentId: `int-${id}`, status: 'proposed', summary, origin: 'inferred_experiment',
    sourceObservationIds: ['t1'], revision: { source: 1, config: 0 }, checkpointId: null, mockNotes: [],
    targetKey, createdAt: T0, updatedAt: T0,
  });
}

function boot(revision: Revision = { source: 1, config: 0 }) {
  const store = openSqliteStore(':memory:');
  store.createSession(session(revision));
  const clock = fixedClock(T0);
  const bus = new EventBus(store, clock, silentLogger);
  const engine = new GatedEngine();
  engine.revision = revision;
  const payloads: OutputPayload[] = [];
  bus.subscribe(SESSION_ID, (event) => { payloads.push(event.payload); });
  const snapshotOf = (id: string): SessionSnapshot => {
    const current = store.getSession(id)!;
    return { id, captureEpoch: current.captureEpoch, capture: current.capture, prototypeAutonomyEnabled: true,
      workspaceId: current.workspaceId, revision: current.revision, previewUrl: current.previewUrl, currentTopic: null,
      lastEventSequence: store.lastEventSequence(id), experiments: [], clarification: null };
  };
  const scheduler = new Scheduler({ store, bus, engine, clock, config: DEFAULT_CONFIG, logger: silentLogger, snapshotOf });
  return { store, engine, scheduler, payloads };
}

const patchItem = (experimentId: string, elementId: string, value: 'sm' | 'md' | 'lg' | 'xl', expectedRevision: Revision): WorkItem => ({
  kind: 'patch', sessionId: SESSION_ID, intentId: `int-${experimentId}`, experimentId, targetKey: `element:${elementId}`,
  patch: { kind: 'set_size', elementId, value }, expectedRevision,
});

const jobItem = (experimentId: string, jobId: string, expectedRevision: Revision): WorkItem => ({
  kind: 'job', sessionId: SESSION_ID, intentId: `int-${experimentId}`, experimentId, targetKey: 'job:demo-1',
  job: { id: jobId, experimentId, sessionId: SESSION_ID, workspaceId: 'demo-1', intentId: `int-${experimentId}`,
    expectedRevision, brief: 'Add an overdue filter', relevantSources: [], constraints: [],
    mockedIntegrations: ['synthetic dates'], mode: 'demo_only', verification: 'compile_and_render' },
});

const statuses = (payloads: readonly OutputPayload[]): string[] =>
  payloads.filter((payload) => payload.kind === 'status').map((payload) => (payload.kind === 'status' ? payload.message : ''));

const experimentStates = (payloads: readonly OutputPayload[]): string[] =>
  payloads.filter((payload) => payload.kind === 'experiment').map((payload) => (payload.kind === 'experiment' ? payload.experiment.status : ''));

test('patch applies, bumps the session revision, and announces an undoable experiment', async () => {
  const { store, engine, scheduler, payloads } = boot();
  seedExperiment(store, 'e1', 'element:start-trial', 'Trying a larger Start trial button');
  scheduler.enqueue(patchItem('e1', 'start-trial', 'lg', { source: 1, config: 0 }));
  await scheduler.idle(SESSION_ID);

  assert.deepEqual(store.getSession(SESSION_ID)?.revision, { source: 1, config: 1 });
  assert.equal(store.getExperiment('e1')?.status, 'visible');
  assert.equal(store.getExperiment('e1')?.checkpointId, 'chk-1');
  assert.deepEqual(experimentStates(payloads), ['applying', 'visible']);
  assert.deepEqual(statuses(payloads), ['Trying a larger Start trial button — Undo']);
  assert.equal(payloads.at(-1)?.kind, 'snapshot');
  assert.equal(engine.patchRequests.length, 1);
  store.close();
});

test('patch planned against a stale revision fails without calling the engine', async () => {
  const { store, engine, scheduler, payloads } = boot();
  seedExperiment(store, 'e1', 'element:start-trial', 'Trying a larger Start trial button');
  scheduler.enqueue(patchItem('e1', 'start-trial', 'lg', { source: 0, config: 0 }));
  await scheduler.idle(SESSION_ID);

  assert.equal(engine.patchRequests.length, 0);
  assert.equal(store.getExperiment('e1')?.status, 'failed');
  assert.deepEqual(store.getSession(SESSION_ID)?.revision, { source: 1, config: 0 });
  assert.match(statuses(payloads).join(' '), /Could not apply: preview changed/);
  store.close();
});

test('two queued patches on the same element coalesce: the older is superseded, only the newer applies', async () => {
  const { store, engine, scheduler, payloads } = boot();
  seedExperiment(store, 'job1', 'job:demo-1', 'Prototyping: filter');
  seedExperiment(store, 'e1', 'element:start-trial', 'Trying a larger Start trial button');
  seedExperiment(store, 'e2', 'element:start-trial', 'Trying a smaller Start trial button');

  scheduler.enqueue(jobItem('job1', 'j1', { source: 1, config: 0 }));
  scheduler.enqueue(patchItem('e1', 'start-trial', 'lg', { source: 1, config: 0 }));
  scheduler.enqueue(patchItem('e2', 'start-trial', 'md', { source: 1, config: 0 }));
  assert.equal(store.getExperiment('e1')?.status, 'superseded');

  engine.finish('j1', 'superseded');
  await scheduler.idle(SESSION_ID);

  assert.equal(engine.patchRequests.length, 1);
  assert.equal(engine.patchRequests[0]?.patch.kind === 'set_size' ? engine.patchRequests[0]?.patch.value : '', 'md');
  assert.equal(store.getExperiment('e2')?.status, 'visible');
  assert.match(statuses(payloads).join(' | '), /Trying a smaller Start trial button — Undo/);
  store.close();
});

test('a newer request on the same target cancels the running job and its late result is discarded', async () => {
  const { store, engine, scheduler, payloads } = boot();
  seedExperiment(store, 'job1', 'job:demo-1', 'Prototyping: overdue filter');
  seedExperiment(store, 'job2', 'job:demo-1', 'Prototyping: owner filter');

  scheduler.enqueue(jobItem('job1', 'j1', { source: 1, config: 0 }));
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.equal(engine.started.length, 1);

  scheduler.enqueue(jobItem('job2', 'j2', { source: 1, config: 0 }));
  engine.finish('j1', 'ready'); // late result for a superseded intent
  engine.revision = { source: 1, config: 0 }; // the fixture engine rolled back its own bump
  await new Promise((resolve) => { setImmediate(resolve); });
  engine.finish('j2', 'ready');
  await scheduler.idle(SESSION_ID);

  assert.equal(store.getExperiment('job1')?.status, 'superseded');
  assert.equal(store.getExperiment('job2')?.status, 'visible');
  assert.equal(store.getJob('j1')?.state, 'superseded');
  assert.equal(store.getJob('j2')?.state, 'ready');
  assert.deepEqual(store.getSession(SESSION_ID)?.revision, { source: 2, config: 0 });
  assert.match(statuses(payloads).join(' | '), /Discarded a late result/);
  store.close();
});

test('a failed job leaves the revision alone and reports the diagnostic', async () => {
  const { store, engine, scheduler, payloads } = boot();
  seedExperiment(store, 'job1', 'job:demo-1', 'Prototyping: overdue filter');
  scheduler.enqueue(jobItem('job1', 'j1', { source: 1, config: 0 }));
  await new Promise((resolve) => { setImmediate(resolve); });
  engine.finish('j1', 'failed', ['TypeError: overdue is not defined']);
  await scheduler.idle(SESSION_ID);

  assert.equal(store.getExperiment('job1')?.status, 'failed');
  assert.equal(store.getJob('j1')?.state, 'failed');
  assert.deepEqual(store.getSession(SESSION_ID)?.revision, { source: 1, config: 0 });
  assert.match(statuses(payloads).join(' '), /Could not apply: TypeError: overdue is not defined/);
  store.close();
});

test('job progress is persisted and streamed', async () => {
  const { store, engine, scheduler, payloads } = boot();
  seedExperiment(store, 'job1', 'job:demo-1', 'Prototyping: overdue filter');
  scheduler.enqueue(jobItem('job1', 'j1', { source: 1, config: 0 }));
  await new Promise((resolve) => { setImmediate(resolve); });
  engine.finish('j1', 'ready');
  await scheduler.idle(SESSION_ID);

  const jobStates = payloads.filter((payload) => payload.kind === 'job').map((payload) => (payload.kind === 'job' ? payload.progress.state : ''));
  assert.deepEqual(jobStates, ['queued', 'running', 'ready']);
  store.close();
});

test('undo reverts a visible experiment and bumps the config revision', async () => {
  const { store, engine, scheduler, payloads } = boot();
  seedExperiment(store, 'e1', 'element:start-trial', 'Trying a larger Start trial button');
  store.updateExperiment('e1', { status: 'visible', checkpointId: 'chk-1', revision: { source: 1, config: 1 } }, T0);
  store.updateSession(SESSION_ID, { revision: { source: 1, config: 1 } }, T0);
  engine.revision = { source: 1, config: 1 };

  scheduler.enqueue({ kind: 'undo', sessionId: SESSION_ID, intentId: null, experimentId: 'e1', targetKey: 'element:start-trial', origin: 'host_control' });
  await scheduler.idle(SESSION_ID);

  assert.equal(engine.undoApplied, 1);
  assert.equal(store.getExperiment('e1')?.status, 'reverted');
  assert.deepEqual(store.getSession(SESSION_ID)?.revision, { source: 1, config: 2 });
  assert.match(statuses(payloads).join(' '), /Reverted: Trying a larger Start trial button/);
  store.close();
});

test('undo of a non-visible experiment changes nothing', async () => {
  const { store, engine, scheduler, payloads } = boot();
  seedExperiment(store, 'e1', 'element:start-trial', 'Trying a larger Start trial button');
  scheduler.enqueue({ kind: 'undo', sessionId: SESSION_ID, intentId: null, experimentId: 'e1', targetKey: 'element:start-trial', origin: 'host_control' });
  await scheduler.idle(SESSION_ID);

  assert.equal(engine.undoApplied, 0);
  assert.equal(store.getExperiment('e1')?.status, 'proposed');
  assert.match(statuses(payloads).join(' '), /Nothing to undo/);
  store.close();
});

test('cancelJob stops the active job and reports whether it was accepted', async () => {
  const { store, engine, scheduler } = boot();
  seedExperiment(store, 'job1', 'job:demo-1', 'Prototyping: overdue filter');
  scheduler.enqueue(jobItem('job1', 'j1', { source: 1, config: 0 }));
  await new Promise((resolve) => { setImmediate(resolve); });

  assert.equal(await scheduler.cancelJob(SESSION_ID, 'nope'), false);
  assert.equal(await scheduler.cancelJob(SESSION_ID, 'j1'), true);
  await scheduler.idle(SESSION_ID);
  assert.deepEqual(engine.cancelled, ['j1']);
  assert.equal(store.getJob('j1')?.state, 'cancelled');
  assert.equal(store.getExperiment('job1')?.status, 'superseded');
  store.close();
});

test('cancelAll aborts the active job and supersedes queued work', async () => {
  const { store, engine, scheduler } = boot();
  seedExperiment(store, 'job1', 'job:demo-1', 'Prototyping: overdue filter');
  seedExperiment(store, 'e1', 'element:start-trial', 'Trying a larger Start trial button');
  scheduler.enqueue(jobItem('job1', 'j1', { source: 1, config: 0 }));
  await new Promise((resolve) => { setImmediate(resolve); });
  scheduler.enqueue(patchItem('e1', 'start-trial', 'lg', { source: 1, config: 0 }));

  await scheduler.cancelAll(SESSION_ID);
  await scheduler.idle(SESSION_ID);

  assert.deepEqual(engine.cancelled, ['j1']);
  assert.equal(store.getExperiment('e1')?.status, 'superseded');
  assert.equal(engine.patchRequests.length, 0);
  store.close();
});

test('idle resolves immediately when nothing is queued', async () => {
  const { store, scheduler } = boot();
  await scheduler.idle(SESSION_ID);
  store.close();
});
