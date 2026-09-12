import type {
  ExperimentRecord, JobState, Observation, PlannerProposal, PrototypeJob, PrototypeResult, Revision, SessionSnapshot,
} from '@fork/contracts';

export type CaptureState = SessionSnapshot['capture'];
export type PlanStatus = 'pending' | 'planned' | 'skipped' | 'failed';
export type GateStatus = 'allowed' | 'rejected' | 'superseded';

export interface StoredClarification {
  intentId: string;
  question: string;
  candidates: Array<{ id: string; label: string }>;
  route: string;
  contextObservationId: string;
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  projectConfigId: string;
  captureEpoch: string;
  capture: CaptureState;
  prototypeAutonomyEnabled: boolean;
  workspaceId: string | null;
  revision: Revision;
  previewUrl: string | null;
  currentTopic: string | null;
  clarification: StoredClarification | null;
  resumedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredObservation {
  observation: Observation;
  planStatus: PlanStatus;
  supersededBy: string | null;
  intentId: string | null;
  receivedSeq: number;
}

export type PendingPatchKind = 'set_size' | 'set_background' | 'set_label' | 'set_radius' | 'set_visibility';

export interface StoredIntent {
  proposal: PlannerProposal;
  gateStatus: GateStatus;
  gateReason: string | null;
  dedupeKey: string | null;
  /** For clarify intents: what to apply once a candidate is chosen. */
  pendingPatch: { kind: PendingPatchKind; value: string | boolean } | null;
  createdAt: string;
}

export interface StoredExperiment extends ExperimentRecord {
  sessionId: string;
  targetKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredJob {
  job: PrototypeJob;
  state: JobState;
  message: string;
  result: PrototypeResult | null;
  createdAt: string;
  updatedAt: string;
}
