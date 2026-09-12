import type { IngestReport, Observation } from '@fork/contracts';
import type { SessionRecord, StateStore } from '@fork/state';
import type { Clock } from '../clock';

export interface IngestDeps {
  store: StateStore;
  clock: Clock;
}

const isStaleForResume = (session: SessionRecord, o: Observation): boolean =>
  o.kind === 'transcript'
  && session.resumedAt !== null
  && new Date(o.capturedAt).getTime() < new Date(session.resumedAt).getTime();

function ingestOne(deps: IngestDeps, session: SessionRecord, o: Observation, report: IngestReport): IngestReport {
  if (o.captureEpoch !== session.captureEpoch) return { ...report, staleEpoch: [...report.staleEpoch, o.id] };
  if (o.kind === 'transcript' && o.phase === 'partial') return { ...report, ignoredPartials: report.ignoredPartials + 1 };
  if (!deps.store.insertObservation(o, deps.clock.nowIso())) return { ...report, duplicates: [...report.duplicates, o.id] };
  if (o.kind === 'transcript' && o.supersedesObservationId) deps.store.markSuperseded(o.supersedesObservationId, o.id);
  if (o.kind === 'transcript' && (session.capture !== 'listening' || isStaleForResume(session, o))) {
    deps.store.setPlanStatus([o.id], 'skipped', null);
  }
  // Screen context is evidence about what was displayed; it never queues planning on its own.
  if (o.kind === 'preview_context') deps.store.setPlanStatus([o.id], 'planned', null);
  return { ...report, accepted: report.accepted + 1 };
}

/** Store-only ingestion, idempotent by observation id. The caller decides whether to touch the settle window. */
export function ingestBatch(deps: IngestDeps, session: SessionRecord, observations: readonly Observation[]): IngestReport {
  const empty: IngestReport = { accepted: 0, duplicates: [], staleEpoch: [], ignoredPartials: 0 };
  return deps.store.transaction(() => observations.reduce((report, o) => ingestOne(deps, session, o, report), empty));
}
