import type {
  CaptureRequest, IngestReport, Observation, PreviewContextObservation, PrototypeEngine, RepoMap,
  SessionControl, SessionEvent, SessionSnapshot,
} from '@fork/contracts';
import { observationSchema } from '@fork/contracts';
import type { StateStore, StoredIntent, StoredJob } from '@fork/state';
import { systemClock, type Clock } from './clock';
import { resolveConfig, type OrchestratorConfig } from './config';
import { OrchestratorError } from './errors';
import { EventBus } from './events/event-bus';
import { silentLogger, type Logger } from './logger';
import { ingestBatch } from './observations/ingest';
import { SettleWindow } from './observations/settle-window';
import type { Planner } from './planner/planner';
import { dispatch } from './planning/dispatch';
import { planPending } from './planning/plan-pending';
import { loadCompanyDocs, type CompanyDoc } from './retrieval/company-docs';
import type { ProjectConfig, RuntimeDeps } from './runtime';
import { Scheduler } from './scheduler/scheduler';
import { applyControl, resolveClarification } from './session/controls';
import { SessionService } from './session/session-service';

export interface OrchestratorDeps {
  store: StateStore;
  engine: PrototypeEngine;
  planner: Planner;
  projects: readonly ProjectConfig[];
  config?: Partial<OrchestratorConfig>;
  clock?: Clock;
  logger?: Logger;
  companyDocsDir?: string;
}

export interface Orchestrator {
  createSession(input: { projectConfigId: string }): Promise<{ snapshot: SessionSnapshot; repoMap: RepoMap }>;
  getSnapshot(sessionId: string): SessionSnapshot | null;
  listEvents(sessionId: string, afterSequence: number, limit: number): SessionEvent[];
  subscribe(sessionId: string, listener: (event: SessionEvent) => void): () => void;
  setCapture(sessionId: string, input: CaptureRequest): Promise<SessionSnapshot>;
  ingestObservations(sessionId: string, observations: readonly Observation[]): Promise<IngestReport>;
  applyControl(sessionId: string, control: SessionControl): Promise<SessionSnapshot>;
  getJob(jobId: string): StoredJob | null;
  listIntents(sessionId: string, limit: number): StoredIntent[];
  /** Force the settle window and drain the scheduler. For tests and scenario replay. */
  flush(sessionId: string): Promise<void>;
  dispose(): void;
  readonly plannerLabel: 'live' | 'fixture';
  readonly engineLabel: 'live' | 'FIXTURE';
}

function engineLabelOf(engine: PrototypeEngine): 'live' | 'FIXTURE' {
  return (engine as { label?: unknown }).label === 'FIXTURE' ? 'FIXTURE' : 'live';
}

function loadDocs(dir: string | undefined, logger: Logger): CompanyDoc[] {
  if (!dir) return [];
  const docs = loadCompanyDocs(dir);
  if (docs.length === 0) logger.warn('no company notes were loaded', { dir });
  return docs;
}

function validate(observations: readonly Observation[]): Observation[] {
  return observations.map((observation) => {
    const parsed = observationSchema.safeParse(observation);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new OrchestratorError('validation_failed', `invalid observation: ${issue?.path.join('.')}: ${issue?.message}`);
    }
    return parsed.data;
  });
}

export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  const config = resolveConfig(deps.config ?? {});
  const clock = deps.clock ?? systemClock;
  const logger = deps.logger ?? silentLogger;
  const bus = new EventBus(deps.store, clock, logger);
  const sessions = new SessionService({
    store: deps.store, engine: deps.engine, bus, clock, config, logger, projects: deps.projects,
  });
  const scheduler = new Scheduler({
    store: deps.store, bus, engine: deps.engine, clock, config, logger, snapshotOf: (id) => sessions.snapshotOf(id),
  });
  const runtime: RuntimeDeps = {
    store: deps.store, engine: deps.engine, planner: deps.planner, bus, scheduler, sessions, clock, config, logger,
    projects: deps.projects, companyDocs: loadDocs(deps.companyDocsDir, logger),
  };

  // One planning pass at a time per session, so two settles can never interleave.
  const chains = new Map<string, Promise<void>>();
  const serial = (sessionId: string, work: () => Promise<void>): Promise<void> => {
    const previous = chains.get(sessionId) ?? Promise.resolve();
    const next = previous.then(work, work);
    chains.set(sessionId, next.catch(() => {}));
    return next;
  };

  const settle = new SettleWindow(
    config.settleMs,
    (sessionId) => serial(sessionId, () => planPending(runtime, sessionId)),
    (error, sessionId) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('planning pass failed', { sessionId, error: message });
      bus.publish(sessionId, { kind: 'error', code: 'planning_failed', message: `Planning could not complete: ${message}` });
    },
  );

  /** A UI context event may resolve or expire the pending question; it never repeats an applied one. */
  const reconcileClarification = (sessionId: string, contexts: readonly PreviewContextObservation[]): void => {
    for (const context of contexts) {
      const session = deps.store.getSession(sessionId);
      const clarification = session?.clarification;
      if (!session || !clarification) return;

      const visible = new Set(context.elements.filter((element) => element.visible).map((element) => element.id));
      const stillValid = context.route === clarification.route && clarification.candidates.every((candidate) => visible.has(candidate.id));
      if (!stillValid) {
        deps.store.updateSession(sessionId, { clarification: null }, clock.nowIso());
        bus.publish(sessionId, { kind: 'status', message: 'Question expired: the screen changed' });
        sessions.publishSnapshot(sessionId);
        return;
      }
      const selection = context.selection;
      const chosen = selection && clarification.candidates.some((candidate) => candidate.id === selection.elementId);
      if (chosen && selection && new Date(selection.at).getTime() > new Date(clarification.createdAt).getTime()) {
        try {
          resolveClarification(runtime, sessionId, clarification.intentId, selection.elementId);
        } catch (error) {
          logger.info('a selection did not resolve the pending question', { sessionId, error: String(error) });
        }
      }
    }
  };

  return {
    plannerLabel: deps.planner.label,
    engineLabel: engineLabelOf(deps.engine),

    async createSession(input) {
      const { session, repoMap } = await sessions.create(input);
      return { snapshot: sessions.snapshotOf(session.id), repoMap };
    },

    getSnapshot(sessionId) {
      return deps.store.getSession(sessionId) ? sessions.snapshotOf(sessionId) : null;
    },

    listEvents(sessionId, afterSequence, limit) {
      return deps.store.listEventsAfter(sessionId, afterSequence, limit);
    },

    subscribe(sessionId, listener) {
      return bus.subscribe(sessionId, listener);
    },

    async setCapture(sessionId, input) {
      sessions.require(sessionId);
      if (input.action === 'start') {
        settle.cancel(sessionId);
        sessions.startCapture(sessionId, input.prototypeAutonomyEnabled);
      } else if (input.action === 'pause') {
        sessions.pause(sessionId);
      } else {
        if (config.stopBehavior === 'cancel') await scheduler.cancelAll(sessionId);
        sessions.stop(sessionId);
      }
      return sessions.snapshotOf(sessionId);
    },

    async ingestObservations(sessionId, observations) {
      const session = sessions.require(sessionId);
      const validated = validate(observations);
      const report = ingestBatch({ store: deps.store, clock }, session, validated);
      const contexts = validated.filter(
        (observation): observation is PreviewContextObservation =>
          observation.kind === 'preview_context' && observation.captureEpoch === session.captureEpoch,
      );
      reconcileClarification(sessionId, contexts);
      if (deps.store.listPendingTranscript(sessionId, session.captureEpoch).length > 0) settle.touch(sessionId);
      return report;
    },

    applyControl(sessionId, control) {
      return applyControl(runtime, sessionId, control);
    },

    getJob(jobId) {
      return deps.store.getJob(jobId);
    },

    listIntents(sessionId, limit) {
      return deps.store.listIntents(sessionId, limit);
    },

    async flush(sessionId) {
      await settle.flush(sessionId);
      await (chains.get(sessionId) ?? Promise.resolve());
      await scheduler.idle(sessionId);
    },

    dispose() {
      settle.dispose();
    },
  };
}

export { dispatch };
