import type { SessionSnapshot } from '@fork/contracts';
import type { SessionRecord, StoredExperiment } from '@fork/state';

const DEFAULT_LIMIT = 20;

/** The only view of session state that leaves the server. Internal columns stay internal. */
export function buildSnapshot(
  session: SessionRecord,
  experiments: readonly StoredExperiment[],
  lastEventSequence: number,
  limit: number = DEFAULT_LIMIT,
): SessionSnapshot {
  return {
    id: session.id,
    captureEpoch: session.captureEpoch,
    capture: session.capture,
    prototypeAutonomyEnabled: session.prototypeAutonomyEnabled,
    workspaceId: session.workspaceId,
    revision: session.revision,
    previewUrl: session.previewUrl,
    currentTopic: session.currentTopic,
    lastEventSequence,
    experiments: experiments
      .slice(Math.max(0, experiments.length - limit))
      .map(({ sessionId: _sessionId, targetKey: _targetKey, createdAt: _createdAt, updatedAt: _updatedAt, ...record }) => record),
    clarification: session.clarification
      ? {
          intentId: session.clarification.intentId,
          question: session.clarification.question,
          candidates: session.clarification.candidates,
        }
      : null,
  };
}
