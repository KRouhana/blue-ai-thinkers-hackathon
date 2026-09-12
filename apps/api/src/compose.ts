import { fileURLToPath } from 'node:url';
import type { PrototypeEngine } from '@fork/contracts';
import { createOrchestrator, LlmPlanner, type Logger, type Orchestrator, type Planner, type ProjectConfig } from '@fork/orchestrator';
import { FakePrototypeEngine, FixturePlanner, scenarioPlannerTable } from '@fork/orchestrator/testing';
import { createPrototypeEngine } from '@fork/prototype-engine';
import { openSqliteStore, type StateStore } from '@fork/state';
import type { Hono } from 'hono';
import { createApp } from './app';
import type { ApiEnv } from './env';
import { loadProjects } from './projects';
import { UnconfiguredTranscriptionConnector } from './transcription/connector';

export interface Composed {
  store: StateStore;
  orchestrator: Orchestrator;
  app: Hono;
  plannerLabel: 'live' | 'fixture';
  engineLabel: 'live' | 'FIXTURE';
}

/**
 * Track C's engine (packages/prototype-engine) implements the same PrototypeEngine
 * shape via the root contracts.v2.ts mirror; @fork/contracts is the canonical copy.
 * B's project allowlist (id/label/mode/workspaceRoot) maps onto C's own project
 * config (id/sourcePath): a null workspaceRoot is C's blank_template.
 */
// Root of this repo checkout: C's blank-template dependency check (react/react-dom)
// needs the actual install location, which our single root npm workspace install
// hoists here rather than nesting under packages/prototype-engine/node_modules.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

async function buildLiveEngine(env: ApiEnv, projects: readonly ProjectConfig[], logger: Logger): Promise<PrototypeEngine> {
  const engine = await createPrototypeEngine({
    runtimeRoot: env.engineRuntimeRoot,
    hostOrigin: env.meetingOrigin,
    projects: projects.map((project) => ({
      id: project.id,
      sourcePath: project.workspaceRoot ?? undefined,
      // Only the blank template (no sourcePath) needs this: an existing_repo project
      // resolves its own node_modules relative to its sourcePath, which is correct as-is.
      ...(project.workspaceRoot ? {} : { dependencyPath: `${ROOT}node_modules` }),
    })),
    publicPreviewHosts: env.publicPreviewHosts,
    onEvent: (event) => logger.info('prototype-engine event', { workspaceId: event.workspaceId, kind: event.kind, message: event.message }),
  });
  return engine;
}

function buildPlanner(env: ApiEnv, logger: Logger): Planner {
  if (env.planner === 'live') return LlmPlanner.fromEnv(process.env, logger);
  // Fixture mode only knows the scripted scenario turns; anything else yields a labelled observe.
  return new FixturePlanner(scenarioPlannerTable());
}

export async function compose(env: ApiEnv, logger: Logger): Promise<Composed> {
  const store = openSqliteStore(env.dbPath);
  const projects = loadProjects(env.projectsFile);
  const engine: PrototypeEngine = env.engine === 'fake' ? new FakePrototypeEngine() : await buildLiveEngine(env, projects, logger);
  const planner = buildPlanner(env, logger);

  const orchestrator = createOrchestrator({
    store,
    engine,
    planner,
    projects,
    config: { settleMs: env.settleMs },
    logger,
    companyDocsDir: env.companyDocsDir,
  });

  const app = createApp({
    orchestrator,
    token: env.token,
    allowedOrigins: env.allowedOrigins,
    transcription: new UnconfiguredTranscriptionConnector(),
    logger,
  });

  return { store, orchestrator, app, plannerLabel: orchestrator.plannerLabel, engineLabel: orchestrator.engineLabel };
}
