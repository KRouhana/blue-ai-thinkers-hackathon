/**
 * Buildable structural mirror of the Track A slice in `contracts.v2.ts`.
 * It intentionally has no runtime import so this standalone package can build
 * before Track B publishes the shared contracts package. Structural typing
 * keeps its ObservationSink compatible with the shared v2 contract.
 */
export type EditableProperty = 'size' | 'background' | 'label' | 'radius' | 'visible';

export interface Revision {
  source: number;
  config: number;
}

export interface SourceRef {
  kind: 'repo' | 'document';
  path: string;
  startLine?: number;
  endLine?: number;
  fingerprint: string;
  excerpt?: string;
}

export interface PreviewElement {
  id: string;
  role: string;
  label: string;
  section?: string;
  visible: boolean;
  box: { x: number; y: number; width: number; height: number };
  editable: EditableProperty[];
  source?: SourceRef;
}

interface ObservationBase {
  id: string;
  sessionId: string;
  captureEpoch: string;
  capturedAt: string;
  version: number;
}

export interface TranscriptObservation extends ObservationBase {
  kind: 'transcript';
  phase: 'partial' | 'final';
  providerItemId: string;
  audioTurnSequence: number | null;
  orderReliable: boolean;
  streamId: string;
  text: string;
  supersedesObservationId?: string;
  speaker: { label: string | null; verified: false };
}

export interface PreviewContextObservation extends ObservationBase {
  kind: 'preview_context';
  workspaceId: string;
  revision: Revision;
  route: string;
  viewport: { width: number; height: number };
  elements: PreviewElement[];
  focusId: string | null;
  hover: { elementId: string; at: string } | null;
  selection: { elementId: string; at: string } | null;
}

export type Observation = TranscriptObservation | PreviewContextObservation;
export type ObservationSink = (observations: Observation[]) => Promise<void>;
