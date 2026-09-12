import assert from 'node:assert/strict';
import test from 'node:test';
import { CaptureController } from '../src/capture-controller.js';
import { FixtureTranscriptionSession, recordingSink } from '../src/fixtures.js';

test('emits only finalized transcripts, suppresses duplicates, and rejects old epochs', async () => {
  const sessions: FixtureTranscriptionSession[] = [];
  const { sink, observations } = recordingSink();
  let identifier = 0;
  const controller = new CaptureController({
    sessionId: 'session-a',
    streamId: 'meet-audio',
    sink,
    createId: () => `id-${++identifier}`,
    createTranscriptionSession: () => {
      const session = new FixtureTranscriptionSession();
      sessions.push(session);
      return session;
    },
  });

  await controller.start();
  const first = sessions[0]!;
  first.emit({ type: 'delta', itemId: 'turn-1', text: 'hello', audioTurnSequence: 1, orderReliable: true });
  first.emit({ type: 'completed', itemId: 'turn-1', text: 'hello world', audioTurnSequence: 1, orderReliable: true });
  first.emit({ type: 'completed', itemId: 'turn-1', text: 'hello world', audioTurnSequence: 1, orderReliable: true });
  await settle();
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.kind, 'transcript');
  assert.equal(observations[0]?.kind, 'transcript');
  assert.equal(observations[0]?.kind === 'transcript' ? observations[0].text : undefined, 'hello world');
  assert.equal(controller.getCaptions()[0]?.final, true);

  await controller.pause();
  await controller.resume();
  const second = sessions[1]!;
  first.emit({ type: 'completed', itemId: 'late', text: 'must not arrive', audioTurnSequence: 2, orderReliable: true });
  second.emit({ type: 'completed', itemId: 'turn-2', text: 'new epoch', audioTurnSequence: 1, orderReliable: true });
  await settle();
  assert.equal(observations.length, 2);
  assert.notEqual(observations[0]?.captureEpoch, observations[1]?.captureEpoch);
  assert.equal(observations[1]?.kind === 'transcript' ? observations[1].text : undefined, 'new epoch');

  await controller.stop();
  second.emit({ type: 'completed', itemId: 'after-stop', text: 'must not arrive', audioTurnSequence: 2, orderReliable: true });
  await settle();
  assert.equal(observations.length, 2);
});

test('commits a live audio turn after a bounded local silence window', async () => {
  const sessions: FixtureTranscriptionSession[] = [];
  const { sink } = recordingSink();
  const controller = new CaptureController({
    sessionId: 'session-a',
    streamId: 'meet-audio',
    sink,
    createTranscriptionSession: () => {
      const session = new FixtureTranscriptionSession();
      sessions.push(session);
      return session;
    },
  });

  await controller.start();
  controller.ingestRecallPcm16(new Int16Array(3_200).fill(1_000));
  for (let index = 0; index < 4; index += 1) controller.ingestRecallPcm16(new Int16Array(3_200));
  assert.equal(sessions[0]?.commits, 1);
});

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
