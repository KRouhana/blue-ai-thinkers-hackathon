import type { EditableProperty, PreviewPatch, Revision, SessionSnapshot } from '@fork/contracts';
import type { PlannerOutput } from './output-schema';

export type CaptureState = SessionSnapshot['capture'];

export interface PlanningElement {
  id: string;
  role: string;
  label: string;
  section: string | null;
  visible: boolean;
  editable: EditableProperty[];
}

export interface PlanningScreen {
  observationId: string;
  route: string;
  revision: Revision;
  focusId: string | null;
  hoverId: string | null;
  selectionId: string | null;
  elements: PlanningElement[];
}

/** Everything the planner is allowed to see. No raw files, no whole DOM, no hidden history. */
export interface PlanningContext {
  session: {
    id: string;
    captureEpoch: string;
    capture: CaptureState;
    prototypeAutonomyEnabled: boolean;
    revision: Revision;
    currentTopic: string | null;
  };
  /** Finalized turns eligible to cause an action. */
  newTurns: Array<{ id: string; text: string; audioTurnSequence: number | null }>;
  /** Older turns, for reference resolution only. */
  recentTurns: Array<{ id: string; text: string }>;
  context: PlanningScreen | null;
  visibleExperiments: Array<{ id: string; summary: string; targetKey: string; patch: PreviewPatch | null }>;
  pendingClarification: { intentId: string; question: string; candidates: Array<{ id: string; label: string }> } | null;
  repoMap: {
    framework: string;
    verified: boolean;
    routes: string[];
    relevantSources: string[];
    mockCapabilities: string[];
    limitations: string[];
  } | null;
  companyNotes: Array<{ path: string; excerpt: string }>;
  repoExcerpts: Array<{ path: string; excerpt: string }>;
}

export interface Planner {
  readonly label: 'live' | 'fixture';
  plan(context: PlanningContext): Promise<PlannerOutput>;
}
