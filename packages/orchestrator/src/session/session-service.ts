import type { PreparedWorkspace, PrototypeEngine, RepoMap, SessionSnapshot } from '@fork/contracts';
import { preparedWorkspaceSchema } from '@fork/contracts';
import type { SessionRecord, StateStore } from '@fork/state';
import type { Clock } from '../clock';
import type { OrchestratorConfig } from '../config';
import { OrchestratorError } from '../errors';
import type { EventBus } from '../events/event-bus';
import type { Logger } from '../logger';
import { projectFor, type ProjectConfig } from '../runtime';
import { newId } from '../ids';
import { buildSnapshot } from './snapshot';

export interface SessionServiceDeps {
  store: StateStore;
  engine: PrototypeEngine;
  bus: EventBus;
  clock: Clock;
  config: OrchestratorConfig;
  logger: Logger;
  projects: readonly ProjectConfig[];
}

/** Owns session lifecycle and capture epochs. Autonomy is granted by an explicit host action only. */
export class SessionService {
  constructor(private readonly deps: SessionServiceDeps) {}

  async create(input: { projectConfigId: string }): Promise<{ session: SessionRecord; repoMap: RepoMap }> {
    const project = projectFor(this.deps.projects, input.projectConfigId);
    if (!project) {
      throw new OrchestratorError('project_not_allowed', `project '${input.projectConfigId}' is not in the server allowlist`);
    }
    const id = newId('ses');
    const prepared = await this.prepare(id, project);
    const now = this.deps.clock.nowIso();
    const record: SessionRecord = {
      id,
      projectConfigId: project.id,
      captureEpoch: newId('cap'),
      capture: 'stopped',
      prototypeAutonomyEnabled: false,
      workspaceId: prepared.workspaceId,
      revision: prepared.revision,
      previewUrl: prepared.previewUrl,
      currentTopic: null,
      clarification: null,
      resumedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const session = this.deps.store.transaction(() => {
      const created = this.deps.store.createSession(record);
      this.deps.store.saveRepoMap(id, prepared.repoMap);
      return created;
    });
    this.publishSnapshot(id);
    return { session, repoMap: prepared.repoMap };
  }

  /** A new epoch: speech from the previous one can never become a new action. */
  startCapture(sessionId: string, prototypeAutonomyEnabled?: boolean): SessionRecord {
    const current = this.require(sessionId);
    const now = this.deps.clock.nowIso();
    const captureEpoch = newId('cap');
    const updated = this.deps.store.transaction(() => {
      this.deps.store.endCaptureEpoch(current.captureEpoch, now);
      this.deps.store.recordCaptureEpoch({ id: captureEpoch, sessionId, startedAt: now });
      this.skipPending(current);
      return this.deps.store.updateSession(sessionId, {
        captureEpoch,
        capture: 'listening',
        prototypeAutonomyEnabled: prototypeAutonomyEnabled ?? current.prototypeAutonomyEnabled,
        resumedAt: now,
        clarification: null,
      }, now);
    });
    this.publishSnapshot(sessionId);
    return updated;
  }

  pause(sessionId: string): SessionRecord {
    const current = this.require(sessionId);
    if (current.capture !== 'listening') {
      throw new OrchestratorError('invalid_state', `cannot pause a session that is ${current.capture}`);
    }
    const updated = this.deps.store.transaction(() => {
      this.skipPending(current);
      return this.deps.store.updateSession(sessionId, { capture: 'paused' }, this.deps.clock.nowIso());
    });
    this.deps.bus.publish(sessionId, { kind: 'status', message: 'Paused automatic changes' });
    this.publishSnapshot(sessionId);
    return updated;
  }

  resume(sessionId: string): SessionRecord {
    const current = this.require(sessionId);
    if (current.capture !== 'paused') {
      throw new OrchestratorError('invalid_state', `cannot resume a session that is ${current.capture}`);
    }
    const now = this.deps.clock.nowIso();
    const updated = this.deps.store.updateSession(sessionId, { capture: 'listening', resumedAt: now }, now);
    this.deps.bus.publish(sessionId, { kind: 'status', message: 'Resumed automatic changes' });
    this.publishSnapshot(sessionId);
    return updated;
  }

  stop(sessionId: string): SessionRecord {
    const current = this.require(sessionId);
    const now = this.deps.clock.nowIso();
    const updated = this.deps.store.transaction(() => {
      this.deps.store.endCaptureEpoch(current.captureEpoch, now);
      this.skipPending(current);
      return this.deps.store.updateSession(sessionId, {
        capture: 'stopped', prototypeAutonomyEnabled: false, clarification: null,
      }, now);
    });
    this.deps.bus.publish(sessionId, { kind: 'status', message: 'Capture stopped' });
    this.publishSnapshot(sessionId);
    return updated;
  }

  snapshotOf(sessionId: string): SessionSnapshot {
    const session = this.require(sessionId);
    return buildSnapshot(
      session,
      this.deps.store.listExperiments(sessionId, this.deps.config.snapshotExperiments),
      this.deps.store.lastEventSequence(sessionId),
      this.deps.config.snapshotExperiments,
    );
  }

  publishSnapshot(sessionId: string): void {
    this.deps.bus.publish(sessionId, { kind: 'snapshot', snapshot: this.snapshotOf(sessionId) });
  }

  require(sessionId: string): SessionRecord {
    const session = this.deps.store.getSession(sessionId);
    if (!session) throw new OrchestratorError('session_not_found', `session ${sessionId} not found`);
    return session;
  }

  private skipPending(session: SessionRecord): void {
    const pending = this.deps.store.listPendingTranscript(session.id, session.captureEpoch);
    if (pending.length > 0) {
      this.deps.store.setPlanStatus(pending.map((stored) => stored.observation.id), 'skipped', null);
    }
  }

  private async prepare(sessionId: string, project: ProjectConfig): Promise<PreparedWorkspace> {
    try {
      const prepared = await this.deps.engine.prepare({ sessionId, projectConfigId: project.id, mode: project.mode });
      return preparedWorkspaceSchema.parse(prepared);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.error('workspace preparation failed', { sessionId, project: project.id, error: message });
      throw new OrchestratorError('engine_failed', `the prototype engine could not prepare a workspace: ${message}`);
    }
  }
}
