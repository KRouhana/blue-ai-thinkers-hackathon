import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Observation, SessionSnapshot } from '@fork/contracts';
import { loadScenarioFixtures, retargetObservation } from '@fork/orchestrator/testing';
import { bootApi, createSession, post, TOKEN } from '../testing/harness';

const suggestion = loadScenarioFixtures().find((fixture) => fixture.id === 'suggestion')!;

interface Frame {
  event: string;
  id: string | null;
  data: string;
}

/** Reads SSE frames until `wanted` are collected or the read budget runs out, then cancels. */
async function readFrames(response: Response, wanted: number, budgetMs = 2000): Promise<Frame[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buffer = '';
  const deadline = Date.now() + budgetMs;

  while (frames.length < wanted && Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) => { setTimeout(() => resolve({ done: true, value: undefined }), deadline - Date.now()); }),
    ]);
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const lines = block.split('\n');
      const field = (name: string): string | null => lines.find((line) => line.startsWith(`${name}:`))?.slice(name.length + 1).trim() ?? null;
      const event = field('event');
      if (event === 'keepalive' || event === null) continue;
      frames.push({ event, id: field('id'), data: field('data') ?? '' });
    }
  }
  await reader.cancel();
  return frames;
}

test('the stream opens with the current snapshot before any replay', async () => {
  const harness = bootApi();
  const sessionId = await createSession(harness.app);
  const response = await harness.app.request(`/api/sessions/${sessionId}/events?access_token=${TOKEN}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);

  const frames = await readFrames(response, 1);
  assert.equal(frames[0]?.event, 'snapshot');
  assert.equal(frames[0]?.id, null, 'the opening snapshot must not move the client cursor');
  const payload = JSON.parse(frames[0]!.data) as { kind: string; snapshot: SessionSnapshot };
  assert.equal(payload.snapshot.id, sessionId);
  harness.close();
});

test('past events replay after the snapshot and live events keep arriving', async () => {
  const harness = bootApi();
  const sessionId = await createSession(harness.app);
  const started = await post(harness.app, `/api/sessions/${sessionId}/capture`, { action: 'start', prototypeAutonomyEnabled: true });
  const snapshot = ((await started.json()) as { data: { snapshot: SessionSnapshot } }).data.snapshot;

  const response = await harness.app.request(`/api/sessions/${sessionId}/events?access_token=${TOKEN}&after=0`);
  const observations: Observation[] = [suggestion.contextObservation, ...suggestion.turns]
    .map((observation) => retargetObservation(observation, sessionId, snapshot.captureEpoch));
  await post(harness.app, `/api/sessions/${sessionId}/observations`, { observations });
  await harness.orchestrator.flush(sessionId);

  // snapshot frame, then: session snapshots, experiment proposed/applying/visible, the Undo status.
  const frames = await readFrames(response, 8);
  assert.equal(frames[0]?.event, 'snapshot');
  const live = frames.slice(1);
  assert.ok(live.length >= 5, `expected replayed and live events, saw ${live.length}`);
  assert.ok(live.every((frame) => frame.id !== null), 'every persisted event carries its sequence as the SSE id');
  const sequences = live.map((frame) => Number(frame.id));
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
  assert.ok(live.some((frame) => frame.event === 'experiment'));
  assert.ok(live.some((frame) => frame.event === 'status'));
  harness.close();
});

test('Last-Event-ID resumes after the given sequence', async () => {
  const harness = bootApi();
  const sessionId = await createSession(harness.app);
  await post(harness.app, `/api/sessions/${sessionId}/capture`, { action: 'start', prototypeAutonomyEnabled: true });
  await post(harness.app, `/api/sessions/${sessionId}/controls`, { kind: 'pause' });

  const all = harness.orchestrator.listEvents(sessionId, 0, 100);
  assert.ok(all.length >= 3);
  const cursor = all[0]!.sequence;

  const response = await harness.app.request(`/api/sessions/${sessionId}/events?access_token=${TOKEN}`, {
    headers: { 'Last-Event-ID': String(cursor) },
  });
  const frames = await readFrames(response, all.length);
  const replayed = frames.slice(1).map((frame) => Number(frame.id));
  assert.ok(replayed.every((sequence) => sequence > cursor), `replayed ${replayed.join(',')} should all be after ${cursor}`);
  harness.close();
});

test('streaming an unknown session is a 404 envelope, not an open stream', async () => {
  const harness = bootApi();
  const response = await harness.app.request(`/api/sessions/nope/events?access_token=${TOKEN}`);
  assert.equal(response.status, 404);
  harness.close();
});
