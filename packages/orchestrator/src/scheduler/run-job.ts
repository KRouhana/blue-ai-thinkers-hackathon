import type { JobState, PrototypeResult } from '@fork/contracts';
import { publishSnapshot, publishStatus, requireSession, sameRevision, transition } from './shared';
import type { RunContext, SchedulerDeps, WorkItem } from './types';

type JobItem = Extract<WorkItem, { kind: 'job' }>;

const STALE_MESSAGE = 'Discarded a late result; a newer direction replaced it';

/** A late or superseded worker result never becomes the new desired state. */
function isStale(item: JobItem, result: PrototypeResult, context: RunContext): boolean {
  return context.isSuperseded(item.intentId)
    || result.state === 'superseded'
    || !sameRevision(result.basedOn, item.job.expectedRevision);
}

export async function runJob(deps: SchedulerDeps, item: JobItem, context: RunContext): Promise<void> {
  const session = requireSession(deps, item.sessionId);
  const now = deps.clock.nowIso();
  deps.store.insertJob(item.sessionId, { job: item.job, state: 'queued', message: 'queued', result: null, createdAt: now, updatedAt: now });

  let lastState: JobState | null = null;
  const emit = (state: JobState, message: string): void => {
    if (state === lastState) return;
    lastState = state;
    deps.store.updateJob(item.job.id, { state, message }, deps.clock.nowIso());
    deps.bus.publish(item.sessionId, { kind: 'job', progress: { jobId: item.job.id, state, message } });
  };

  emit('queued', 'queued');
  transition(deps, item.sessionId, item.experimentId, { status: 'applying' });
  const result = await deps.engine.runJob(item.job, (progress) => emit(progress.state, progress.message), context.signal);
  deps.store.updateJob(item.job.id, { result }, deps.clock.nowIso());
  // Cancellation/failed verification can restore a checkpoint at a NEW revision.
  // Synchronize it before any early return so the next job uses C's real state.
  deps.store.updateSession(item.sessionId, {
    revision: result.resultingRevision,
    previewUrl: result.previewUrl ?? session.previewUrl,
  }, deps.clock.nowIso());
  publishSnapshot(deps, item.sessionId);

  if (isStale(item, result, context)) {
    emit('superseded', STALE_MESSAGE);
    transition(deps, item.sessionId, item.experimentId, { status: 'superseded' });
    publishStatus(deps, item.sessionId, STALE_MESSAGE);
    return;
  }
  if (result.state === 'cancelled') {
    const experiment = transition(deps, item.sessionId, item.experimentId, { status: 'superseded' });
    emit('cancelled', 'cancelled');
    publishStatus(deps, item.sessionId, `Cancelled: ${experiment.summary}`);
    return;
  }
  if (result.state === 'failed') {
    emit('failed', 'failed');
    transition(deps, item.sessionId, item.experimentId, { status: 'failed' });
    publishStatus(deps, item.sessionId, `Could not apply: ${result.check.diagnostics[0] ?? 'render check failed'}`);
    return;
  }

  deps.store.updateSession(item.sessionId, {
    revision: result.resultingRevision,
    previewUrl: result.previewUrl ?? session.previewUrl,
  }, deps.clock.nowIso());
  emit('ready', 'preview renders');
  const visible = transition(deps, item.sessionId, item.experimentId, {
    status: 'visible', checkpointId: result.checkpointId, revision: result.resultingRevision, mockNotes: result.mockNotes,
  });
  publishStatus(deps, item.sessionId, `${visible.summary} — Undo`);
  publishSnapshot(deps, item.sessionId);
}
