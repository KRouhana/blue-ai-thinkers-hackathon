import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observationSchema, previewContextObservationSchema, transcriptObservationSchema } from './observations';
import type { PreviewContextObservation, TranscriptObservation } from '../types';

const page: PreviewContextObservation = {
  id: 'ctx-1', sessionId: 'meeting-1', captureEpoch: 'capture-1', version: 1,
  capturedAt: '2026-09-12T15:00:00Z', kind: 'preview_context', workspaceId: 'demo-1',
  revision: { source: 1, config: 0 }, route: '/signup', viewport: { width: 1280, height: 800 },
  focusId: null, hover: null, selection: null,
  elements: [{ id: 'start-trial', role: 'button', label: 'Start trial', section: 'Signup', visible: true,
    box: { x: 440, y: 500, width: 150, height: 40 }, editable: ['size', 'background', 'label', 'radius'] }],
};
const speech: TranscriptObservation = {
  id: 'speech-1', sessionId: 'meeting-1', captureEpoch: 'capture-1', version: 1,
  capturedAt: '2026-09-12T15:00:01Z', kind: 'transcript', phase: 'final',
  providerItemId: 'synthetic-audio-item-1', audioTurnSequence: 1, orderReliable: true,
  streamId: 'room-microphone', speaker: { label: null, verified: false },
  text: 'The Start trial button is too small. What if it were bigger?',
};

test('accepts the contract example page context', () => {
  const parsed = previewContextObservationSchema.parse(page);
  assert.deepEqual(parsed, page);
});

test('accepts the contract example speech turn and discriminates by kind', () => {
  const parsed = observationSchema.parse(speech);
  assert.equal(parsed.kind, 'transcript');
  assert.deepEqual(transcriptObservationSchema.parse(speech), speech);
});

test('rejects a verified speaker flag (contract says verified: false only)', () => {
  const bad = { ...speech, speaker: { label: 'Alice', verified: true } };
  assert.equal(transcriptObservationSchema.safeParse(bad).success, false);
});

test('rejects an element whose source path escapes the workspace', () => {
  const bad = { ...page, elements: [{ ...page.elements[0]!, source: { kind: 'repo', path: '../secrets.env', fingerprint: 'abc' } }] };
  assert.equal(previewContextObservationSchema.safeParse(bad).success, false);
});

test('rejects unknown top-level keys (strict objects)', () => {
  const bad = { ...speech, extra: 'nope' };
  assert.equal(transcriptObservationSchema.safeParse(bad).success, false);
});

test('rejects non-ISO capturedAt', () => {
  const bad = { ...speech, capturedAt: 'yesterday' };
  assert.equal(transcriptObservationSchema.safeParse(bad).success, false);
});
