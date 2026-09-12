export { createOrchestrator, type Orchestrator, type OrchestratorDeps } from './orchestrator';
export { OrchestratorError, type OrchestratorErrorCode } from './errors';
export { DEFAULT_CONFIG, resolveConfig, type OrchestratorConfig } from './config';
export { fixedClock, steppingClock, systemClock, type Clock } from './clock';
export { consoleLogger, silentLogger, type Logger } from './logger';
export { type ProjectConfig } from './runtime';

export { LlmPlanner, type LlmPlannerOptions, type StructuredGenerate } from './planner/llm-planner';
export { resolvePlannerModel, type PlannerProvider, type ResolvedPlannerModel } from './planner/model';
export { plannerOutputSchema, type PlannerOutput } from './planner/output-schema';
export { SYSTEM_PROMPT, renderUserPrompt } from './planner/prompt';
export type { Planner, PlanningContext, PlanningElement, PlanningScreen } from './planner/planner';

export { loadCompanyDocs, retrieveCompanyNotes, type CompanyDoc } from './retrieval/company-docs';
export { readRepoExcerpts } from './retrieval/repo-files';

export { buildSnapshot } from './session/snapshot';
export { runGate, type GateCode, type GateInput, type GateResult } from './gate/gate';
export { dedupeKeyFor, resolvedClarificationKey } from './gate/dedupe-key';
