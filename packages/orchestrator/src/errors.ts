export type OrchestratorErrorCode =
  | 'session_not_found'
  | 'project_not_allowed'
  | 'invalid_state'
  | 'clarification_mismatch'
  | 'experiment_not_found'
  | 'job_not_found'
  | 'engine_failed'
  | 'planner_failed'
  | 'validation_failed';

const STATUS: Record<OrchestratorErrorCode, number> = {
  session_not_found: 404,
  project_not_allowed: 403,
  invalid_state: 409,
  clarification_mismatch: 409,
  experiment_not_found: 404,
  job_not_found: 404,
  engine_failed: 502,
  planner_failed: 502,
  validation_failed: 400,
};

export class OrchestratorError extends Error {
  readonly status: number;

  constructor(readonly code: OrchestratorErrorCode, message: string) {
    super(message);
    this.name = 'OrchestratorError';
    this.status = STATUS[code];
  }
}
