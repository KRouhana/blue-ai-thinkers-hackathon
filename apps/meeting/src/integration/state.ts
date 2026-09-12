import type { SessionSnapshot, SessionEvent, WorkerProgress } from './types';
export interface WorkspaceState {
  snapshot: SessionSnapshot | null;
  job: WorkerProgress | null;
  jobKnown: boolean;
  message: string;
  error: string | null;
}
export const emptyState: WorkspaceState = { snapshot: null, job: null, jobKnown: false, message: 'Ready when your team is.', error: null };
export function reduceEvent(state: WorkspaceState, event: SessionEvent): WorkspaceState {
  const current = state.snapshot;
  if (current && event.sessionId !== current.id) return state;
  if (current && event.sequence <= current.lastEventSequence && event.payload.kind !== 'snapshot') return state;
  const payload = event.payload;
  if (payload.kind === 'snapshot') {
    if (payload.snapshot.id !== event.sessionId || payload.snapshot.lastEventSequence !== event.sequence) return state;
    if (current && event.sequence < current.lastEventSequence) return state;
    return { ...state, snapshot: payload.snapshot, job: null, jobKnown: false, error: null };
  }
  if (!current) return state;
  // A gap must be recovered by the transport, never guessed in the renderer.
  if (event.sequence !== current.lastEventSequence + 1) return state;
  const snapshot = { ...current, lastEventSequence: event.sequence };
  if (payload.kind === 'experiment') {
    snapshot.experiments = [...current.experiments.filter(e => e.id !== payload.experiment.id), payload.experiment];
  }
  if (payload.kind === 'clarification') snapshot.clarification = payload;
  return {
    ...state, snapshot,
    ...(payload.kind === 'job' ? { job: payload.progress, jobKnown: true } : {}),
    ...(payload.kind === 'status' ? { message: payload.message } : {}),
    ...(payload.kind === 'error' ? { error: payload.message } : {}),
  };
}
