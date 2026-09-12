import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixtureClient, getFixturePreviewConfig } from './fixture';
import { emptyState, reduceEvent } from './state';
import type { SessionEvent } from './types';

async function runningFixture() {
  const client = createFixtureClient();
  const initial = await client.create();
  const events: SessionEvent[] = [];
  const unsubscribe = client.subscribe(initial.id, initial.lastEventSequence, event => events.push(event), () => {});
  await client.capture(initial.id, 'start');
  const advance = (count: number) => { for (let i = 0; i < count; i++) client.advanceScenario(); };
  return { client, id: initial.id, initial, events, advance, unsubscribe };
}

for (const action of ['pause', 'cancel_job', 'stop'] as const) {
  test(`fixture ${action} prevents a running build becoming ready or changing the preview`, async () => {
    const { client, id, events, advance, unsubscribe } = await runningFixture();
    try {
      advance(4);
      const before = await client.snapshot(id);
      await client.control(id, action === 'cancel_job' ? { kind: action, jobId: 'fixture-filter-job' } : { kind: action });
      const cancelledAt = events.length;
      if (action !== 'cancel_job') await client.control(id, { kind: 'resume' });
      advance(2);
      const after = await client.snapshot(id);
      assert.deepEqual(after.revision, before.revision);
      assert.equal(getFixturePreviewConfig(after).config.overdueEnabled, false);
      assert.equal(after.experiments.some(e => e.id === 'fixture-filter'), false);
      assert.equal(events.slice(cancelledAt).some(e => e.payload.kind === 'job' && e.payload.progress.state === 'ready'), false);
      assert.ok(events.some(e => e.payload.kind === 'job' && e.payload.progress.state === 'cancelled'));
    } finally { unsubscribe(); }
  });
}

test('fixture undo persists across later snapshot publications and retains unrelated changes', async () => {
  const { client, id, advance, unsubscribe } = await runningFixture();
  try {
    advance(3);
    assert.deepEqual(getFixturePreviewConfig(await client.snapshot(id)).config, { buttonSize: 'xl', buttonColor: 'red', overdueEnabled: false });
    await client.control(id, { kind: 'undo', experimentId: 'fixture-correction' });
    const reverted = await client.snapshot(id);
    assert.deepEqual(getFixturePreviewConfig(reverted).config, { buttonSize: 'xl', buttonColor: 'blue', overdueEnabled: false });
    advance(3);
    await client.control(id, { kind: 'pause' });
    const afterPublish = await client.snapshot(id);
    assert.deepEqual(getFixturePreviewConfig(afterPublish).config, { buttonSize: 'xl', buttonColor: 'blue', overdueEnabled: true });
    assert.equal(afterPublish.experiments.find(e => e.id === 'fixture-correction')?.status, 'reverted');
    await assert.rejects(client.control(id, { kind: 'undo', experimentId: 'fixture-correction' }), /not available/);
  } finally { unsubscribe(); }
});

test('fixture clarification accepts a current choice once and remains cleared on subsequent events', async () => {
  const { client, id, advance, unsubscribe } = await runningFixture();
  try {
    advance(7);
    const clarification = (await client.snapshot(id)).clarification!;
    assert.equal(clarification.intentId, 'fixture-clarification');
    await assert.rejects(client.control(id, { kind: 'clarification_answer', intentId: clarification.intentId, candidateId: 'nonexistent' }), /no longer available/);
    const answer = { kind: 'clarification_answer' as const, intentId: clarification.intentId, candidateId: clarification.candidates[0].id };
    await client.control(id, answer);
    assert.equal((await client.snapshot(id)).clarification, null);
    await assert.rejects(client.control(id, answer), /no longer available/);
    advance(3);
    await client.control(id, { kind: 'pause' });
    assert.equal((await client.snapshot(id)).clarification, null);
  } finally { unsubscribe(); }
});

test('fixture events and snapshots have monotonic sequences and replay restores authoritative state', async () => {
  const { client, id, initial, events, advance, unsubscribe } = await runningFixture();
  try {
    advance(8);
    await client.control(id, { kind: 'pause' });
    const current = await client.snapshot(id);
    assert.deepEqual(events.map(e => e.sequence), Array.from({ length: events.length }, (_, i) => i + 1));
    for (const event of events) {
      assert.equal(event.sessionId, id);
      if (event.payload.kind === 'snapshot') assert.equal(event.payload.snapshot.lastEventSequence, event.sequence);
    }
    const reduced = events.reduce(reduceEvent, { ...emptyState, snapshot: initial });
    assert.deepEqual(reduced.snapshot, current);
    const replayed: SessionEvent[] = [];
    const stopReplay = client.subscribe(id, 5, event => replayed.push(event), () => {});
    assert.deepEqual(replayed, events.filter(e => e.sequence > 5));
    stopReplay();
    const count = replayed.length;
    await client.control(id, { kind: 'stop' });
    assert.equal(replayed.length, count);
    current.experiments.length = 0;
    assert.ok((await client.snapshot(id)).experiments.length > 0, 'returned snapshots cannot mutate fixture authority');
  } finally { unsubscribe(); }
});
