import type { SessionClient, SessionSnapshot, SessionEvent, SessionControl, ExperimentRecord, WorkerProgress } from './types';

const clone = <T>(value: T): T => structuredClone(value);
export function getFixturePreviewConfig(snapshot: SessionSnapshot) {
  const visible = (id: string) => snapshot.experiments.some(item => item.id === id && item.status === 'visible');
  return { type: 'fork.preview.load-config' as const, workspaceId: snapshot.workspaceId, revision: snapshot.revision,
    config: { buttonSize: visible('fixture-size') ? 'xl' : 'md', buttonColor: visible('fixture-correction') ? 'red' : 'blue', overdueEnabled: visible('fixture-filter') } };
}

/** Deterministic UI fixtures only. No microphone, model, Codex, or meeting connection. */
export function createFixtureClient(): SessionClient & { advanceScenario(): void } {
  let state: SessionSnapshot = {
    id: 'fixture-session', captureEpoch: 'fixture-epoch-0', capture: 'stopped', prototypeAutonomyEnabled: false,
    workspaceId: 'fixture-workspace', revision: { source: 0, config: 0 },
    previewUrl: 'http://127.0.0.1:4173/', currentTopic: 'Fixture: a task board for a small team',
    lastEventSequence: 0, experiments: [], clarification: null,
  };
  let step = 0, epoch = 0;
  let job: WorkerProgress | null = null;
  const events: SessionEvent[] = [];
  const listeners = new Set<(event: SessionEvent) => void>();
  const requireSession = (id: string) => { if (id !== state.id) throw new Error('Fixture session not found. Open a new fixture session.'); };
  function emit(payload: SessionEvent['payload']) {
    state.lastEventSequence++;
    const event: SessionEvent = { id: `fixture-event-${state.lastEventSequence}`, sessionId: state.id, sequence: state.lastEventSequence, at: new Date().toISOString(), payload: clone(payload) };
    if (event.payload.kind === 'snapshot') event.payload.snapshot.lastEventSequence = event.sequence;
    events.push(event);
    for (const receive of listeners) receive(clone(event));
  }
  function publish() { emit({ kind: 'snapshot', snapshot: state }); if (job) emit({ kind: 'job', progress: job }); }
  function status(message: string) { emit({ kind: 'status', message: `Fixture · ${message}` }); }
  function updateExperiment(id: string, summary: string, structural = false) {
    state.revision = { source: state.revision.source + Number(structural), config: state.revision.config + Number(!structural) };
    const experiment: ExperimentRecord = { id, intentId: `${id}-intent`, status: 'visible', summary: `Fixture: ${summary}`, origin: 'inferred_experiment', sourceObservationIds: [], revision: clone(state.revision), checkpointId: `${id}-checkpoint`, mockNotes: ['Prepared mock data; no real service, model, or code generation.'] };
    state.experiments = [...state.experiments.filter(item => item.id !== id), experiment];
    publish();
    status(summary);
  }
  async function control(id: string, action: SessionControl) {
    requireSession(id);
    if (action.kind === 'pause' || action.kind === 'resume' || action.kind === 'stop') {
      state.capture = action.kind === 'resume' ? 'listening' : action.kind === 'pause' ? 'paused' : 'stopped';
      state.prototypeAutonomyEnabled = action.kind === 'resume';
      if (action.kind !== 'resume') {
        state.captureEpoch = `fixture-epoch-${++epoch}`;
        if (job && ['queued', 'running', 'checking'].includes(job.state)) job = { ...job, state: 'cancelled', message: 'Fixture build cancelled by session control.' };
      }
      publish(); status(`Session ${state.capture}.`); return;
    }
    if (action.kind === 'undo') {
      const experiment = state.experiments.find(item => item.id === action.experimentId && item.status === 'visible');
      if (!experiment) throw new Error('This fixture experiment is not available to undo.');
      state.revision = { ...state.revision, config: state.revision.config + 1 };
      state.experiments = state.experiments.map(item => item.id === experiment.id ? { ...item, status: 'reverted', revision: clone(state.revision) } : item);
      publish(); status('Experiment reverted.'); return;
    }
    if (action.kind === 'cancel_job') {
      if (!job || job.jobId !== action.jobId || !['queued', 'running', 'checking'].includes(job.state)) throw new Error('No matching active fixture build.');
      job = { ...job, state: 'cancelled', message: 'Fixture build cancelled; existing preview retained.' };
      emit({ kind: 'job', progress: job }); return;
    }
    if (action.kind === 'clarification_answer') {
      if (!state.clarification || state.clarification.intentId !== action.intentId || !state.clarification.candidates.some(item => item.id === action.candidateId)) throw new Error('This fixture clarification is no longer available.');
      const choice = state.clarification.candidates.find(item => item.id === action.candidateId)!;
      state.clarification = null; publish(); status(`Clarification received: ${choice.label}.`);
    }
  }
  return {
    create: async () => clone(state),
    snapshot: async id => { requireSession(id); return clone(state); },
    control,
    capture: async (id, action) => {
      requireSession(id);
      if (action === 'start') { state.capture = 'listening'; state.captureEpoch = `fixture-epoch-${++epoch}`; state.prototypeAutonomyEnabled = true; publish(); status('Scenario enabled. No microphone is recording. Use Next fixture event.'); }
      else await control(id, { kind: action });
    },
    observe: async (id, observations) => {
      requireSession(id);
      if (observations.some(item => item.sessionId !== id || item.captureEpoch !== state.captureEpoch)) throw new Error('Stale fixture observation.');
      // Preview context is accepted solely to exercise D’s adapter boundary.
    },
    subscribe: (id, after, receive, connection) => {
      requireSession(id); connection('connected');
      for (const event of events) if (event.sequence > after) receive(clone(event));
      listeners.add(receive);
      return () => { listeners.delete(receive); };
    },
    advanceScenario() {
      if (state.capture !== 'listening') { status('Start or resume the fixture session before advancing.'); return; }
      switch (step++) {
        case 0: status('Small talk: “How was your weekend?” No prototype change.'); break;
        case 1: updateExperiment('fixture-size', 'Trying a larger Start trial button'); break;
        case 2: updateExperiment('fixture-correction', 'Correction: make the Start trial button red'); break;
        case 3: job = { jobId: 'fixture-filter-job', state: 'running', message: 'Fixture: building an overdue filter with mock tasks.' }; emit({ kind: 'job', progress: job }); break;
        case 4: if (job?.state === 'running') { job = { ...job, state: 'checking', message: 'Fixture: simulated compile and render checks.' }; emit({ kind: 'job', progress: job }); } else status('Cancelled build stays cancelled.'); break;
        case 5: if (job?.state === 'checking') { job = { ...job, state: 'ready', message: 'Fixture: prepared overdue filter is visible; no Codex build was run.' }; updateExperiment('fixture-filter', 'Added an overdue filter using prepared mock data', true); } else status('Cancelled build was not applied.'); break;
        case 6:
          state.clarification = { intentId: 'fixture-clarification', question: 'Fixture: which button should change?', candidates: [{ id: 'trial', label: 'Start trial' }, { id: 'invite', label: 'Invite teammate' }] };
          emit({ kind: 'clarification', ...state.clarification }); break;
        case 7: job = { jobId: 'fixture-failed-job', state: 'failed', message: 'Fixture: simulated build failed. Last working preview retained.' }; emit({ kind: 'job', progress: job }); emit({ kind: 'error', code: 'FIXTURE_BUILD_FAILED', message: 'Simulated build failure. Your last working demo is still available.' }); break;
        default: status('Scenario complete. Try Undo, Pause, or Stop; reload the page to reset fixtures.');
      }
    },
  };
}
