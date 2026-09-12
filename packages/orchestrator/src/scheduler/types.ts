import type { PreviewPatch, PrototypeJob, Revision, SessionSnapshot } from '@fork/contracts';
import type { PrototypeEngine } from '@fork/contracts';
import type { StateStore } from '@fork/state';
import type { Clock } from '../clock';
import type { OrchestratorConfig } from '../config';
import type { EventBus } from '../events/event-bus';
import type { Logger } from '../logger';

export type WorkItem =
  | {
      kind: 'patch';
      sessionId: string;
      intentId: string;
      experimentId: string;
      targetKey: string;
      patch: PreviewPatch;
      expectedRevision: Revision;
    }
  | {
      kind: 'job';
      sessionId: string;
      intentId: string;
      experimentId: string;
      targetKey: string;
      job: PrototypeJob;
    }
  | {
      kind: 'undo';
      sessionId: string;
      intentId: string | null;
      experimentId: string;
      targetKey: string;
      origin: 'inferred_experiment' | 'host_control';
    };

export interface SchedulerDeps {
  store: StateStore;
  bus: EventBus;
  engine: PrototypeEngine;
  clock: Clock;
  config: OrchestratorConfig;
  logger: Logger;
  /** Injected to avoid a circular import with session/snapshot.ts. */
  snapshotOf: (sessionId: string) => SessionSnapshot;
}

export interface RunContext {
  isSuperseded: (intentId: string | null) => boolean;
  signal: AbortSignal;
}
