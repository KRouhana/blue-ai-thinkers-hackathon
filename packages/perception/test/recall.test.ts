import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { buildRecallBotRequest } from '../src/recall.js';
import { verifyRecallSignature } from '../src/node.js';

test('rejects an invalid Recall signature and accepts the documented HMAC shape', () => {
  const secret = `whsec_${Buffer.from('fixture-key').toString('base64')}`;
  const id = 'msg_fixture';
  const timestamp = '1731705121';
  const payload = '';
  const signature = createHmac('sha256', Buffer.from('fixture-key'))
    .update(`${id}.${timestamp}.${payload}`).digest('base64');
  const headers = {
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${signature}`,
  };
  assert.equal(verifyRecallSignature({ secret, headers, payload: null }), true);
  assert.equal(verifyRecallSignature({ secret, headers: { ...headers, 'webhook-signature': 'v1,not-valid' }, payload: null }), false);
});

test('creates a visible Fork bot configured for live-only, zero-retention audio', () => {
  const request = buildRecallBotRequest({
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    callbackUrl: 'wss://demo.ngrok.app/recall/audio/',
    botName: 'Fork',
    captureEpoch: 'epoch-a',
  });
  const config = request.recording_config as Record<string, unknown>;
  assert.equal(request.bot_name, 'Fork');
  assert.equal(config.retention, null);
  assert.equal(config.video_mixed_mp4, null);
  assert.deepEqual(config.audio_mixed_raw, {});
  assert.deepEqual(config.realtime_endpoints, [{
    type: 'websocket',
    url: 'wss://demo.ngrok.app/recall/audio/',
    events: ['audio_mixed_raw.data'],
  }]);
});
