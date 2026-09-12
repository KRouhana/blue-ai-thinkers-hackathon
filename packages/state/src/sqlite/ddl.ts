/** Small, flat schema. JSON columns hold contract payloads; scalar columns exist only for filtering/ordering. */
export const DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, project_config_id TEXT NOT NULL, capture_epoch TEXT NOT NULL, capture TEXT NOT NULL,
  autonomy INTEGER NOT NULL, workspace_id TEXT, revision_source INTEGER NOT NULL, revision_config INTEGER NOT NULL,
  preview_url TEXT, current_topic TEXT, clarification_json TEXT, resumed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS capture_epochs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT);
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, capture_epoch TEXT NOT NULL, kind TEXT NOT NULL, phase TEXT,
  captured_at TEXT NOT NULL, received_at TEXT NOT NULL, received_seq INTEGER NOT NULL,
  plan_status TEXT NOT NULL DEFAULT 'pending', superseded_by TEXT, intent_id TEXT, payload_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS observations_session_idx ON observations(session_id, capture_epoch, kind, received_seq);
CREATE TABLE IF NOT EXISTS repo_maps (session_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS intents (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, kind TEXT NOT NULL, gate_status TEXT NOT NULL,
  gate_reason TEXT, dedupe_key TEXT, pending_patch_json TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dedupe_keys (session_id TEXT NOT NULL, key TEXT NOT NULL, intent_id TEXT NOT NULL, PRIMARY KEY (session_id, key));
CREATE TABLE IF NOT EXISTS experiments (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, intent_id TEXT NOT NULL, status TEXT NOT NULL,
  summary TEXT NOT NULL, origin TEXT NOT NULL, source_ids_json TEXT NOT NULL, revision_source INTEGER NOT NULL, revision_config INTEGER NOT NULL,
  checkpoint_id TEXT, mock_notes_json TEXT NOT NULL, target_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS experiments_session_idx ON experiments(session_id, created_at);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, state TEXT NOT NULL, message TEXT NOT NULL,
  payload_json TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, sequence INTEGER NOT NULL, at TEXT NOT NULL,
  payload_json TEXT NOT NULL, UNIQUE (session_id, sequence));
`;
