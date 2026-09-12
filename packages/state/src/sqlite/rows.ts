import type { Observation, SessionEvent } from '@fork/contracts';
import type { SessionRecord, StoredExperiment, StoredIntent, StoredJob, StoredObservation } from '../records';

export type Row = Record<string, unknown>;
export type Params = Record<string, string | number | null>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const json = <T>(v: unknown): T | null => (typeof v === 'string' ? (JSON.parse(v) as T) : null);
const jsonOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : JSON.stringify(v));

export function rowToSession(row: Row): SessionRecord {
  return {
    id: String(row.id),
    projectConfigId: String(row.project_config_id),
    captureEpoch: String(row.capture_epoch),
    capture: String(row.capture) as SessionRecord['capture'],
    prototypeAutonomyEnabled: num(row.autonomy) === 1,
    workspaceId: str(row.workspace_id),
    revision: { source: num(row.revision_source), config: num(row.revision_config) },
    previewUrl: str(row.preview_url),
    currentTopic: str(row.current_topic),
    clarification: json<SessionRecord['clarification']>(row.clarification_json),
    resumedAt: str(row.resumed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function sessionToParams(s: SessionRecord): Params {
  return {
    id: s.id,
    project_config_id: s.projectConfigId,
    capture_epoch: s.captureEpoch,
    capture: s.capture,
    autonomy: s.prototypeAutonomyEnabled ? 1 : 0,
    workspace_id: s.workspaceId,
    revision_source: s.revision.source,
    revision_config: s.revision.config,
    preview_url: s.previewUrl,
    current_topic: s.currentTopic,
    clarification_json: jsonOrNull(s.clarification),
    resumed_at: s.resumedAt,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

export function observationToParams(o: Observation, receivedAt: string): Params {
  return {
    id: o.id,
    session_id: o.sessionId,
    capture_epoch: o.captureEpoch,
    kind: o.kind,
    phase: o.kind === 'transcript' ? o.phase : null,
    captured_at: o.capturedAt,
    received_at: receivedAt,
    payload_json: JSON.stringify(o),
  };
}

export function rowToObservation(row: Row): StoredObservation {
  return {
    observation: json<Observation>(row.payload_json) as Observation,
    planStatus: String(row.plan_status) as StoredObservation['planStatus'],
    supersededBy: str(row.superseded_by),
    intentId: str(row.intent_id),
    receivedSeq: num(row.received_seq),
  };
}

export function intentToParams(sessionId: string, i: StoredIntent): Params {
  return {
    id: i.proposal.id,
    session_id: sessionId,
    kind: i.proposal.kind,
    gate_status: i.gateStatus,
    gate_reason: i.gateReason,
    dedupe_key: i.dedupeKey,
    pending_patch_json: jsonOrNull(i.pendingPatch),
    payload_json: JSON.stringify(i.proposal),
    created_at: i.createdAt,
  };
}

export function rowToIntent(row: Row): StoredIntent {
  return {
    proposal: json(row.payload_json) as StoredIntent['proposal'],
    gateStatus: String(row.gate_status) as StoredIntent['gateStatus'],
    gateReason: str(row.gate_reason),
    dedupeKey: str(row.dedupe_key),
    pendingPatch: json<StoredIntent['pendingPatch']>(row.pending_patch_json),
    createdAt: String(row.created_at),
  };
}

export function experimentToParams(e: StoredExperiment): Params {
  return {
    id: e.id,
    session_id: e.sessionId,
    intent_id: e.intentId,
    status: e.status,
    summary: e.summary,
    origin: e.origin,
    source_ids_json: JSON.stringify(e.sourceObservationIds),
    revision_source: e.revision.source,
    revision_config: e.revision.config,
    checkpoint_id: e.checkpointId,
    mock_notes_json: JSON.stringify(e.mockNotes),
    target_key: e.targetKey,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  };
}

export function rowToExperiment(row: Row): StoredExperiment {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    intentId: String(row.intent_id),
    status: String(row.status) as StoredExperiment['status'],
    summary: String(row.summary),
    origin: String(row.origin) as StoredExperiment['origin'],
    sourceObservationIds: json<string[]>(row.source_ids_json) ?? [],
    revision: { source: num(row.revision_source), config: num(row.revision_config) },
    checkpointId: str(row.checkpoint_id),
    mockNotes: json<string[]>(row.mock_notes_json) ?? [],
    targetKey: String(row.target_key),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function jobToParams(sessionId: string, j: StoredJob): Params {
  return {
    id: j.job.id,
    session_id: sessionId,
    state: j.state,
    message: j.message,
    payload_json: JSON.stringify(j.job),
    result_json: jsonOrNull(j.result),
    created_at: j.createdAt,
    updated_at: j.updatedAt,
  };
}

export function rowToJob(row: Row): StoredJob {
  return {
    job: json(row.payload_json) as StoredJob['job'],
    state: String(row.state) as StoredJob['state'],
    message: String(row.message),
    result: json<StoredJob['result']>(row.result_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function rowToEvent(row: Row): SessionEvent {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    sequence: num(row.sequence),
    at: String(row.at),
    payload: json(row.payload_json) as SessionEvent['payload'],
  };
}

/** Merge a partial patch over a record, ignoring explicitly-undefined keys (SQLite cannot bind undefined). */
export function merge<T extends object>(current: T, patch: Partial<NoInfer<T>>): T {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
  return { ...current, ...defined };
}
