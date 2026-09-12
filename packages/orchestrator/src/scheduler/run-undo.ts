import { newId } from '../ids';
import { publishSnapshot, publishStatus, requireSession, transition } from './shared';
import type { SchedulerDeps, WorkItem } from './types';

type UndoItem = Extract<WorkItem, { kind: 'undo' }>;

export async function runUndo(deps: SchedulerDeps, item: UndoItem): Promise<void> {
  const experiment = deps.store.getExperiment(item.experimentId);
  if (!experiment || experiment.status !== 'visible' || !experiment.checkpointId) {
    publishStatus(deps, item.sessionId, 'Nothing to undo');
    return;
  }
  const session = requireSession(deps, item.sessionId);
  if (!session.workspaceId) {
    publishStatus(deps, item.sessionId, 'Nothing to undo');
    return;
  }

  const result = await deps.engine.undo({
    operationId: newId('op'),
    workspaceId: session.workspaceId,
    expectedRevision: session.revision,
    checkpointId: experiment.checkpointId,
  });
  if (!result.applied) {
    publishStatus(deps, item.sessionId, `Could not undo: ${result.diagnostic ?? 'the prototype engine refused the revert'}`);
    return;
  }

  deps.store.updateSession(item.sessionId, { revision: result.revision }, deps.clock.nowIso());
  const reverted = transition(deps, item.sessionId, item.experimentId, { status: 'reverted', revision: result.revision });
  publishStatus(deps, item.sessionId, `Reverted: ${reverted.summary}`);
  publishSnapshot(deps, item.sessionId);
}
