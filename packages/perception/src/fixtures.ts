import type { Observation, ObservationSink } from './contracts.js';
import type { TranscriptionEvent, TranscriptionSession } from './types.js';

/** Deliberate test/dev adapter; production wiring never falls back to this. */
export class FixtureTranscriptionSession implements TranscriptionSession {
  private readonly listeners = new Set<(event: TranscriptionEvent) => void>();
  readonly appendedAudio: Int16Array[] = [];
  commits = 0;
  connected = false;
  closed = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  appendPcm24(audio: Int16Array): void {
    this.appendedAudio.push(audio);
  }

  commitAudio(): void {
    this.commits += 1;
  }

  subscribe(listener: (event: TranscriptionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  emit(event: TranscriptionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export function recordingSink(): { sink: ObservationSink; observations: Observation[] } {
  const observations: Observation[] = [];
  return {
    observations,
    sink: async (items) => { observations.push(...items); },
  };
}
