import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Observation, PreviewContextObservation, PreviewElement, TranscriptObservation } from '@fork/contracts';
import type { PlannerOutput } from '../planner/output-schema';
import { DEMO_WORKSPACE } from './demo-workspace';

export const SCENARIOS_PATH = fileURLToPath(new URL('../../../../scenarios.json', import.meta.url));

export const FIXTURE_SESSION = 'fixture-session';
export const FIXTURE_EPOCH = 'fixture-epoch';

const BASE_TIME = Date.parse('2026-09-12T15:00:00.000Z');
const at = (offsetMs: number): string => new Date(BASE_TIME + offsetMs).toISOString();

export type Outcome =
  | 'preview_patch_visible'
  | 'no_experiment'
  | 'clarification_shown'
  | 'undo_or_smaller_patch'
  | 'job_ready'
  | 'job_superseded'
  | 'pause';

export type Precondition = 'paused' | 'visible_size_experiment' | 'running_job' | 'blank_template';

export interface ScenarioFixture {
  id: string;
  expected: string;
  note: string;
  route: string;
  elements: PreviewElement[];
  preconditions: Precondition[];
  /** Scripted speech that establishes the precondition (ids end in `-pre`). */
  preTurns: TranscriptObservation[];
  preOutput: PlannerOutput | null;
  turns: TranscriptObservation[];
  contextObservation: PreviewContextObservation;
  fixtureOutput: PlannerOutput;
  acceptableOutcomes: Outcome[];
}

interface ScenarioEntry {
  id: string;
  context: string;
  utterance: string;
  expected: string;
  note: string;
}

interface Definition {
  route: string;
  leadingTurns?: string[];
  preconditions?: Precondition[];
  preTurn?: string;
  preOutput?: PlannerOutput;
  output: PlannerOutput;
  acceptableOutcomes: Outcome[];
}

// ── output builders ────────────────────────────────────────────────────
const BLANK: PlannerOutput = {
  kind: 'observe', summary: '', reason: '', currentTopic: null, resolvesClarification: false,
  patch: null, targetEvidence: null, clarify: null, prototype: null, undoExperimentId: null,
};

type PatchKind = NonNullable<PlannerOutput['patch']>['kind'];
type TargetBasis = NonNullable<PlannerOutput['targetEvidence']>['basis'][number];

const observe = (summary: string, reason: string, currentTopic: string | null = null): PlannerOutput =>
  ({ ...BLANK, kind: 'observe', summary, reason, currentTopic });

const patchOutput = (input: {
  summary: string; reason: string; elementId: string; kind: PatchKind;
  value: string; basis: TargetBasis[]; explanation: string; currentTopic?: string;
}): PlannerOutput => ({
  ...BLANK,
  kind: 'preview_patch',
  summary: input.summary,
  reason: input.reason,
  currentTopic: input.currentTopic ?? null,
  patch: { kind: input.kind, elementId: input.elementId, value: input.value },
  targetEvidence: { elementId: input.elementId, basis: input.basis, explanation: input.explanation },
});

const clarifyOutput = (input: {
  summary: string; reason: string; question: string; candidateElementIds: string[];
  pendingPatch: { kind: PatchKind; value: string } | null;
}): PlannerOutput => ({
  ...BLANK,
  kind: 'clarify',
  summary: input.summary,
  reason: input.reason,
  clarify: { question: input.question, candidateElementIds: input.candidateElementIds, pendingPatch: input.pendingPatch },
});

const prototypeOutput = (input: {
  summary: string; reason: string; brief: string; relevantSourcePaths: string[];
  constraints: string[]; mockedIntegrations: string[]; currentTopic?: string;
}): PlannerOutput => ({
  ...BLANK,
  kind: 'prototype_change',
  summary: input.summary,
  reason: input.reason,
  currentTopic: input.currentTopic ?? null,
  prototype: {
    brief: input.brief,
    relevantSourcePaths: input.relevantSourcePaths,
    constraints: input.constraints,
    mockedIntegrations: input.mockedIntegrations,
  },
});

// ── one definition per scenarios.json entry ───────────────────────────
const DEFINITIONS: Record<string, Definition> = {
  suggestion: {
    route: '/signup',
    leadingTurns: ['The Start trial button is too small compared to everything around it.'],
    output: patchOutput({
      summary: 'Trying a larger Start trial button', reason: 'The current topic is the visible Start trial button.',
      elementId: 'start-trial', kind: 'set_size', value: 'lg', basis: ['explicit_label', 'recent_referent'],
      explanation: 'The discussion names the visible Start trial button.', currentTopic: 'Start trial button',
    }),
    acceptableOutcomes: ['preview_patch_visible'],
  },
  negation: {
    route: '/signup',
    leadingTurns: ['The Start trial button is our main call to action.'],
    output: observe('Leaving the Start trial button alone', 'The speaker ruled out making the button bigger.'),
    acceptableOutcomes: ['no_experiment'],
  },
  quotation: {
    route: '/signup',
    output: observe('Noting old customer feedback', 'The red suggestion is quoted feedback the team rejected.'),
    acceptableOutcomes: ['no_experiment'],
  },
  ambiguity: {
    route: '/signup',
    output: clarifyOutput({
      summary: 'Asking which button is meant', reason: 'Two visible buttons are equally plausible.',
      question: 'Which button should be bigger?', candidateElementIds: ['start-trial', 'explore-sample'],
      pendingPatch: { kind: 'set_size', value: 'lg' },
    }),
    acceptableOutcomes: ['clarification_shown'],
  },
  correction: {
    route: '/signup',
    preconditions: ['visible_size_experiment'],
    preTurn: 'The Start trial button is too small. What if it were bigger?',
    preOutput: patchOutput({
      summary: 'Trying a larger Start trial button', reason: 'The topic is the visible Start trial button.',
      elementId: 'start-trial', kind: 'set_size', value: 'lg', basis: ['explicit_label'],
      explanation: 'The discussion names the visible Start trial button.', currentTopic: 'Start trial button',
    }),
    output: patchOutput({
      summary: 'Trying a smaller Start trial button', reason: 'A correction to the size experiment that is currently visible.',
      elementId: 'start-trial', kind: 'set_size', value: 'md', basis: ['recent_referent'],
      explanation: 'The correction refers to the size experiment just applied.', currentTopic: 'Start trial button',
    }),
    acceptableOutcomes: ['undo_or_smaller_patch'],
  },
  structural: {
    route: '/tasks',
    output: prototypeOutput({
      summary: 'Prototyping an overdue-only filter', reason: 'The team asked for an overdue filter over the sample task table.',
      brief: 'Add a client-side overdue-only toggle to the sample task table using the synthetic due dates.',
      relevantSourcePaths: ['src/pages/Tasks.tsx'],
      constraints: ['Use existing components', 'Keep the backend unchanged'],
      mockedIntegrations: ['Task records and due dates are synthetic'], currentTopic: 'Sample task table',
    }),
    acceptableOutcomes: ['job_ready'],
  },
  pause: {
    route: '/signup',
    preconditions: ['paused'],
    // Deliberately actionable: the deterministic gate, not the planner, must refuse it while paused.
    output: patchOutput({
      summary: 'Trying a red Start trial button', reason: 'A colour suggestion about the visible Start trial button.',
      elementId: 'start-trial', kind: 'set_background', value: 'red', basis: ['explicit_label'],
      explanation: 'The discussion names the visible Start trial button.',
    }),
    acceptableOutcomes: ['no_experiment'],
  },
  from_zero: {
    route: '/',
    preconditions: ['blank_template'],
    output: prototypeOutput({
      summary: 'Prototyping an operations request list', reason: 'The scoped idea is complete: list, owners, status, urgent filter.',
      brief: 'Create an operations request list showing owner and status, with an urgent-only filter, using mock requests.',
      relevantSourcePaths: [],
      constraints: ['Use the preinstalled template components', 'No backend'],
      mockedIntegrations: ['Request records are synthetic'], currentTopic: 'Operations request list',
    }),
    acceptableOutcomes: ['job_ready'],
  },
  late_result: {
    route: '/tasks',
    preconditions: ['running_job'],
    preTurn: 'We should be able to filter overdue tasks. Example dates are fine.',
    preOutput: prototypeOutput({
      summary: 'Prototyping an overdue-only filter', reason: 'The team asked for an overdue filter.',
      brief: 'Add a client-side overdue-only toggle to the sample task table using the synthetic due dates.',
      relevantSourcePaths: ['src/pages/Tasks.tsx'],
      constraints: ['Use existing components'],
      mockedIntegrations: ['Task records and due dates are synthetic'],
    }),
    // The new direction lands while the first job is still running; both target the same workspace.
    output: prototypeOutput({
      summary: 'Prototyping an owner filter instead', reason: 'A newer direction replaces the overdue filter.',
      brief: 'Filter the sample task table by owner instead of overdue, keeping the synthetic records.',
      relevantSourcePaths: ['src/pages/Tasks.tsx'],
      constraints: ['Use existing components'],
      mockedIntegrations: ['Task records and owners are synthetic'],
    }),
    acceptableOutcomes: ['job_superseded'],
  },
  production: {
    route: '/signup',
    output: observe('Not deploying anything', 'Deployment is outside the demo scope and is never inferred from speech.'),
    acceptableOutcomes: ['no_experiment'],
  },
};

// ── observation builders ──────────────────────────────────────────────
function transcript(id: string, text: string, sequence: number, offsetMs: number): TranscriptObservation {
  return {
    id, sessionId: FIXTURE_SESSION, captureEpoch: FIXTURE_EPOCH, capturedAt: at(offsetMs), version: 1,
    kind: 'transcript', phase: 'final', providerItemId: `fixture-item-${id}`, audioTurnSequence: sequence,
    orderReliable: true, streamId: 'room-microphone', text, speaker: { label: null, verified: false },
  };
}

function previewContext(id: string, route: string, elements: PreviewElement[]): PreviewContextObservation {
  return {
    id, sessionId: FIXTURE_SESSION, captureEpoch: FIXTURE_EPOCH, capturedAt: at(0), version: 1,
    kind: 'preview_context', workspaceId: DEMO_WORKSPACE.workspaceId, revision: { source: 1, config: 0 },
    route, viewport: { width: 1280, height: 800 }, elements, focusId: null, hover: null, selection: null,
  };
}

/** Fixtures are authored against placeholder ids; a replay run retargets them to the live session. */
export function retargetObservation<T extends Observation>(observation: T, sessionId: string, captureEpoch: string): T {
  return { ...observation, sessionId, captureEpoch };
}

function buildFixture(entry: ScenarioEntry): ScenarioFixture {
  const definition = DEFINITIONS[entry.id];
  if (!definition) throw new Error(`scenarios.json has no fixture definition for "${entry.id}"`);
  const elements = DEMO_WORKSPACE.routes[definition.route] ?? [];
  const spoken = [...(definition.leadingTurns ?? []), entry.utterance];
  return {
    id: entry.id,
    expected: entry.expected,
    note: entry.note,
    route: definition.route,
    elements,
    preconditions: definition.preconditions ?? [],
    preTurns: definition.preTurn ? [transcript(`scn-${entry.id}-pre`, definition.preTurn, 1, 1000)] : [],
    preOutput: definition.preOutput ?? null,
    turns: spoken.map((text, index) => transcript(`scn-${entry.id}-t${index + 1}`, text, index + 2, 2000 + index * 1000)),
    contextObservation: previewContext(`scn-${entry.id}-ctx`, definition.route, elements),
    fixtureOutput: definition.output,
    acceptableOutcomes: definition.acceptableOutcomes,
  };
}

export function loadScenarioFixtures(scenariosPath: string = SCENARIOS_PATH): ScenarioFixture[] {
  const entries = JSON.parse(readFileSync(scenariosPath, 'utf8')) as ScenarioEntry[];
  return entries.map(buildFixture);
}

/** Replay table for FixturePlanner: newest new-turn id → scripted output. */
export function scenarioPlannerTable(fixtures: readonly ScenarioFixture[] = loadScenarioFixtures()): Map<string, PlannerOutput> {
  const table = new Map<string, PlannerOutput>();
  for (const fixture of fixtures) {
    const lastPre = fixture.preTurns.at(-1);
    if (lastPre && fixture.preOutput) table.set(lastPre.id, fixture.preOutput);
    const lastTurn = fixture.turns.at(-1);
    if (lastTurn) table.set(lastTurn.id, fixture.fixtureOutput);
  }
  return table;
}
