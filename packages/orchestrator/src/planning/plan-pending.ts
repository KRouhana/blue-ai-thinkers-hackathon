import type { RepoMap } from '@fork/contracts';
import type { SessionRecord, StoredIntent, StoredObservation } from '@fork/state';
import { dedupeKeyFor, resolvedClarificationKey } from '../gate/dedupe-key';
import { MUTATING_KINDS, runGate } from '../gate/gate';
import { newId } from '../ids';
import { selectContextAt } from '../observations/context-at';
import { lastTurns, orderTurns } from '../observations/transcript-window';
import { buildPlanningContext } from '../planner/context-builder';
import type { PlannerOutput } from '../planner/output-schema';
import type { PlanningContext } from '../planner/planner';
import { toProposal, type ProposalIds } from '../planner/to-proposal';
import { retrieveCompanyNotes } from '../retrieval/company-docs';
import { readRepoExcerpts } from '../retrieval/repo-files';
import { projectFor, type RuntimeDeps } from '../runtime';
import { screenOf } from '../planner/context-builder';
import { dispatch } from './dispatch';

const CONTEXT_HISTORY = 20;
const EXPERIMENT_HISTORY = 50;
const REPO_EXCERPT_FILES = 3;

interface Gathered {
  pending: StoredObservation[];
  context: StoredObservation | null;
  repoMap: RepoMap | null;
  planningContext: PlanningContext;
  sourceObservationIds: string[];
}

async function gather(deps: RuntimeDeps, session: SessionRecord, pending: StoredObservation[]): Promise<Gathered> {
  const { store, config } = deps;
  const pendingIds = new Set(pending.map((stored) => stored.observation.id));
  const window = lastTurns(orderTurns(store.listFinalTranscript(session.id, session.captureEpoch, config.transcriptWindowTurns)), config.transcriptWindowTurns);
  const recentTurns = window.filter((stored) => !pendingIds.has(stored.observation.id));

  const newest = pending.at(-1)!;
  const context = selectContextAt(
    store.listContext(session.id, session.captureEpoch, CONTEXT_HISTORY),
    newest.observation.capturedAt,
    config.contextLookbackMs,
  );

  const repoMap = store.getRepoMap(session.id);
  const experiments = store.listExperiments(session.id, EXPERIMENT_HISTORY);
  const intents = new Map<string, StoredIntent>(
    experiments.flatMap((experiment) => {
      const intent = store.getIntent(experiment.intentId);
      return intent ? [[experiment.intentId, intent] as const] : [];
    }),
  );

  const spoken = pending.map((stored) => (stored.observation.kind === 'transcript' ? stored.observation.text : '')).join(' ');
  const companyNotes = retrieveCompanyNotes(deps.companyDocs, spoken, config.maxCompanyExcerpts);
  const workspaceRoot = projectFor(deps.projects, session.projectConfigId)?.workspaceRoot ?? null;
  const screen = screenOf(context);
  const repoExcerpts = await readRepoExcerpts(workspaceRoot, repoMap, screen?.route ?? null, REPO_EXCERPT_FILES, config.maxRepoFileLines);

  return {
    pending,
    context,
    repoMap,
    sourceObservationIds: [...pendingIds, ...(context ? [context.observation.id] : [])],
    planningContext: buildPlanningContext({
      session, newTurns: pending, recentTurns, context, experiments, intents, repoMap, companyNotes, repoExcerpts,
    }),
  };
}

async function callPlanner(deps: RuntimeDeps, sessionId: string, context: PlanningContext, pendingIds: readonly string[]): Promise<PlannerOutput | null> {
  try {
    return await deps.planner.plan(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.error('planner threw', { sessionId, error: message });
    deps.store.setPlanStatus(pendingIds, 'failed', null);
    deps.bus.publish(sessionId, { kind: 'error', code: 'planner_failed', message: `The planner could not run: ${message}` });
    return null;
  }
}

function observationsFor(deps: RuntimeDeps, ids: readonly string[]): Map<string, StoredObservation> {
  return new Map(ids.flatMap((id) => {
    const stored = deps.store.getObservation(id);
    return stored ? [[id, stored] as const] : [];
  }));
}

/**
 * One settle window, one planning pass: gather bounded evidence, ask the planner once, apply the
 * deterministic gate, record the intent either way, and dispatch only what the gate allowed.
 */
export async function planPending(deps: RuntimeDeps, sessionId: string): Promise<void> {
  const session = deps.store.getSession(sessionId);
  if (!session) return;
  const pending = orderTurns(deps.store.listPendingTranscript(sessionId, session.captureEpoch));
  if (pending.length === 0) return;

  const pendingIds = pending.map((stored) => stored.observation.id);
  if (session.capture !== 'listening') {
    deps.store.setPlanStatus(pendingIds, 'skipped', null);
    return;
  }

  const gathered = await gather(deps, session, pending);
  const output = await callPlanner(deps, sessionId, gathered.planningContext, pendingIds);
  if (!output) return;

  const ids: ProposalIds = {
    id: newId('int'),
    sessionId,
    captureEpoch: session.captureEpoch,
    sourceObservationIds: gathered.sourceObservationIds,
    expectedRevision: session.revision,
  };
  const conversion = toProposal(output, ids, gathered.planningContext, gathered.repoMap);
  const proposal = conversion.ok ? conversion.proposal : conversion.hold;
  const resolvesClarification = output.resolvesClarification && session.clarification !== null;
  const dedupeKey = resolvesClarification && session.clarification
    ? resolvedClarificationKey(session.clarification.intentId)
    : dedupeKeyFor(sessionId, proposal);

  const gate = runGate({
    proposal,
    session,
    config: deps.config,
    observations: observationsFor(deps, gathered.sourceObservationIds),
    experiments: deps.store.listExperiments(sessionId, EXPERIMENT_HISTORY),
    hasDedupeKey: (key) => deps.store.hasDedupeKey(sessionId, key),
    dedupeKey,
  });

  const now = deps.clock.nowIso();
  deps.store.transaction(() => {
    deps.store.insertIntent(sessionId, {
      proposal,
      gateStatus: gate.allowed ? 'allowed' : 'rejected',
      gateReason: gate.allowed ? null : `${gate.code}: ${gate.reason}`,
      dedupeKey,
      pendingPatch: conversion.ok ? conversion.pendingPatch : null,
      createdAt: now,
    });
    if (gate.allowed && MUTATING_KINDS.has(proposal.kind)) deps.store.putDedupeKey(sessionId, dedupeKey, proposal.id);
    deps.store.setPlanStatus(pendingIds, 'planned', proposal.id);
    if (output.currentTopic) deps.store.updateSession(sessionId, { currentTopic: output.currentTopic.slice(0, 200) }, now);
  });

  if (!gate.allowed) {
    deps.logger.info('gate refused an action', { sessionId, kind: proposal.kind, code: gate.code, reason: gate.reason });
    return;
  }

  dispatch(deps, {
    session: deps.sessions.require(sessionId),
    proposal,
    pendingPatch: conversion.ok ? conversion.pendingPatch : null,
    screen: gathered.planningContext.context,
    resolvesClarification,
  });
}
