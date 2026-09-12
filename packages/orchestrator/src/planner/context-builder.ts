import type { PreviewPatch, RepoMap } from '@fork/contracts';
import type { SessionRecord, StoredExperiment, StoredIntent, StoredObservation } from '@fork/state';
import type { PlanningContext, PlanningElement, PlanningScreen } from './planner';

export interface BuildContextInput {
  session: SessionRecord;
  newTurns: readonly StoredObservation[];
  recentTurns: readonly StoredObservation[];
  context: StoredObservation | null;
  experiments: readonly StoredExperiment[];
  intents: ReadonlyMap<string, StoredIntent>;
  repoMap: RepoMap | null;
  companyNotes: ReadonlyArray<{ path: string; excerpt: string }>;
  repoExcerpts: ReadonlyArray<{ path: string; excerpt: string }>;
}

const textOf = (stored: StoredObservation): string => (stored.observation.kind === 'transcript' ? stored.observation.text : '');

const sequenceOf = (stored: StoredObservation): number | null =>
  stored.observation.kind === 'transcript' ? stored.observation.audioTurnSequence : null;

/** The planner-facing view of one screen snapshot; also reused when a host control cites it. */
export function screenOf(stored: StoredObservation | null): PlanningScreen | null {
  if (!stored || stored.observation.kind !== 'preview_context') return null;
  const observation = stored.observation;
  const elements: PlanningElement[] = observation.elements.map((element) => ({
    id: element.id,
    role: element.role,
    label: element.label,
    section: element.section ?? null,
    visible: element.visible,
    editable: element.editable,
  }));
  return {
    observationId: observation.id,
    route: observation.route,
    revision: observation.revision,
    focusId: observation.focusId,
    hoverId: observation.hover?.elementId ?? null,
    selectionId: observation.selection?.elementId ?? null,
    elements,
  };
}

function patchOf(experiment: StoredExperiment, intents: ReadonlyMap<string, StoredIntent>): PreviewPatch | null {
  const proposal = intents.get(experiment.intentId)?.proposal;
  return proposal?.kind === 'preview_patch' ? proposal.patch : null;
}

function flattenRepoMap(repoMap: RepoMap | null): PlanningContext['repoMap'] {
  if (!repoMap) return null;
  const paths = [...repoMap.routes.flatMap((route) => route.sources), ...repoMap.relevantSources].map((source) => source.path);
  return {
    framework: repoMap.framework.name,
    verified: repoMap.framework.verified,
    routes: repoMap.routes.map((route) => route.route),
    relevantSources: [...new Set(paths)],
    mockCapabilities: [...repoMap.mockCapabilities],
    limitations: [...repoMap.limitations],
  };
}

/** Pure assembly: what the planner sees is exactly what we can defend as evidence. */
export function buildPlanningContext(input: BuildContextInput): PlanningContext {
  const { session } = input;
  return {
    session: {
      id: session.id,
      captureEpoch: session.captureEpoch,
      capture: session.capture,
      prototypeAutonomyEnabled: session.prototypeAutonomyEnabled,
      revision: session.revision,
      currentTopic: session.currentTopic,
    },
    newTurns: input.newTurns.map((stored) => ({
      id: stored.observation.id,
      text: textOf(stored),
      audioTurnSequence: sequenceOf(stored),
    })),
    recentTurns: input.recentTurns.map((stored) => ({ id: stored.observation.id, text: textOf(stored) })),
    context: screenOf(input.context),
    visibleExperiments: input.experiments
      .filter((experiment) => experiment.status === 'visible')
      .map((experiment) => ({
        id: experiment.id,
        summary: experiment.summary,
        targetKey: experiment.targetKey,
        patch: patchOf(experiment, input.intents),
      })),
    pendingClarification: session.clarification
      ? {
          intentId: session.clarification.intentId,
          question: session.clarification.question,
          candidates: session.clarification.candidates,
        }
      : null,
    repoMap: flattenRepoMap(input.repoMap),
    companyNotes: input.companyNotes.map((note) => ({ ...note })),
    repoExcerpts: input.repoExcerpts.map((excerpt) => ({ ...excerpt })),
  };
}
