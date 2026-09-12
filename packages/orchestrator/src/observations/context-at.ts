import type { StoredObservation } from '@fork/state';

const ms = (iso: string): number => new Date(iso).getTime();

/** The preview snapshot that was valid when the speech occurred — not whatever is newest now. */
export function selectContextAt(
  contexts: readonly StoredObservation[],
  speechAt: string,
  lookbackMs: number,
): StoredObservation | null {
  const at = ms(speechAt);
  const before = contexts.filter((c) => ms(c.observation.capturedAt) <= at);
  if (before.length > 0) {
    return before.reduce((latest, c) => (ms(c.observation.capturedAt) >= ms(latest.observation.capturedAt) ? c : latest));
  }
  const soonAfter = contexts.filter((c) => ms(c.observation.capturedAt) - at <= lookbackMs);
  if (soonAfter.length === 0) return null;
  return soonAfter.reduce((earliest, c) => (ms(c.observation.capturedAt) < ms(earliest.observation.capturedAt) ? c : earliest));
}
