import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenRouterBufferedTranscriber } from '../src/node.js';

test('sends a bounded in-memory WAV turn to OpenRouter and emits only its final text', async () => {
  let requestBody: Record<string, unknown> | null = null;
  const transcriber = new OpenRouterBufferedTranscriber({
    apiKey: 'test-key',
    model: 'openai/gpt-transcribe',
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ text: 'final caption' }), { status: 200 });
    },
  });
  const events: unknown[] = [];
  transcriber.subscribe((event) => events.push(event));

  await transcriber.connect();
  transcriber.appendPcm24(new Int16Array([100, -100, 200]));
  transcriber.commitAudio();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.ok(requestBody);
  const body = requestBody as Record<string, unknown>;
  assert.equal(body.model, 'openai/gpt-transcribe');
  const inputAudio = body.input_audio as { data?: unknown; format?: unknown };
  assert.equal(inputAudio.format, 'wav');
  assert.equal(Buffer.from(String(inputAudio.data), 'base64').subarray(0, 4).toString('ascii'), 'RIFF');
  assert.deepEqual(events, [{
    type: 'completed', itemId: 'openrouter-1', text: 'final caption', audioTurnSequence: null, orderReliable: false,
  }]);
});
