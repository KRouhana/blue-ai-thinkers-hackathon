import type { PrototypeEngine } from '@fork/contracts';
import type { StateStore } from '@fork/state';
import type { Clock } from './clock';
import type { OrchestratorConfig } from './config';
import type { EventBus } from './events/event-bus';
import type { Logger } from './logger';
import type { Planner } from './planner/planner';
import type { CompanyDoc } from './retrieval/company-docs';
import type { Scheduler } from './scheduler/scheduler';
import type { SessionService } from './session/session-service';

/** Server-side project allowlist. A client may reference an id; it may never supply a path. */
export interface ProjectConfig {
  id: string;
  label: string;
  mode: 'blank_template' | 'existing_repo';
  workspaceRoot: string | null;
}

export interface RuntimeDeps {
  store: StateStore;
  engine: PrototypeEngine;
  planner: Planner;
  bus: EventBus;
  scheduler: Scheduler;
  sessions: SessionService;
  clock: Clock;
  config: OrchestratorConfig;
  logger: Logger;
  projects: readonly ProjectConfig[];
  companyDocs: readonly CompanyDoc[];
}

export const projectFor = (projects: readonly ProjectConfig[], id: string): ProjectConfig | undefined =>
  projects.find((project) => project.id === id);
