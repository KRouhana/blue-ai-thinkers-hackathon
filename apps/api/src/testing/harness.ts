/** Shared test wiring: a real orchestrator on an in-memory store behind the real Hono app. */
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';
import { createOrchestrator, fixedClock, silentLogger, type Orchestrator } from '@fork/orchestrator';
import { FakePrototypeEngine, FixturePlanner, scenarioPlannerTable } from '@fork/orchestrator/testing';
import { openSqliteStore, type StateStore } from '@fork/state';
import { createApp } from '../app';
import { UnconfiguredTranscriptionConnector, type TranscriptionConnector } from '../transcription/connector';

const COMPANY_DOCS = fileURLToPath(new URL('../../../../fixtures/company', import.meta.url));

export const TOKEN = 'test-token-value';
export const ORIGIN = 'http://localhost:3000';

export interface ApiHarness {
  app: Hono;
  orchestrator: Orchestrator;
  store: StateStore;
  engine: FakePrototypeEngine;
  close: () => void;
}

export function bootApi(options: { transcription?: TranscriptionConnector; orchestrator?: Orchestrator } = {}): ApiHarness {
  const store = openSqliteStore(':memory:');
  const engine = new FakePrototypeEngine({ jobDelayMs: 2 });
  const orchestrator = options.orchestrator ?? createOrchestrator({
    store,
    engine,
    planner: new FixturePlanner(scenarioPlannerTable()),
    projects: [
      { id: 'demo-product', label: 'Fixture demo product', mode: 'existing_repo', workspaceRoot: null },
      { id: 'blank-template', label: 'Blank prepared template', mode: 'blank_template', workspaceRoot: null },
    ],
    config: { settleMs: 1 },
    clock: fixedClock('2026-09-12T15:00:00.000Z'),
    logger: silentLogger,
    companyDocsDir: COMPANY_DOCS,
  });
  const app = createApp({
    orchestrator,
    token: TOKEN,
    allowedOrigins: [ORIGIN],
    transcription: options.transcription ?? new UnconfiguredTranscriptionConnector(),
    logger: silentLogger,
  });
  return { app, orchestrator, store, engine, close: () => { orchestrator.dispose(); store.close(); } };
}

export const authHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  ...extra,
});

export async function post(app: Hono, path: string, body: unknown, headers = authHeaders()): Promise<Response> {
  return app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });
}

export async function get(app: Hono, path: string, headers = authHeaders()): Promise<Response> {
  return app.request(path, { headers });
}

export async function createSession(app: Hono, projectConfigId = 'demo-product'): Promise<string> {
  const response = await post(app, '/api/sessions', { projectConfigId });
  const body = (await response.json()) as { data: { snapshot: { id: string } } };
  return body.data.snapshot.id;
}
