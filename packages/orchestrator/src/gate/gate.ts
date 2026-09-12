import type { PlannerProposal } from '@fork/contracts';
import type { SessionRecord, StoredExperiment, StoredObservation } from '@fork/state';
import type { OrchestratorConfig } from '../config';
import { RULES } from './rules';

export type GateCode =
  | 'session_disabled'
  | 'source_not_final'
  | 'source_superseded'
  | 'source_wrong_epoch'
  | 'source_missing'
  | 'target_missing'
  | 'target_hidden'
  | 'target_not_editable'
  | 'target_mismatch'
  | 'operation_not_permitted'
  | 'no_workspace'
  | 'path_not_allowed'
  | 'size_bounds'
  | 'duplicate'
  | 'revision_mismatch'
  | 'stale_context'
  | 'undo_not_applicable'
  | 'candidates_invalid';

export interface GateViolation {
  code: GateCode;
  reason: string;
}

export interface GateInput {
  proposal: PlannerProposal;
  session: SessionRecord;
  config: OrchestratorConfig;
  /** Every source observation id → its stored row. A missing entry is a missing observation. */
  observations: ReadonlyMap<string, StoredObservation>;
  experiments: readonly StoredExperiment[];
  hasDedupeKey: (key: string) => boolean;
  dedupeKey: string;
}

export type GateResult = { allowed: true; dedupeKey: string } | ({ allowed: false } & GateViolation);
export type Rule = (input: GateInput) => GateViolation | null;

export const MUTATING_KINDS: ReadonlySet<PlannerProposal['kind']> = new Set([
  'preview_patch', 'prototype_change', 'undo', 'clarify', 'pause',
]);

/** Deterministic post-inference checks. Model certainty is never an input. First violation wins. */
export function runGate(input: GateInput): GateResult {
  for (const rule of RULES) {
    const violation = rule(input);
    if (violation) return { allowed: false, ...violation };
  }
  return { allowed: true, dedupeKey: input.dedupeKey };
}
