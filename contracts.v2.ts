/**
 * Proposed Fork v2 application interfaces. These are NOT sponsor SDK APIs.
 * Compile-time starter only: B must add runtime validation and server-side auth.
 * No authority is granted by a field supplied by a browser, transcript, or model.
 */
export type Id = string;
export type IsoTime = string;
export type SizeToken = 'sm' | 'md' | 'lg' | 'xl';
export type ColorToken = 'neutral' | 'blue' | 'red' | 'green' | 'amber';
export type RadiusToken = 'none' | 'sm' | 'md' | 'pill';
export type EditableProperty = 'size' | 'background' | 'label' | 'radius' | 'visible';

export interface Revision {
  source: number;
  config: number;
}

export interface SourceRef {
  kind: 'repo' | 'document';
  path: string; // workspace-relative, never an unrestricted host path
  startLine?: number;
  endLine?: number;
  fingerprint: string; // actual commit or verified content hash
  excerpt?: string;
}

export interface PreviewElement {
  id: Id;
  role: string;
  label: string;
  section?: string;
  visible: boolean;
  box: { x: number; y: number; width: number; height: number };
  editable: EditableProperty[];
  source?: SourceRef; // only when mapped; never inferred as fact from the label
}

export interface ObservationBase {
  id: Id;
  sessionId: Id;
  captureEpoch: Id;
  capturedAt: IsoTime;
  version: number;
}

export interface TranscriptObservation extends ObservationBase {
  kind: 'transcript';
  phase: 'partial' | 'final';
  providerItemId: string;
  audioTurnSequence: number | null; // audio order, NOT response arrival order
  orderReliable: boolean;
  streamId: Id;
  text: string;
  supersedesObservationId?: Id;
  speaker: { label: string | null; verified: false };
}

export interface PreviewContextObservation extends ObservationBase {
  kind: 'preview_context';
  workspaceId: Id;
  revision: Revision;
  route: string;
  viewport: { width: number; height: number };
  elements: PreviewElement[];
  focusId: Id | null;
  hover: { elementId: Id; at: IsoTime } | null;
  selection: { elementId: Id; at: IsoTime } | null;
}

export type Observation = TranscriptObservation | PreviewContextObservation;

export interface RepoMap {
  workspaceId: Id;
  origin: 'blank_template' | 'existing_repo';
  fingerprint: string;
  framework: { name: string; verified: boolean };
  routes: Array<{ route: string; sources: SourceRef[] }>;
  relevantSources: SourceRef[];
  mockCapabilities: string[];
  limitations: string[];
}

export type PreviewPatch =
  | { kind: 'set_size'; elementId: Id; value: SizeToken }
  | { kind: 'set_background'; elementId: Id; value: ColorToken }
  | { kind: 'set_label'; elementId: Id; value: string }
  | { kind: 'set_radius'; elementId: Id; value: RadiusToken }
  | { kind: 'set_visibility'; elementId: Id; value: boolean };

export interface TargetEvidence {
  contextObservationId: Id;
  elementId: Id;
  basis: Array<'explicit_label' | 'recent_referent' | 'route' | 'focus' | 'hover' | 'selection'>;
  explanation: string; // short user-facing evidence, not private reasoning
}

export interface IntentBase {
  id: Id;
  sessionId: Id;
  captureEpoch: Id;
  sourceObservationIds: Id[];
  expectedRevision: Revision;
  summary: string;
}

export type PlannerProposal = IntentBase & (
  | { kind: 'observe' | 'hold'; reason: string }
  | { kind: 'clarify'; question: string; candidates: Array<{ id: Id; label: string }> }
  | { kind: 'preview_patch'; patch: PreviewPatch; targetEvidence: TargetEvidence }
  | { kind: 'prototype_change'; brief: string; relevantSources: SourceRef[];
      constraints: string[]; mockedIntegrations: string[] }
  | { kind: 'undo'; experimentId: Id }
  | { kind: 'pause' }
);

export type JobState = 'queued' | 'running' | 'checking' | 'ready' | 'failed' | 'cancelled' | 'superseded';

export interface PrototypeJob {
  id: Id;
  experimentId: Id;
  sessionId: Id;
  workspaceId: Id;
  intentId: Id;
  expectedRevision: Revision;
  brief: string;
  relevantSources: SourceRef[];
  constraints: string[];
  mockedIntegrations: string[];
  mode: 'demo_only';
  verification: 'compile_and_render';
}

export interface WorkerProgress {
  jobId: Id;
  state: JobState;
  message: string;
}

export interface RenderCheck {
  compile: 'passed' | 'failed' | 'not_checked';
  page: 'rendered' | 'failed' | 'not_checked';
  diagnostics: string[];
}

export interface PrototypeResult {
  jobId: Id;
  workspaceId: Id;
  state: 'ready' | 'failed' | 'cancelled' | 'superseded';
  basedOn: Revision;
  resultingRevision: Revision;
  checkpointId: Id | null;
  previewUrl: string | null; // a local URL is NOT public deployment
  changedFiles: string[];
  mockNotes: string[];
  check: RenderCheck;
}

/** Server-side config reference, NOT a client-supplied filesystem path. */
export interface PrepareRequest {
  sessionId: Id;
  projectConfigId: Id;
  mode: 'blank_template' | 'existing_repo';
}
export interface PreparedWorkspace {
  workspaceId: Id;
  revision: Revision;
  repoMap: RepoMap;
  previewUrl: string;
  renderState: 'starting' | 'rendered' | 'failed';
}

export interface PatchRequest {
  operationId: Id;
  sessionId: Id;
  workspaceId: Id;
  expectedRevision: Revision;
  patch: PreviewPatch;
}
export interface PatchResult {
  operationId: Id;
  applied: boolean;
  revision: Revision;
  checkpointId: Id | null;
  diagnostic?: string;
}

/** Adapter implemented by C; B validates and serializes calls. */
export interface PrototypeEngine {
  prepare(request: PrepareRequest): Promise<PreparedWorkspace>;
  applyPatch(request: PatchRequest): Promise<PatchResult>;
  runJob(job: PrototypeJob, progress: (event: WorkerProgress) => void,
    signal?: AbortSignal): Promise<PrototypeResult>;
  undo(request: { operationId: Id; workspaceId: Id; expectedRevision: Revision;
    checkpointId: Id }): Promise<PatchResult>;
  cancel(jobId: Id): Promise<{ accepted: boolean }>;
}

export interface ExperimentRecord {
  id: Id;
  intentId: Id;
  status: 'proposed' | 'applying' | 'visible' | 'reverted' | 'failed' | 'superseded';
  summary: string;
  origin: 'inferred_experiment' | 'host_control';
  sourceObservationIds: Id[];
  revision: Revision;
  checkpointId: Id | null;
  mockNotes: string[];
}

export interface SessionSnapshot {
  id: Id;
  captureEpoch: Id;
  capture: 'stopped' | 'listening' | 'paused';
  prototypeAutonomyEnabled: boolean;
  workspaceId: Id | null;
  revision: Revision;
  previewUrl: string | null;
  currentTopic: string | null;
  lastEventSequence: number;
  experiments: ExperimentRecord[];
  clarification: { intentId: Id; question: string;
    candidates: Array<{ id: Id; label: string }> } | null;
}

export type SessionControl =
  | { kind: 'pause' | 'resume' | 'stop' }
  | { kind: 'undo'; experimentId: Id }
  | { kind: 'cancel_job'; jobId: Id }
  | { kind: 'clarification_answer'; intentId: Id; candidateId: Id };

export type OutputPayload =
  | { kind: 'snapshot'; snapshot: SessionSnapshot }
  | { kind: 'experiment'; experiment: ExperimentRecord }
  | { kind: 'job'; progress: WorkerProgress }
  | { kind: 'status'; message: string }
  | { kind: 'clarification'; intentId: Id; question: string;
      candidates: Array<{ id: Id; label: string }> }
  | { kind: 'error'; code: string; message: string };

export interface SessionEvent {
  id: Id;
  sessionId: Id;
  sequence: number;
  at: IsoTime;
  payload: OutputPayload;
}

export type ObservationSink = (observations: Observation[]) => Promise<void>;
