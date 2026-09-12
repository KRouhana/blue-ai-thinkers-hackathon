import type { ExperimentRecord, Revision } from '@fork/contracts';
import type { SessionRecord, StoredExperiment } from '@fork/state';
import { OrchestratorError } from '../errors';
import type { SchedulerDeps } from './types';

export const sameRevision = (a: Revision, b: Revision): boolean => a.source === b.source && a.config === b.config;

/** The browser-facing record: internal bookkeeping columns are not part of the contract. */
export function toRecord(stored: StoredExperiment): ExperimentRecord {
  const { sessionId: _sessionId, targetKey: _targetKey, createdAt: _createdAt, updatedAt: _updatedAt, ...record } = stored;
  return record;
}

export function requireSession(deps: SchedulerDeps, sessionId: string): SessionRecord {
  const session = deps.store.getSession(sessionId);
  if (!session) throw new OrchestratorError('session_not_found', `session ${sessionId} not found`);
  return session;
}

export type ExperimentPatch = Partial<Pick<StoredExperiment, 'status' | 'checkpointId' | 'revision' | 'mockNotes' | 'summary'>>;

/** Every experiment status change is persisted and streamed, so D never invents one. */
export function transition(deps: SchedulerDeps, sessionId: string, experimentId: string, patch: ExperimentPatch): StoredExperiment {
  const updated = deps.store.updateExperiment(experimentId, patch, deps.clock.nowIso());
  deps.bus.publish(sessionId, { kind: 'experiment', experiment: toRecord(updated) });
  return updated;
}

export function publishStatus(deps: SchedulerDeps, sessionId: string, message: string): void {
  deps.bus.publish(sessionId, { kind: 'status', message });
}

export function publishSnapshot(deps: SchedulerDeps, sessionId: string): void {
  deps.bus.publish(sessionId, { kind: 'snapshot', snapshot: deps.snapshotOf(sessionId) });
}

export function failExperiment(deps: SchedulerDeps, sessionId: string, experimentId: string, reason: string): void {
  transition(deps, sessionId, experimentId, { status: 'failed' });
  publishStatus(deps, sessionId, `Could not apply: ${reason}`);
}
