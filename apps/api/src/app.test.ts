import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Observation, SessionSnapshot } from '@fork/contracts';
import { loadScenarioFixtures, retargetObservation } from '@fork/orchestrator/testing';
import { authHeaders, bootApi, createSession, get, post } from './testing/harness';

const FIXTURES = new Map(loadScenarioFixtures().map((fixture) => [fixture.id, fixture]));
const scenario = (id: string) => {
  const found = FIXTURES.get(id);
  if (!found) throw new Error(`unknown fixture ${id}`);
  return found;
};

const dataOf = async <T>(response: Response): Promise<T> => ((await response.json()) as { data: T }).data;
const errorOf = async (response: Response) => ((await response.json()) as { ok: false; error: { code: string; message: string; issues?: Array<{ path: string }> } }).error;

async function startCapture(app: Parameters<typeof post>[0], sessionId: string): Promise<SessionSnapshot> {
  const response = await post(app, `/api/sessions/${sessionId}/capture`, { action: 'start', prototypeAutonomyEnabled: true });
  assert.equal(response.status, 200);
  return (await dataOf<{ snapshot: SessionSnapshot }>(response)).snapshot;
}

const retarget = (observations: readonly Observation[], snapshot: SessionSnapshot): Observation[] =>
  observations.map((observation) => retargetObservation(observation, snapshot.id, snapshot.captureEpoch));

test('creating a session returns the snapshot and the prepared repo map', async () => {
  const harness = bootApi();
  const response = await post(harness.app, '/api/sessions', { projectConfigId: 'demo-product' });
  assert.equal(response.status, 201);
  const data = await dataOf<{ snapshot: SessionSnapshot; repoMap: { limitations: string[] } }>(response);
  assert.equal(data.snapshot.capture, 'stopped');
  assert.equal(data.snapshot.prototypeAutonomyEnabled, false);
  assert.match(data.repoMap.limitations.join(' '), /FIXTURE/);
  harness.close();
});

test('a project outside the server allowlist is refused with its own code', async () => {
  const harness = bootApi();
  const response = await post(harness.app, '/api/sessions', { projectConfigId: '/Users/someone/secrets' });
  assert.equal(response.status, 403);
  assert.equal((await errorOf(response)).code, 'project_not_allowed');
  harness.close();
});

test('a malformed body is a 400 that names the offending field', async () => {
  const harness = bootApi();
  const sessionId = await createSession(harness.app);
  const missing = await post(harness.app, '/api/sessions', {});
  assert.equal(missing.status, 400);
  const error = await errorOf(missing);
  assert.equal(error.code, 'validation_failed');
  assert.ok((error.issues ?? []).some((issue) => issue.path === 'projectConfigId'));

  const badAction = await post(harness.app, `/api/sessions/${sessionId}/capture`, { action: 'resume' });
  assert.equal(badAction.status, 400);
  assert.ok(((await errorOf(badAction)).issues ?? []).some((issue) => issue.path === 'action'));

  const notJson = await harness.app.request(`/api/sessions/${sessionId}/capture`, { method: 'POST', headers: authHeaders(), body: 'not json' });
  assert.equal(notJson.status, 400);
  harness.close();
});

test('capture start grants autonomy explicitly and stop clears it', async () => {
  const harness = bootApi();
  const sessionId = await createSession(harness.app);
  const listening = await startCapture(harness.app, sessionId);
  assert.equal(listening.capture, 'listening');
  assert.equal(listening.prototypeAutonomyEnabled, true);

  const stopped = await post(harness.app, `/api/sessions/${sessionId}/capture`, { action: 'stop' });
  const snapshot = (await dataOf<{ snapshot: SessionSnapshot }>(stopped)).snapshot;
  assert.equal(snapshot.capture, 'stopped');
  assert.equal(snapshot.prototypeAutonomyEnabled, false);
  harness.close();
});

test('observations are accepted in one batch and reported honestly', async () => {
  const harness = bootApi();
  const sessionId = await createSession(harness.app);
  const snapshot = await startCapture(harness.app, sessionId);
  const fixture = scenario('suggestion');

  const accepted = await post(harness.app, `/api/sessions/${sessionId}/observations`, {
    observations: retarget([fixture.contextObservation, ...fixture.turns], snapshot),
  });
  assert.equal(accepted.status, 202);
  const report = await dataOf<{ accepted: number; duplicates: string[] }>(accepted);
  assert.equal(report.accepted, 3);

  const repeated = await post(harness.app, `/api/sessions/${sessionId}/observations`, {
    observations: retarget(fixture.turns, snapshot),
  });
  assert.equal((await dataOf<{ duplicates: string[] }>(repeated)).duplicates.length, fixture.turns.length);
  harness.close();
});

test('observations addressed to another session are refused', async () => {
  const harness = bootApi();
  const sessionId = await createSession(harness.app);
  const snapshot = await startCapture(harness.app, sessionId);
  const fixture = scenario('suggestion');
  const foreign = retarget(fixture.turns, { ...snapshot, id: 'someone-elses-session' });

  const response = await post(harness.app, `/api/sessions/${sessionId}/observations`, { observations: foreign });
  assert.equal(response.status, 400);
  assert.match((await errorOf(response)).message, /belong to another session/);
  harness.close();
});

test('an empty or oversized batch is refused', async () => {
  const harness = bootApi();
  const sessionId = await createSession(harness.app);
  assert.equal((await post(harness.app, `/api/sessions/${sessionId}/observations`, { observations: [] })).status, 400);
  harness.close();
});

test('the snapshot route returns state plus the ordered event log', async () => {
  const harness = bootApi();
  const sessionId = await createSession(harness.app);
  const snapshot = await startCapture(harness.app, sessionId);
  const fixture = scenario('suggestion');
  await post(harness.app, `/api/sessions/${sessionId}/observations`, { observations: retarget([fixture.contextObservation, ...fixture.turns], snapshot) });
  await harness.orchestrator.flush(sessionId);

  const response = await get(harness.app, `/api/sessions/${sessionId}`);
  assert.equal(response.status, 200);
  const data = await dataOf<{ snapshot: SessionSnapshot; events: Array<{ sequence: number }> }>(response);
  assert.deepEqual(data.snapshot.revision, { source: 1, config: 1 });
  assert.equal(data.snapshot.experiments.filter((experiment) => experiment.status === 'visible').length, 1);
  assert.deepEqual(data.events.map((event) => event.sequence), [...data.events].map((event) => event.sequence).sort((a, b) => a - b));

  assert.equal((await get(harness.app, '/api/sessions/unknown-session')).status, 404);
  harness.close();
});

test('host controls pause, undo, and reject unknown targets', async () => {
  const harness = bootApi();
  const sessionId = await createSession(harness.app);
  await startCapture(harness.app, sessionId);

  const paused = await post(harness.app, `/api/sessions/${sessionId}/controls`, { kind: 'pause' });
  assert.equal((await dataOf<{ snapshot: SessionSnapshot }>(paused)).snapshot.capture, 'paused');

  const unknownExperiment = await post(harness.app, `/api/sessions/${sessionId}/controls`, { kind: 'undo', experimentId: 'nope' });
  assert.equal(unknownExperiment.status, 404);
  assert.equal((await errorOf(unknownExperiment)).code, 'experiment_not_found');

  const unknownJob = await post(harness.app, `/api/sessions/${sessionId}/controls`, { kind: 'cancel_job', jobId: 'nope' });
  assert.equal(unknownJob.status, 404);

  const unsupported = await post(harness.app, `/api/sessions/${sessionId}/controls`, { kind: 'deploy' });
  assert.equal(unsupported.status, 400);
  harness.close();
});

test('a job can be read back by id once a structural change has run', async () => {
  const harness = bootApi();
  const sessionId = await createSession(harness.app);
  const snapshot = await startCapture(harness.app, sessionId);
  const fixture = scenario('structural');
  await post(harness.app, `/api/sessions/${sessionId}/observations`, { observations: retarget([fixture.contextObservation, ...fixture.turns], snapshot) });
  await harness.orchestrator.flush(sessionId);

  assert.equal((await get(harness.app, '/api/jobs/nope')).status, 404);
  const events = await dataOf<{ events: Array<{ payload: { kind: string; progress?: { jobId: string } } }> }>(await get(harness.app, `/api/sessions/${sessionId}`));
  const jobId = events.events.flatMap((event) => (event.payload.kind === 'job' ? [event.payload.progress!.jobId] : []))[0];
  assert.ok(jobId, 'expected a job progress event');

  const job = await get(harness.app, `/api/jobs/${jobId}`);
  assert.equal(job.status, 200);
  const data = await dataOf<{ id: string; state: string; sessionId: string; result: { check: { compile: string } } }>(job);
  assert.equal(data.state, 'ready');
  assert.equal(data.sessionId, sessionId);
  assert.equal(data.result.check.compile, 'passed');
  harness.close();
});

test('transcription negotiation reports that Track A is not wired, and is rate limited', async () => {
  const harness = bootApi();
  const sessionId = await createSession(harness.app);
  await startCapture(harness.app, sessionId);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await post(harness.app, `/api/sessions/${sessionId}/transcription-connection`, {});
    assert.equal(response.status, 503, `attempt ${attempt} should report the missing connector`);
    assert.equal((await errorOf(response)).code, 'transcription_unconfigured');
  }
  const limited = await post(harness.app, `/api/sessions/${sessionId}/transcription-connection`, {});
  assert.equal(limited.status, 429);
  assert.equal((await errorOf(limited)).code, 'rate_limited');
  harness.close();
});

test('negotiation is refused while capture is stopped', async () => {
  const harness = bootApi();
  const sessionId = await createSession(harness.app);
  const response = await post(harness.app, `/api/sessions/${sessionId}/transcription-connection`, {});
  assert.equal(response.status, 409);
  harness.close();
});

test('a live connector returns only a short-lived credential', async () => {
  const harness = bootApi({
    transcription: {
      label: 'live',
      negotiate: async () => ({ kind: 'client_secret', value: 'ephemeral-secret', expiresAt: '2026-09-12T15:01:00.000Z' }),
    },
  });
  const sessionId = await createSession(harness.app);
  await startCapture(harness.app, sessionId);
  const response = await post(harness.app, `/api/sessions/${sessionId}/transcription-connection`, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await dataOf(response), { kind: 'client_secret', value: 'ephemeral-secret', expiresAt: '2026-09-12T15:01:00.000Z' });
  harness.close();
});

test('an unexpected failure is a 500 envelope with no stack trace', async () => {
  const harness = bootApi();
  const broken = {
    ...harness.orchestrator,
    getSnapshot: () => { throw new Error('disk on fire at /Users/secret/path'); },
  };
  const withBroken = bootApi({ orchestrator: broken });
  const response = await get(withBroken.app, '/api/sessions/whatever');
  assert.equal(response.status, 500);
  const error = await errorOf(response);
  assert.equal(error.code, 'internal_error');
  assert.doesNotMatch(error.message, /disk on fire|Users/);
  withBroken.close();
  harness.close();
});
