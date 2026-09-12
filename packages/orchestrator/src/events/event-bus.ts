import type { OutputPayload, SessionEvent } from '@fork/contracts';
import type { StateStore } from '@fork/state';
import type { Clock } from '../clock';
import { newId } from '../ids';
import { silentLogger, type Logger } from '../logger';

type Listener = (event: SessionEvent) => void;

/** Persists every output event in order, then fans it out to this process's subscribers. */
export class EventBus {
  private listeners: ReadonlyMap<string, ReadonlySet<Listener>> = new Map();

  constructor(
    private readonly store: StateStore,
    private readonly clock: Clock,
    private readonly logger: Logger = silentLogger,
  ) {}

  publish(sessionId: string, payload: OutputPayload): SessionEvent {
    const event = this.store.appendEvent(sessionId, payload, this.clock.nowIso(), newId('evt'));
    for (const listener of this.listeners.get(sessionId) ?? []) {
      try {
        listener(event);
      } catch (error) {
        this.logger.warn('event listener failed', { sessionId, error: String(error) });
      }
    }
    return event;
  }

  subscribe(sessionId: string, listener: Listener): () => void {
    const current = this.listeners.get(sessionId) ?? new Set<Listener>();
    this.listeners = new Map(this.listeners).set(sessionId, new Set([...current, listener]));
    return () => {
      const remaining = new Set([...(this.listeners.get(sessionId) ?? [])].filter((entry) => entry !== listener));
      this.listeners = new Map(this.listeners).set(sessionId, remaining);
    };
  }
}
