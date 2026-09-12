/** Synthetic design examples, not a recorded/live run. */
import type {
  TranscriptObservation, PreviewContextObservation, PlannerProposal, PrototypeJob,
} from './contracts.v2.js';

export const page: PreviewContextObservation = {
  id: 'ctx-1', sessionId: 'meeting-1', captureEpoch: 'capture-1',
  version: 1, capturedAt: '2026-09-12T15:00:00Z', kind: 'preview_context',
  workspaceId: 'demo-1', revision: { source: 1, config: 0 }, route: '/signup',
  viewport: { width: 1280, height: 800 }, focusId: null, hover: null, selection: null,
  elements: [{
    id: 'start-trial', role: 'button', label: 'Start trial', section: 'Signup',
    visible: true, box: { x: 440, y: 500, width: 150, height: 40 },
    editable: ['size', 'background', 'label', 'radius'],
  }],
};
export const speech: TranscriptObservation = {
  id: 'speech-1', sessionId: 'meeting-1', captureEpoch: 'capture-1',
  version: 1, capturedAt: '2026-09-12T15:00:01Z', kind: 'transcript', phase: 'final',
  providerItemId: 'synthetic-audio-item-1', audioTurnSequence: 1, orderReliable: true,
  streamId: 'room-microphone', speaker: { label: null, verified: false },
  text: 'The Start trial button is too small. What if it were bigger?',
};
export const inferredExperiment: PlannerProposal = {
  id: 'intent-1', sessionId: 'meeting-1', captureEpoch: 'capture-1',
  sourceObservationIds: ['speech-1', 'ctx-1'],
  expectedRevision: { source: 1, config: 0 },
  summary: 'Try a larger Start trial button', kind: 'preview_patch',
  patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' },
  targetEvidence: {
    contextObservationId: 'ctx-1', elementId: 'start-trial',
    basis: ['explicit_label', 'recent_referent'],
    explanation: 'The current discussion names the visible Start trial button.',
  },
};
export const structuralJob: PrototypeJob = {
  id: 'job-2', experimentId: 'experiment-2', sessionId: 'meeting-1',
  workspaceId: 'demo-1', intentId: 'intent-2', expectedRevision: { source: 1, config: 1 },
  brief: 'Add a client-side overdue-only toggle to the sample task table.',
  relevantSources: [], // empty in this synthetic example, not invented evidence
  constraints: ['Use existing components', 'Keep backend unchanged'],
  mockedIntegrations: ['Task records and due dates are synthetic'],
  mode: 'demo_only', verification: 'compile_and_render',
};
