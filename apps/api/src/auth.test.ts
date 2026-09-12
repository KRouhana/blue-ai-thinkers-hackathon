import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authHeaders, bootApi, createSession, get, ORIGIN, post, TOKEN } from './testing/harness';

test('a request without a bearer token is refused', async () => {
  const harness = bootApi();
  const response = await harness.app.request('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 401);
  const body = (await response.json()) as { ok: boolean; error: { code: string } };
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'unauthorized');
  harness.close();
});

test('a wrong bearer token is refused', async () => {
  const harness = bootApi();
  const response = await post(harness.app, '/api/sessions', { projectConfigId: 'demo-product' }, {
    Authorization: 'Bearer not-the-token', 'Content-Type': 'application/json',
  });
  assert.equal(response.status, 401);
  harness.close();
});

test('an origin outside the allowlist is refused even with a valid token', async () => {
  const harness = bootApi();
  const refused = await post(harness.app, '/api/sessions', { projectConfigId: 'demo-product' }, authHeaders({ Origin: 'http://evil.example' }));
  assert.equal(refused.status, 403);
  assert.equal(((await refused.json()) as { error: { code: string } }).error.code, 'forbidden_origin');

  const allowed = await post(harness.app, '/api/sessions', { projectConfigId: 'demo-product' }, authHeaders({ Origin: ORIGIN }));
  assert.equal(allowed.status, 201);
  harness.close();
});

test('only the event stream accepts the query-parameter token fallback', async () => {
  const harness = bootApi();
  const sessionId = await createSession(harness.app);

  const stream = await harness.app.request(`/api/sessions/${sessionId}/events?access_token=${TOKEN}`);
  assert.equal(stream.status, 200);
  await stream.body?.cancel();

  const snapshot = await harness.app.request(`/api/sessions/${sessionId}?access_token=${TOKEN}`);
  assert.equal(snapshot.status, 401);
  harness.close();
});

test('the health check needs no token and names the wired planner and engine', async () => {
  const harness = bootApi();
  const response = await harness.app.request('/healthz');
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: { planner: string; engine: string } };
  assert.deepEqual(body.data, { planner: 'fixture', engine: 'FIXTURE' });
  harness.close();
});

test('an unknown route is a 404 envelope', async () => {
  const harness = bootApi();
  const response = await get(harness.app, '/api/nope');
  assert.equal(response.status, 404);
  harness.close();
});
