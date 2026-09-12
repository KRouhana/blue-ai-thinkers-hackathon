import type { PlannerProposal } from '@fork/contracts';
import type { StoredExperiment } from '@fork/state';

/** Edits that compete for the same thing share a key, which is what coalescing keys off. */
export function targetKeyFor(
  proposal: PlannerProposal,
  workspaceId: string | null,
  experiments: readonly StoredExperiment[],
): string {
  switch (proposal.kind) {
    case 'preview_patch':
      return `element:${proposal.patch.elementId}`;
    case 'prototype_change':
      return `job:${workspaceId ?? 'none'}`;
    case 'undo':
      return experiments.find((experiment) => experiment.id === proposal.experimentId)?.targetKey ?? `undo:${proposal.experimentId}`;
    default:
      return `none:${proposal.kind}`;
  }
}
