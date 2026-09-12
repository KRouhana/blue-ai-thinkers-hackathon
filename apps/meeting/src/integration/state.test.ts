import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyState, reduceEvent } from './state';
import type { SessionEvent, SessionSnapshot } from './types';

const snapshot = (sequence = 4): SessionSnapshot => ({ id: 'session-a', captureEpoch: 'epoch-a', capture: 'listening', prototypeAutonomyEnabled: true, workspaceId: 'workspace-a', revision: { source: 2, config: 3 }, previewUrl: 'http://localhost:5174', currentTopic: 'A demo', lastEventSequence: sequence, experiments: [], clarification: null });
const event = (sequence: number, payload: SessionEvent['payload'] = { kind: 'status', message: 'Building' }): SessionEvent => ({ id: `event-${sequence}`, sessionId: 'session-a', sequence, at: '2026-09-12T12:00:00Z', payload });
const initial = () => reduceEvent(emptyState, event(4, { kind: 'snapshot', snapshot: snapshot() }));

test('reducer applies consecutive events once and ignores gaps or another session', () => {
  const state = initial();
  const next = reduceEvent(state, event(5));
  assert.equal(next.message, 'Building');
  assert.equal(next.snapshot?.lastEventSequence, 5);
  assert.equal(state.snapshot?.lastEventSequence, 4, 'previous state must remain immutable');
  for (const invalid of [event(5), event(3), event(7), { ...event(6), sessionId: 'other-session' }]) {
    assert.equal(reduceEvent(next, invalid), next);
  }
  assert.equal(reduceEvent(emptyState, event(1)), emptyState);
});

test('snapshot recovery clears uncertain jobs and errors without accepting mismatched or stale snapshots', () => {
  let state = reduceEvent(initial(), event(5, { kind: 'job', progress: { jobId: 'job-a', state: 'running', message: 'Compiling' } }));
  state = reduceEvent(state, event(6, { kind: 'error', code: 'build', message: 'Build failed' }));
  assert.equal(state.jobKnown, true);
  assert.equal(state.error, 'Build failed');
  for (const invalid of [
    event(5, { kind: 'snapshot', snapshot: snapshot(5) }),
    event(8, { kind: 'snapshot', snapshot: snapshot(7) }),
    event(8, { kind: 'snapshot', snapshot: { ...snapshot(8), id: 'other-session' } }),
  ]) assert.equal(reduceEvent(state, invalid), state);
  const recovered = reduceEvent(state, event(8, { kind: 'snapshot', snapshot: snapshot(8) }));
  assert.equal(recovered.snapshot?.lastEventSequence, 8);
  assert.equal(recovered.job, null);
  assert.equal(recovered.jobKnown, false);
  assert.equal(recovered.error, null);
});

test('an experiment update replaces its record instead of duplicating it', () => {
  const experiment = { id: 'experiment-a', intentId: 'intent-a', status: 'applying' as const, summary: 'Bigger button', origin: 'inferred_experiment' as const, sourceObservationIds: ['observation-a'], revision: { source: 2, config: 3 }, checkpointId: null, mockNotes: [] };
  const applying = reduceEvent(initial(), event(5, { kind: 'experiment', experiment }));
  const visible = reduceEvent(applying, event(6, { kind: 'experiment', experiment: { ...experiment, status: 'visible', checkpointId: 'checkpoint-a' } }));
  assert.equal(visible.snapshot?.experiments.length, 1);
  assert.equal(visible.snapshot?.experiments[0].status, 'visible');
  assert.equal(applying.snapshot?.experiments[0].status, 'applying');
});
