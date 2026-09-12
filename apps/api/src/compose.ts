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
  close(): Promise<void>;
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
    previewPort: env.previewPort,
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
  // Refresh B's source references after every C mutation, including rollback.
  if ('getWorkspace' in engine && typeof engine.getWorkspace === 'function') {
    const live = engine as typeof engine & { getWorkspace(id: string): { repoMap: import('@fork/contracts').RepoMap } };
    const owners = new Map<string, string>();
    const prepare = engine.prepare.bind(engine);
    engine.prepare = async request => {
      const prepared = await prepare(request);
      owners.set(prepared.workspaceId, request.sessionId);
      return prepared;
    };
    const run = engine.runJob.bind(engine);
    engine.runJob = async (...args) => {
      try { return await run(...args); }
      finally {
        const owner = owners.get(args[0].workspaceId);
        if (owner) store.saveRepoMap(owner, live.getWorkspace(args[0].workspaceId).repoMap);
      }
    };
    // Operator-selected local session may resume after restarting the demo API.
    const resumeId = process.env.FORK_RESUME_SESSION_ID;
    if (resumeId) {
      const session = store.getSession(resumeId);
      const project = projects.find(p => p.id === session?.projectConfigId);
      if (!session || !project) throw new Error('Resume session/project not found');
      const prepared = await engine.prepare({ sessionId: session.id, projectConfigId: project.id, mode: project.mode });
      store.saveRepoMap(session.id, prepared.repoMap);
      store.updateSession(session.id, {revision: prepared.revision, previewUrl: prepared.previewUrl}, new Date().toISOString());
    }
  }
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

  return { store, orchestrator, app, plannerLabel: orchestrator.plannerLabel, engineLabel: orchestrator.engineLabel,
    async close() {
      orchestrator.dispose();
      if ('close' in engine && typeof engine.close === 'function') await engine.close();
      store.close();
    },
  };
}
