import type { PlannerProposal, SessionControl, SessionSnapshot } from '@fork/contracts';
import { plannerProposalSchema } from '@fork/contracts';
import type { SessionRecord, StoredClarification } from '@fork/state';
import { resolvedClarificationKey } from '../gate/dedupe-key';
import { runGate } from '../gate/gate';
import { OrchestratorError } from '../errors';
import { newId } from '../ids';
import { screenOf } from '../planner/context-builder';
import type { RuntimeDeps } from '../runtime';
import { dispatch } from '../planning/dispatch';

function buildAnswerProposal(
  session: SessionRecord,
  clarification: StoredClarification,
  pendingPatch: NonNullable<import('@fork/state').StoredIntent['pendingPatch']>,
  candidateId: string,
  sourceObservationIds: string[],
): PlannerProposal {
  const candidate = {
    id: newId('int'),
    sessionId: session.id,
    captureEpoch: session.captureEpoch,
    sourceObservationIds,
    expectedRevision: session.revision,
    summary: `Applying the answer to: ${clarification.question}`.slice(0, 200),
    kind: 'preview_patch',
    patch: { kind: pendingPatch.kind, elementId: candidateId, value: pendingPatch.value },
    targetEvidence: {
      contextObservationId: clarification.contextObservationId,
      elementId: candidateId,
      basis: ['selection'],
      explanation: 'The host chose this candidate for the pending question.',
    },
  };
  const parsed = plannerProposalSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new OrchestratorError('validation_failed', `the pending change is no longer valid: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  return parsed.data;
}

/** A host (or a later contextual answer) resolves the one pending question. */
export function resolveClarification(deps: RuntimeDeps, sessionId: string, intentId: string, candidateId: string): SessionSnapshot {
  const session = deps.sessions.require(sessionId);
  const clarification = session.clarification;
  if (!clarification || clarification.intentId !== intentId) {
    throw new OrchestratorError('clarification_mismatch', 'there is no pending question with that id');
  }
  if (!clarification.candidates.some((candidate) => candidate.id === candidateId)) {
    throw new OrchestratorError('clarification_mismatch', `'${candidateId}' is not one of the offered candidates`);
  }
  const intent = deps.store.getIntent(intentId);
  if (!intent?.pendingPatch) {
    throw new OrchestratorError('invalid_state', 'that question has no pending change to apply');
  }

  const proposal = buildAnswerProposal(session, clarification, intent.pendingPatch, candidateId, intent.proposal.sourceObservationIds);
  const contextObservation = deps.store.getObservation(clarification.contextObservationId);
  const dedupeKey = resolvedClarificationKey(intentId);
  const observations = new Map(
    [...intent.proposal.sourceObservationIds, clarification.contextObservationId].flatMap((id) => {
      const stored = deps.store.getObservation(id);
      return stored ? [[id, stored] as const] : [];
    }),
  );

  const gate = runGate({
    proposal,
    session,
    config: deps.config,
    observations,
    experiments: deps.store.listExperiments(sessionId, deps.config.snapshotExperiments),
    hasDedupeKey: (key) => deps.store.hasDedupeKey(sessionId, key),
    dedupeKey,
  });
  if (!gate.allowed) {
    const code = gate.code === 'duplicate' ? 'invalid_state' : 'validation_failed';
    throw new OrchestratorError(code, `the answer could not be applied: ${gate.reason}`);
  }

  const now = deps.clock.nowIso();
  deps.store.transaction(() => {
    deps.store.insertIntent(sessionId, { proposal, gateStatus: 'allowed', gateReason: null, dedupeKey, pendingPatch: null, createdAt: now });
    deps.store.putDedupeKey(sessionId, dedupeKey, proposal.id);
    deps.store.updateSession(sessionId, { clarification: null }, now);
  });

  dispatch(deps, {
    session: deps.sessions.require(sessionId),
    proposal,
    pendingPatch: null,
    screen: screenOf(contextObservation),
    resolvesClarification: false,
  });
  return deps.sessions.snapshotOf(sessionId);
}

export async function applyControl(deps: RuntimeDeps, sessionId: string, control: SessionControl): Promise<SessionSnapshot> {
  deps.sessions.require(sessionId);
  switch (control.kind) {
    case 'pause':
      deps.sessions.pause(sessionId);
      break;
    case 'resume':
      deps.sessions.resume(sessionId);
      break;
    case 'stop':
      if (deps.config.stopBehavior === 'cancel') await deps.scheduler.cancelAll(sessionId);
      else await deps.scheduler.idle(sessionId);
      deps.sessions.stop(sessionId);
      break;
    case 'undo': {
      const experiment = deps.store.getExperiment(control.experimentId);
      if (!experiment || experiment.sessionId !== sessionId) {
        throw new OrchestratorError('experiment_not_found', `experiment ${control.experimentId} not found in this session`);
      }
      deps.scheduler.enqueue({
        kind: 'undo', sessionId, intentId: null, experimentId: experiment.id, targetKey: experiment.targetKey, origin: 'host_control',
      });
      break;
    }
    case 'cancel_job': {
      const cancelled = await deps.scheduler.cancelJob(sessionId, control.jobId);
      if (!cancelled) throw new OrchestratorError('job_not_found', `job ${control.jobId} is not queued or running`);
      break;
    }
    case 'clarification_answer':
      return resolveClarification(deps, sessionId, control.intentId, control.candidateId);
  }
  return deps.sessions.snapshotOf(sessionId);
}
