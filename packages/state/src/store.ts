import type { Observation, OutputPayload, RepoMap, SessionEvent } from '@fork/contracts';
import type { PlanStatus, SessionRecord, StoredExperiment, StoredIntent, StoredJob, StoredObservation } from './records';

/**
 * Repository interface over the single authoritative Fork database.
 * Every `update*` returns a NEW record; nothing returned aliases internal state.
 */
export interface StateStore {
  // sessions + capture epochs
  createSession(record: SessionRecord): SessionRecord;
  getSession(id: string): SessionRecord | null;
  updateSession(id: string, patch: Partial<Omit<SessionRecord, 'id' | 'createdAt'>>, updatedAt: string): SessionRecord;
  recordCaptureEpoch(input: { id: string; sessionId: string; startedAt: string }): void;
  endCaptureEpoch(id: string, endedAt: string): void;

  // observations (idempotent by id)
  insertObservation(observation: Observation, receivedAt: string): boolean; // false = duplicate id
  getObservation(id: string): StoredObservation | null;
  markSuperseded(id: string, supersededBy: string): void;
  setPlanStatus(ids: readonly string[], status: PlanStatus, intentId: string | null): void;
  listFinalTranscript(sessionId: string, captureEpoch: string, limit: number): StoredObservation[]; // newest last
  listPendingTranscript(sessionId: string, captureEpoch: string): StoredObservation[]; // received order
  listContext(sessionId: string, captureEpoch: string, limit: number): StoredObservation[]; // newest last

  // repo map
  saveRepoMap(sessionId: string, repoMap: RepoMap): void;
  getRepoMap(sessionId: string): RepoMap | null;

  // intents + dedupe
  insertIntent(sessionId: string, intent: StoredIntent): StoredIntent;
  getIntent(id: string): StoredIntent | null;
  updateIntent(id: string, patch: Partial<Pick<StoredIntent, 'gateStatus' | 'gateReason'>>): StoredIntent;
  listIntents(sessionId: string, limit: number): StoredIntent[]; // newest last
  hasDedupeKey(sessionId: string, key: string): boolean;
  putDedupeKey(sessionId: string, key: string, intentId: string): void;

  // experiments
  insertExperiment(experiment: StoredExperiment): StoredExperiment;
  getExperiment(id: string): StoredExperiment | null;
  updateExperiment(
    id: string,
    patch: Partial<Pick<StoredExperiment, 'status' | 'checkpointId' | 'revision' | 'mockNotes' | 'summary'>>,
    updatedAt: string,
  ): StoredExperiment;
  listExperiments(sessionId: string, limit: number): StoredExperiment[]; // newest last

  // jobs
  insertJob(sessionId: string, job: StoredJob): StoredJob;
  getJob(id: string): StoredJob | null;
  updateJob(id: string, patch: Partial<Pick<StoredJob, 'state' | 'message' | 'result'>>, updatedAt: string): StoredJob;

  // ordered events
  appendEvent(sessionId: string, payload: OutputPayload, at: string, id: string): SessionEvent;
  listEventsAfter(sessionId: string, afterSequence: number, limit: number): SessionEvent[];
  lastEventSequence(sessionId: string): number;

  transaction<T>(fn: () => T): T;
  close(): void;
}
