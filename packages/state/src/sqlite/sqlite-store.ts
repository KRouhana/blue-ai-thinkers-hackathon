import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Observation, OutputPayload, RepoMap, SessionEvent } from '@fork/contracts';
import type { PlanStatus, SessionRecord, StoredExperiment, StoredIntent, StoredJob, StoredObservation } from '../records';
import type { StateStore } from '../store';
import { DDL } from './ddl';
import { openDatabase } from './require-sqlite';
import {
  experimentToParams, intentToParams, jobToParams, merge, observationToParams, rowToEvent, rowToExperiment,
  rowToIntent, rowToJob, rowToObservation, rowToSession, sessionToParams, type Params, type Row,
} from './rows';

const SESSION_COLUMNS = [
  'project_config_id', 'capture_epoch', 'capture', 'autonomy', 'workspace_id', 'revision_source', 'revision_config',
  'preview_url', 'current_topic', 'clarification_json', 'resumed_at', 'updated_at',
];
const INSERT_SESSION = `INSERT INTO sessions (id, ${SESSION_COLUMNS.join(', ')}, created_at)
  VALUES (@id, ${SESSION_COLUMNS.map((c) => `@${c}`).join(', ')}, @created_at)`;
const UPDATE_SESSION = `UPDATE sessions SET ${SESSION_COLUMNS.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`;
const INSERT_OBSERVATION = `INSERT OR IGNORE INTO observations
  (id, session_id, capture_epoch, kind, phase, captured_at, received_at, received_seq, payload_json)
  VALUES (@id, @session_id, @capture_epoch, @kind, @phase, @captured_at, @received_at,
    (SELECT COALESCE(MAX(received_seq), 0) + 1 FROM observations WHERE session_id = @session_id), @payload_json)`;
const TRANSCRIPT_WHERE = `session_id = @session_id AND capture_epoch = @capture_epoch AND kind = 'transcript'
  AND phase = 'final' AND superseded_by IS NULL`;
const INSERT_INTENT = `INSERT INTO intents (id, session_id, kind, gate_status, gate_reason, dedupe_key, pending_patch_json, payload_json, created_at)
  VALUES (@id, @session_id, @kind, @gate_status, @gate_reason, @dedupe_key, @pending_patch_json, @payload_json, @created_at)`;
const EXPERIMENT_COLUMNS = ['session_id', 'intent_id', 'status', 'summary', 'origin', 'source_ids_json', 'revision_source',
  'revision_config', 'checkpoint_id', 'mock_notes_json', 'target_key', 'created_at', 'updated_at'];
const INSERT_EXPERIMENT = `INSERT INTO experiments (id, ${EXPERIMENT_COLUMNS.join(', ')})
  VALUES (@id, ${EXPERIMENT_COLUMNS.map((c) => `@${c}`).join(', ')})`;
const UPDATE_EXPERIMENT = `UPDATE experiments SET status = @status, summary = @summary, revision_source = @revision_source,
  revision_config = @revision_config, checkpoint_id = @checkpoint_id, mock_notes_json = @mock_notes_json, updated_at = @updated_at WHERE id = @id`;
const INSERT_JOB = `INSERT INTO jobs (id, session_id, state, message, payload_json, result_json, created_at, updated_at)
  VALUES (@id, @session_id, @state, @message, @payload_json, @result_json, @created_at, @updated_at)`;

export class SqliteStateStore implements StateStore {
  private depth = 0;

  constructor(private readonly db: DatabaseSync) {}

  migrate(): void {
    this.db.exec(DDL);
  }

  // ── helpers ────────────────────────────────────────────────────────────
  private run(sql: string, params: Params): number {
    return Number(this.db.prepare(sql).run(params).changes);
  }
  private one(sql: string, params: Params): Row | null {
    return (this.db.prepare(sql).get(params) as Row | undefined) ?? null;
  }
  private many(sql: string, params: Params): Row[] {
    return this.db.prepare(sql).all(params);
  }
  private newestLast(sql: string, params: Params): Row[] {
    return this.many(sql, params).reverse();
  }

  // ── sessions + epochs ─────────────────────────────────────────────────
  createSession(record: SessionRecord): SessionRecord {
    this.run(INSERT_SESSION, sessionToParams(record));
    return this.requireSession(record.id);
  }
  getSession(id: string): SessionRecord | null {
    const row = this.one('SELECT * FROM sessions WHERE id = @id', { id });
    return row ? rowToSession(row) : null;
  }
  updateSession(id: string, patch: Partial<Omit<SessionRecord, 'id' | 'createdAt'>>, updatedAt: string): SessionRecord {
    const next = merge(this.requireSession(id), { ...patch, updatedAt });
    const { created_at: _createdAt, ...params } = sessionToParams(next);
    this.run(UPDATE_SESSION, params);
    return next;
  }
  recordCaptureEpoch(input: { id: string; sessionId: string; startedAt: string }): void {
    this.run('INSERT OR IGNORE INTO capture_epochs (id, session_id, started_at) VALUES (@id, @session_id, @started_at)',
      { id: input.id, session_id: input.sessionId, started_at: input.startedAt });
  }
  endCaptureEpoch(id: string, endedAt: string): void {
    this.run('UPDATE capture_epochs SET ended_at = @ended_at WHERE id = @id AND ended_at IS NULL', { id, ended_at: endedAt });
  }
  private requireSession(id: string): SessionRecord {
    const session = this.getSession(id);
    if (!session) throw new Error(`session ${id} not found`);
    return session;
  }

  // ── observations ──────────────────────────────────────────────────────
  insertObservation(observation: Observation, receivedAt: string): boolean {
    return this.run(INSERT_OBSERVATION, observationToParams(observation, receivedAt)) === 1;
  }
  getObservation(id: string): StoredObservation | null {
    const row = this.one('SELECT * FROM observations WHERE id = @id', { id });
    return row ? rowToObservation(row) : null;
  }
  markSuperseded(id: string, supersededBy: string): void {
    this.run('UPDATE observations SET superseded_by = @superseded_by WHERE id = @id', { id, superseded_by: supersededBy });
  }
  setPlanStatus(ids: readonly string[], status: PlanStatus, intentId: string | null): void {
    this.transaction(() => {
      for (const id of ids) {
        this.run('UPDATE observations SET plan_status = @plan_status, intent_id = @intent_id WHERE id = @id',
          { id, plan_status: status, intent_id: intentId });
      }
    });
  }
  listFinalTranscript(sessionId: string, captureEpoch: string, limit: number): StoredObservation[] {
    const sql = `SELECT * FROM observations WHERE ${TRANSCRIPT_WHERE} ORDER BY received_seq DESC LIMIT @limit`;
    return this.newestLast(sql, { session_id: sessionId, capture_epoch: captureEpoch, limit }).map(rowToObservation);
  }
  listPendingTranscript(sessionId: string, captureEpoch: string): StoredObservation[] {
    const sql = `SELECT * FROM observations WHERE ${TRANSCRIPT_WHERE} AND plan_status = 'pending' ORDER BY received_seq ASC`;
    return this.many(sql, { session_id: sessionId, capture_epoch: captureEpoch }).map(rowToObservation);
  }
  listContext(sessionId: string, captureEpoch: string, limit: number): StoredObservation[] {
    const sql = `SELECT * FROM observations WHERE session_id = @session_id AND capture_epoch = @capture_epoch
      AND kind = 'preview_context' ORDER BY received_seq DESC LIMIT @limit`;
    return this.newestLast(sql, { session_id: sessionId, capture_epoch: captureEpoch, limit }).map(rowToObservation);
  }

  // ── repo map ──────────────────────────────────────────────────────────
  saveRepoMap(sessionId: string, repoMap: RepoMap): void {
    this.run('INSERT OR REPLACE INTO repo_maps (session_id, payload_json) VALUES (@session_id, @payload_json)',
      { session_id: sessionId, payload_json: JSON.stringify(repoMap) });
  }
  getRepoMap(sessionId: string): RepoMap | null {
    const row = this.one('SELECT payload_json FROM repo_maps WHERE session_id = @session_id', { session_id: sessionId });
    return row ? (JSON.parse(String(row.payload_json)) as RepoMap) : null;
  }

  // ── intents + dedupe ──────────────────────────────────────────────────
  insertIntent(sessionId: string, intent: StoredIntent): StoredIntent {
    this.run(INSERT_INTENT, intentToParams(sessionId, intent));
    return this.requireIntent(intent.proposal.id);
  }
  getIntent(id: string): StoredIntent | null {
    const row = this.one('SELECT * FROM intents WHERE id = @id', { id });
    return row ? rowToIntent(row) : null;
  }
  updateIntent(id: string, patch: Partial<Pick<StoredIntent, 'gateStatus' | 'gateReason'>>): StoredIntent {
    const next = merge(this.requireIntent(id), patch);
    this.run('UPDATE intents SET gate_status = @gate_status, gate_reason = @gate_reason WHERE id = @id',
      { id, gate_status: next.gateStatus, gate_reason: next.gateReason });
    return next;
  }
  listIntents(sessionId: string, limit: number): StoredIntent[] {
    const sql = 'SELECT * FROM intents WHERE session_id = @session_id ORDER BY rowid DESC LIMIT @limit';
    return this.newestLast(sql, { session_id: sessionId, limit }).map(rowToIntent);
  }
  hasDedupeKey(sessionId: string, key: string): boolean {
    return this.one('SELECT 1 AS present FROM dedupe_keys WHERE session_id = @session_id AND key = @key', { session_id: sessionId, key }) !== null;
  }
  putDedupeKey(sessionId: string, key: string, intentId: string): void {
    this.run('INSERT OR IGNORE INTO dedupe_keys (session_id, key, intent_id) VALUES (@session_id, @key, @intent_id)',
      { session_id: sessionId, key, intent_id: intentId });
  }
  private requireIntent(id: string): StoredIntent {
    const intent = this.getIntent(id);
    if (!intent) throw new Error(`intent ${id} not found`);
    return intent;
  }

  // ── experiments ───────────────────────────────────────────────────────
  insertExperiment(experiment: StoredExperiment): StoredExperiment {
    this.run(INSERT_EXPERIMENT, experimentToParams(experiment));
    return this.requireExperiment(experiment.id);
  }
  getExperiment(id: string): StoredExperiment | null {
    const row = this.one('SELECT * FROM experiments WHERE id = @id', { id });
    return row ? rowToExperiment(row) : null;
  }
  updateExperiment(
    id: string,
    patch: Partial<Pick<StoredExperiment, 'status' | 'checkpointId' | 'revision' | 'mockNotes' | 'summary'>>,
    updatedAt: string,
  ): StoredExperiment {
    const next = merge(this.requireExperiment(id), { ...patch, updatedAt });
    const { session_id: _s, intent_id: _i, origin: _o, source_ids_json: _src, target_key: _t, created_at: _c, ...params } = experimentToParams(next);
    this.run(UPDATE_EXPERIMENT, params);
    return next;
  }
  listExperiments(sessionId: string, limit: number): StoredExperiment[] {
    const sql = 'SELECT * FROM experiments WHERE session_id = @session_id ORDER BY rowid DESC LIMIT @limit';
    return this.newestLast(sql, { session_id: sessionId, limit }).map(rowToExperiment);
  }
  private requireExperiment(id: string): StoredExperiment {
    const experiment = this.getExperiment(id);
    if (!experiment) throw new Error(`experiment ${id} not found`);
    return experiment;
  }

  // ── jobs ──────────────────────────────────────────────────────────────
  insertJob(sessionId: string, job: StoredJob): StoredJob {
    this.run(INSERT_JOB, jobToParams(sessionId, job));
    return this.requireJob(job.job.id);
  }
  getJob(id: string): StoredJob | null {
    const row = this.one('SELECT * FROM jobs WHERE id = @id', { id });
    return row ? rowToJob(row) : null;
  }
  updateJob(id: string, patch: Partial<Pick<StoredJob, 'state' | 'message' | 'result'>>, updatedAt: string): StoredJob {
    const next = merge(this.requireJob(id), { ...patch, updatedAt });
    this.run('UPDATE jobs SET state = @state, message = @message, result_json = @result_json, updated_at = @updated_at WHERE id = @id',
      { id, state: next.state, message: next.message, result_json: next.result ? JSON.stringify(next.result) : null, updated_at: next.updatedAt });
    return next;
  }
  private requireJob(id: string): StoredJob {
    const job = this.getJob(id);
    if (!job) throw new Error(`job ${id} not found`);
    return job;
  }

  // ── events ────────────────────────────────────────────────────────────
  appendEvent(sessionId: string, payload: OutputPayload, at: string, id: string): SessionEvent {
    return this.transaction(() => {
      const sequence = this.lastEventSequence(sessionId) + 1;
      this.run('INSERT INTO events (id, session_id, sequence, at, payload_json) VALUES (@id, @session_id, @sequence, @at, @payload_json)',
        { id, session_id: sessionId, sequence, at, payload_json: JSON.stringify(payload) });
      return { id, sessionId, sequence, at, payload };
    });
  }
  listEventsAfter(sessionId: string, afterSequence: number, limit: number): SessionEvent[] {
    const sql = 'SELECT * FROM events WHERE session_id = @session_id AND sequence > @after ORDER BY sequence ASC LIMIT @limit';
    return this.many(sql, { session_id: sessionId, after: afterSequence, limit }).map(rowToEvent);
  }
  lastEventSequence(sessionId: string): number {
    const row = this.one('SELECT COALESCE(MAX(sequence), 0) AS seq FROM events WHERE session_id = @session_id', { session_id: sessionId });
    return Number(row?.seq ?? 0);
  }

  // ── transactions ──────────────────────────────────────────────────────
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.db.exec('BEGIN');
    this.depth += 1;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  close(): void {
    this.db.close();
  }
}

export function openSqliteStore(path: string): SqliteStateStore {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const store = new SqliteStateStore(openDatabase(path));
  store.migrate();
  return store;
}
