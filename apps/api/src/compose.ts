import type { PrototypeEngine } from '@fork/contracts';
import { createOrchestrator, LlmPlanner, type Logger, type Orchestrator, type Planner } from '@fork/orchestrator';
import { FakePrototypeEngine, FixturePlanner, scenarioPlannerTable } from '@fork/orchestrator/testing';
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

/** A fake never silently replaces a failed live integration: asking for one we lack is an error. */
function liveEngineNotWired(): never {
  throw new Error(
    "live engine adapter not wired: Track C's PrototypeEngine must be injected here by the integrator (D). Use FORK_ENGINE=fake until then.",
  );
}

function buildPlanner(env: ApiEnv, logger: Logger): Planner {
  if (env.planner === 'live') return LlmPlanner.fromEnv(process.env, logger);
  // Fixture mode only knows the scripted scenario turns; anything else yields a labelled observe.
  return new FixturePlanner(scenarioPlannerTable());
}

export function compose(env: ApiEnv, logger: Logger): Composed {
  const store = openSqliteStore(env.dbPath);
  const projects = loadProjects(env.projectsFile);
  const engine: PrototypeEngine = env.engine === 'fake' ? new FakePrototypeEngine() : liveEngineNotWired();
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
