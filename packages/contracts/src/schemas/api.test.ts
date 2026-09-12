import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureRequestSchema, createSessionRequestSchema, observationsBatchSchema } from './api';
import { sessionControlSchema } from './session';

test('create session requires projectConfigId only (no client paths)', () => {
  assert.equal(createSessionRequestSchema.safeParse({ projectConfigId: 'demo-product' }).success, true);
  assert.equal(createSessionRequestSchema.safeParse({ projectConfigId: 'demo', workspaceRoot: '/Users/x' }).success, false);
});

test('capture request validates action and optional autonomy flag', () => {
  assert.equal(captureRequestSchema.safeParse({ action: 'start', prototypeAutonomyEnabled: true }).success, true);
  assert.equal(captureRequestSchema.safeParse({ action: 'resume' }).success, false);
});

test('observations batch is bounded 1..100', () => {
  assert.equal(observationsBatchSchema.safeParse({ observations: [] }).success, false);
});

test('session control discriminates by kind', () => {
  assert.equal(sessionControlSchema.safeParse({ kind: 'undo', experimentId: 'exp-1' }).success, true);
  assert.equal(sessionControlSchema.safeParse({ kind: 'clarification_answer', intentId: 'i', candidateId: 'c' }).success, true);
  assert.equal(sessionControlSchema.safeParse({ kind: 'deploy' }).success, false);
});
