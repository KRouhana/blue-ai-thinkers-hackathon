import type { StoredObservation } from '@fork/state';

const seqOf = (o: StoredObservation): number =>
  o.observation.kind === 'transcript' && o.observation.audioTurnSequence !== null
    ? o.observation.audioTurnSequence
    : Number.MAX_SAFE_INTEGER;

const reliable = (o: StoredObservation): boolean =>
  o.observation.kind === 'transcript' && o.observation.orderReliable && o.observation.audioTurnSequence !== null;

/** Audio order when every turn is reliable; otherwise network arrival order. Never invents a sequence. */
export function orderTurns(turns: readonly StoredObservation[]): StoredObservation[] {
  const byAudio = turns.length > 0 && turns.every(reliable);
  return [...turns].sort((a, b) => (byAudio ? seqOf(a) - seqOf(b) : a.receivedSeq - b.receivedSeq));
}

export function lastTurns(turns: readonly StoredObservation[], limit: number): StoredObservation[] {
  return turns.slice(Math.max(0, turns.length - limit));
}
