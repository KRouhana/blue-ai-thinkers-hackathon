import type { PlannerProposal, PrototypeJob, SizeToken } from '@fork/contracts';
import type { SessionRecord, StoredExperiment } from '@fork/state';
import { newId } from '../ids';
import type { PlanningScreen } from '../planner/planner';
import type { PendingPatch } from '../planner/to-proposal';
import type { RuntimeDeps } from '../runtime';
import { describePatchRelative, describeProposal } from '../scheduler/describe';
import { toRecord } from '../scheduler/shared';

export interface DispatchInput {
  session: SessionRecord;
  proposal: PlannerProposal;
  pendingPatch: PendingPatch;
  screen: PlanningScreen | null;
  resolvesClarification: boolean;
}

function labelFor(screen: PlanningScreen | null, elementId: string): string {
  return screen?.elements.find((element) => element.id === elementId)?.label ?? elementId;
}

/** The size currently on screen for this target, so a correction reads as "smaller", not "larger". */
function previousSize(deps: RuntimeDeps, sessionId: string, targetKey: string): SizeToken | null {
  const visible = deps.store
    .listExperiments(sessionId, deps.config.snapshotExperiments)
    .filter((experiment) => experiment.status === 'visible' && experiment.targetKey === targetKey);
  const latest = visible.at(-1);
  if (!latest) return null;
  const proposal = deps.store.getIntent(latest.intentId)?.proposal;
  return proposal?.kind === 'preview_patch' && proposal.patch.kind === 'set_size' ? proposal.patch.value : null;
}

function insertExperiment(deps: RuntimeDeps, input: {
  session: SessionRecord; proposal: PlannerProposal; summary: string; targetKey: string; mockNotes: string[];
}): StoredExperiment {
  const now = deps.clock.nowIso();
  const experiment = deps.store.insertExperiment({
    id: newId('exp'),
    sessionId: input.session.id,
    intentId: input.proposal.id,
    status: 'proposed',
    summary: input.summary,
    origin: 'inferred_experiment',
    sourceObservationIds: input.proposal.sourceObservationIds,
    revision: input.session.revision,
    checkpointId: null,
    mockNotes: input.mockNotes,
    targetKey: input.targetKey,
    createdAt: now,
    updatedAt: now,
  });
  deps.bus.publish(input.session.id, { kind: 'experiment', experiment: toRecord(experiment) });
  return experiment;
}

function clearClarification(deps: RuntimeDeps, sessionId: string): void {
  deps.store.updateSession(sessionId, { clarification: null }, deps.clock.nowIso());
}

function dispatchPatch(deps: RuntimeDeps, input: DispatchInput & { proposal: Extract<PlannerProposal, { kind: 'preview_patch' }> }): void {
  const { proposal, session } = input;
  const targetKey = `element:${proposal.patch.elementId}`;
  const summary = describePatchRelative(
    proposal.patch,
    labelFor(input.screen, proposal.patch.elementId),
    previousSize(deps, session.id, targetKey),
  );
  if (input.resolvesClarification && session.clarification) clearClarification(deps, session.id);
  const experiment = insertExperiment(deps, { session, proposal, summary, targetKey, mockNotes: [] });
  deps.scheduler.enqueue({
    kind: 'patch',
    sessionId: session.id,
    intentId: proposal.id,
    experimentId: experiment.id,
    targetKey,
    patch: proposal.patch,
    expectedRevision: proposal.expectedRevision,
  });
}

function dispatchJob(deps: RuntimeDeps, input: DispatchInput & { proposal: Extract<PlannerProposal, { kind: 'prototype_change' }> }): void {
  const { proposal, session } = input;
  if (!session.workspaceId) return;
  const targetKey = `job:${session.workspaceId}`;
  const experiment = insertExperiment(deps, {
    session, proposal, summary: describeProposal(proposal, null), targetKey, mockNotes: [...proposal.mockedIntegrations],
  });
  const job: PrototypeJob = {
    id: newId('job'),
    experimentId: experiment.id,
    sessionId: session.id,
    workspaceId: session.workspaceId,
    intentId: proposal.id,
    expectedRevision: proposal.expectedRevision,
    brief: proposal.brief,
    relevantSources: proposal.relevantSources,
    constraints: proposal.constraints,
    mockedIntegrations: proposal.mockedIntegrations,
    mode: 'demo_only',
    verification: 'compile_and_render',
  };
  deps.scheduler.enqueue({ kind: 'job', sessionId: session.id, intentId: proposal.id, experimentId: experiment.id, targetKey, job });
}

function dispatchClarify(deps: RuntimeDeps, input: DispatchInput & { proposal: Extract<PlannerProposal, { kind: 'clarify' }> }): void {
  const { proposal, session, screen } = input;
  if (!screen) return;
  deps.store.updateSession(session.id, {
    clarification: {
      intentId: proposal.id,
      question: proposal.question,
      candidates: proposal.candidates,
      route: screen.route,
      contextObservationId: screen.observationId,
      createdAt: deps.clock.nowIso(),
    },
  }, deps.clock.nowIso());
  deps.bus.publish(session.id, {
    kind: 'clarification', intentId: proposal.id, question: proposal.question, candidates: proposal.candidates,
  });
  deps.sessions.publishSnapshot(session.id);
}

function dispatchUndo(deps: RuntimeDeps, input: DispatchInput & { proposal: Extract<PlannerProposal, { kind: 'undo' }> }): void {
  const experiment = deps.store.getExperiment(input.proposal.experimentId);
  if (!experiment) return;
  deps.scheduler.enqueue({
    kind: 'undo',
    sessionId: input.session.id,
    intentId: input.proposal.id,
    experimentId: experiment.id,
    targetKey: experiment.targetKey,
    origin: 'inferred_experiment',
  });
}

/** Turns an allowed proposal into scheduled work or quiet state. Nothing else may schedule work. */
export function dispatch(deps: RuntimeDeps, input: DispatchInput): void {
  switch (input.proposal.kind) {
    case 'preview_patch':
      return dispatchPatch(deps, { ...input, proposal: input.proposal });
    case 'prototype_change':
      return dispatchJob(deps, { ...input, proposal: input.proposal });
    case 'clarify':
      return dispatchClarify(deps, { ...input, proposal: input.proposal });
    case 'undo':
      return dispatchUndo(deps, { ...input, proposal: input.proposal });
    case 'pause':
      deps.sessions.pause(input.session.id);
      return;
    case 'observe':
    case 'hold':
      return;
  }
}
