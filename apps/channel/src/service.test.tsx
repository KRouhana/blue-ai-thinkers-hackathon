import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionSnapshot } from '../../../contracts.v2';
import { FileBindings } from './bindings';
import { createService, parseCommand } from './service';
import { createSessionApi } from './api';

const snapshot: SessionSnapshot = { id: 's1', captureEpoch: 'e1', capture: 'stopped', prototypeAutonomyEnabled: false, workspaceId: null, revision: { source: 0, config: 0 }, previewUrl: null, currentTopic: null, lastEventSequence: 0, experiments: [], clarification: null };

test('commands are explicit and ordinary discussion never starts a session', () => {
  assert.equal(parseCommand('<@U123> start'), 'start');
  assert.equal(parseCommand('Fork STATUS'), 'status');
  assert.equal(parseCommand('start a new database and stop monitoring'), 'help');
});

test('one session per thread survives reload; host checks happen before mutations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fork-channel-'));
  try {
    let creates = 0; const controls: string[] = [];
    const api = { create: async () => { creates++; return snapshot; }, snapshot: async () => snapshot, control: async (_id: string, input: { kind: string }) => { controls.push(input.kind); } };
    const path = join(directory, 'bindings.json');
    const service = createService(api, new FileBindings(path), new Set(['host', 'other-host']));
    await assert.rejects(service.run('thread', 'attendee', 'start'), /configured Slack host/);
    assert.equal(creates, 0);
    await Promise.all([service.run('thread', 'host', 'start'), service.run('thread', 'host', 'start')]);
    assert.equal(creates, 1);
    const reloaded = createService(api, new FileBindings(path), new Set(['host', 'other-host']));
    await reloaded.run('thread', 'host', 'open');
    assert.equal(creates, 1);
    await assert.rejects(reloaded.run('thread', 'other-host', 'stop'), /session’s configured host/);
    assert.deepEqual(controls, []);
    const stopped = await reloaded.run('thread', 'host', 'stop');
    assert.equal(stopped.kind, 'session');
    if (stopped.kind === 'session') assert.equal(stopped.recap, true);
    assert.deepEqual(controls, ['stop']);
    await writeFile(path, 'invalid-json');
    await assert.rejects(reloaded.run('thread', 'host', 'start'), /mapping cannot be read/);
    assert.equal(creates, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('API adapter authenticates server-side and does not forward remote errors or redirects', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = createSessionApi('http://127.0.0.1:8787', 'private-token', 'demo', async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json(snapshot);
  });
  await client.create();
  assert.equal(requests[0]?.url, 'http://127.0.0.1:8787/api/sessions');
  assert.equal((requests[0]?.init?.headers as Record<string, string>).Authorization, 'Bearer private-token');
  assert.equal(requests[0]?.init?.redirect, 'error');
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), { projectConfigId: 'demo', mode: 'existing_repo' });
  let blankBody: unknown;
  const blank = createSessionApi('http://127.0.0.1:8787', 'private-token', 'empty-demo', async (_url, init) => {
    blankBody = JSON.parse(String(init?.body));
    return Response.json(snapshot);
  }, 'blank_template');
  await blank.create();
  assert.deepEqual(blankBody, { projectConfigId: 'empty-demo', mode: 'blank_template' });
  const broken = createSessionApi('http://127.0.0.1:8787', 'private-token', 'demo', async () => new Response('secret-stack-trace', { status: 500 }));
  await assert.rejects(broken.create(), error => error instanceof Error && error.message.includes('HTTP 500') && !error.message.includes('secret'));
  const wrong = createSessionApi('http://127.0.0.1:8787', 'private-token', 'demo', async () => Response.json(snapshot));
  await assert.rejects(wrong.snapshot('another-session'), /different session/);
});
