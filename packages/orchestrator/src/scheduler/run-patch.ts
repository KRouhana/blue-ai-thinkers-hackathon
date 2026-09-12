import { newId } from '../ids';
import { failExperiment, publishSnapshot, publishStatus, requireSession, sameRevision, transition } from './shared';
import type { SchedulerDeps, WorkItem } from './types';

type PatchItem = Extract<WorkItem, { kind: 'patch' }>;

/** A config/preview edit. Revision checks apply here exactly as they do to code jobs. */
export async function runPatch(deps: SchedulerDeps, item: PatchItem): Promise<void> {
  const session = requireSession(deps, item.sessionId);
  if (!sameRevision(session.revision, item.expectedRevision)) {
    failExperiment(deps, item.sessionId, item.experimentId, 'preview changed before this edit could apply');
    return;
  }
  if (!session.workspaceId) {
    failExperiment(deps, item.sessionId, item.experimentId, 'session has no prepared workspace');
    return;
  }

  transition(deps, item.sessionId, item.experimentId, { status: 'applying' });
  const result = await deps.engine.applyPatch({
    operationId: newId('op'),
    sessionId: item.sessionId,
    workspaceId: session.workspaceId,
    expectedRevision: session.revision,
    patch: item.patch,
  });
  if (!result.applied) {
    failExperiment(deps, item.sessionId, item.experimentId, result.diagnostic ?? 'the prototype engine refused the patch');
    return;
  }

  deps.store.updateSession(item.sessionId, { revision: result.revision }, deps.clock.nowIso());
  const visible = transition(deps, item.sessionId, item.experimentId, {
    status: 'visible', checkpointId: result.checkpointId, revision: result.revision,
  });
  publishStatus(deps, item.sessionId, `${visible.summary} — Undo`);
  publishSnapshot(deps, item.sessionId);
}
