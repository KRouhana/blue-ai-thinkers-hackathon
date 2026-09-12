import type { PlannerProposal, RepoMap, Revision, SourceRef } from '@fork/contracts';
import { plannerProposalSchema } from '@fork/contracts';
import type { StoredIntent } from '@fork/state';
import type { PlannerOutput } from './output-schema';
import type { PlanningContext } from './planner';

export interface ProposalIds {
  id: string;
  sessionId: string;
  captureEpoch: string;
  sourceObservationIds: string[];
  expectedRevision: Revision;
}

export type PendingPatch = StoredIntent['pendingPatch'];

export type ConversionResult =
  | { ok: true; proposal: PlannerProposal; pendingPatch: PendingPatch }
  | { ok: false; hold: PlannerProposal; reason: string };

const DEFAULT_SUMMARY: Record<PlannerOutput['kind'], string> = {
  observe: 'Listening',
  hold: 'Waiting for clearer context',
  clarify: 'Asking which element is meant',
  preview_patch: 'Trying a preview change',
  prototype_change: 'Prototyping a change',
  undo: 'Reverting the last experiment',
  pause: 'Pausing automatic changes',
};

const trim = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value);
const trimAll = (values: readonly string[], max: number, count: number): string[] =>
  values.slice(0, count).map((value) => trim(value, max));

function intentBase(output: PlannerOutput, ids: ProposalIds): Omit<PlannerProposal, 'kind'> & { summary: string } {
  return {
    id: ids.id,
    sessionId: ids.sessionId,
    captureEpoch: ids.captureEpoch,
    sourceObservationIds: ids.sourceObservationIds,
    expectedRevision: ids.expectedRevision,
    summary: trim(output.summary.trim() || DEFAULT_SUMMARY[output.kind], 200),
  };
}

function holdFor(output: PlannerOutput, ids: ProposalIds, reason: string): ConversionResult {
  const hold = plannerProposalSchema.parse({
    ...intentBase(output, ids),
    summary: 'Waiting for clearer context',
    kind: 'hold',
    reason: trim(reason, 300),
  });
  return { ok: false, hold, reason };
}

/** Nothing reaches the gate unless it parses as a contract proposal. Invalid model output becomes a hold. */
function finish(candidate: unknown, output: PlannerOutput, ids: ProposalIds, pendingPatch: PendingPatch): ConversionResult {
  const parsed = plannerProposalSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') ?? 'output';
    return holdFor(output, ids, `planner output invalid: ${where}: ${issue?.message ?? 'unknown problem'}`);
  }
  return { ok: true, proposal: parsed.data, pendingPatch };
}

const patchValue = (kind: string, value: string): string | boolean => (kind === 'set_visibility' ? value === 'true' : value);

function knownSources(repoMap: RepoMap | null): Map<string, SourceRef> {
  const entries = repoMap
    ? [...repoMap.routes.flatMap((route) => route.sources), ...repoMap.relevantSources].map((source) => [source.path, source] as const)
    : [];
  return new Map(entries);
}

function convertPatch(output: PlannerOutput, ids: ProposalIds, context: PlanningContext): ConversionResult {
  if (!output.patch || !output.targetEvidence) {
    return holdFor(output, ids, 'planner output invalid: preview_patch without a patch or target evidence');
  }
  if (!context.context) {
    return holdFor(output, ids, 'no screen context was valid when this was said');
  }
  if (output.targetEvidence.basis.length === 0) {
    return holdFor(output, ids, 'planner output invalid: target evidence has no basis');
  }
  const candidate = {
    ...intentBase(output, ids),
    kind: 'preview_patch',
    patch: { kind: output.patch.kind, elementId: output.patch.elementId, value: patchValue(output.patch.kind, output.patch.value) },
    targetEvidence: {
      contextObservationId: context.context.observationId,
      elementId: output.targetEvidence.elementId,
      basis: output.targetEvidence.basis,
      explanation: trim(output.targetEvidence.explanation.trim() || output.reason.trim() || 'grounded in the current screen', 300),
    },
  };
  return finish(candidate, output, ids, null);
}

function convertClarify(output: PlannerOutput, ids: ProposalIds, context: PlanningContext): ConversionResult {
  if (!output.clarify) return holdFor(output, ids, 'planner output invalid: clarify without a question');
  if (!context.context) return holdFor(output, ids, 'no screen context was valid when this was said');
  const question = output.clarify.question.trim();
  if (question.length === 0) return holdFor(output, ids, 'planner output invalid: clarify without a question');

  const byId = new Map(context.context.elements.map((element) => [element.id, element]));
  const candidates = output.clarify.candidateElementIds
    .map((id) => byId.get(id))
    .filter((element): element is NonNullable<typeof element> => element !== undefined && element.visible)
    .slice(0, 4)
    .map((element) => ({ id: element.id, label: element.label }));
  if (candidates.length < 2) {
    return holdFor(output, ids, 'planner output invalid: fewer than two visible candidates could be resolved');
  }

  const pending = output.clarify.pendingPatch;
  const pendingPatch: PendingPatch = pending ? { kind: pending.kind, value: patchValue(pending.kind, pending.value) } : null;
  return finish({ ...intentBase(output, ids), kind: 'clarify', question: trim(question, 200), candidates }, output, ids, pendingPatch);
}

function convertPrototype(output: PlannerOutput, ids: ProposalIds, repoMap: RepoMap | null): ConversionResult {
  if (!output.prototype) return holdFor(output, ids, 'planner output invalid: prototype_change without a brief');
  const brief = output.prototype.brief.trim();
  if (brief.length === 0) return holdFor(output, ids, 'planner output invalid: prototype_change without a brief');

  const known = knownSources(repoMap);
  const relevantSources = output.prototype.relevantSourcePaths
    .map((path) => known.get(path))
    .filter((source): source is SourceRef => source !== undefined)
    .slice(0, 8);

  const candidate = {
    ...intentBase(output, ids),
    kind: 'prototype_change',
    brief: trim(brief, 600),
    relevantSources,
    constraints: trimAll(output.prototype.constraints, 200, 8),
    mockedIntegrations: trimAll(output.prototype.mockedIntegrations, 200, 8),
  };
  return finish(candidate, output, ids, null);
}

/** Pure conversion from loose model output to a validated contract proposal. */
export function toProposal(
  output: PlannerOutput,
  ids: ProposalIds,
  context: PlanningContext,
  repoMap: RepoMap | null,
): ConversionResult {
  const reason = trim(output.reason.trim() || 'no reason given', 300);
  switch (output.kind) {
    case 'observe':
    case 'hold':
      return finish({ ...intentBase(output, ids), kind: output.kind, reason }, output, ids, null);
    case 'pause':
      return finish({ ...intentBase(output, ids), kind: 'pause' }, output, ids, null);
    case 'undo':
      return output.undoExperimentId
        ? finish({ ...intentBase(output, ids), kind: 'undo', experimentId: output.undoExperimentId }, output, ids, null)
        : holdFor(output, ids, 'planner output invalid: undo without an experiment id');
    case 'preview_patch':
      return convertPatch(output, ids, context);
    case 'clarify':
      return convertClarify(output, ids, context);
    case 'prototype_change':
      return convertPrototype(output, ids, repoMap);
  }
}
