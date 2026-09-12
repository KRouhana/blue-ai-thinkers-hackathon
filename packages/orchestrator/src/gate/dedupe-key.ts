import { createHash } from 'node:crypto';
import type { PlannerProposal } from '@fork/contracts';

function actionFingerprint(proposal: PlannerProposal): unknown {
  switch (proposal.kind) {
    case 'preview_patch':
      return ['patch', proposal.patch];
    case 'prototype_change':
      return ['job', proposal.brief];
    case 'undo':
      return ['undo', proposal.experimentId];
    case 'clarify':
      return ['clarify', [...proposal.candidates.map((candidate) => candidate.id)].sort()];
    default:
      return [proposal.kind];
  }
}

/** Stable across retries and source ordering: the same request from the same speech is handled once. */
export function dedupeKeyFor(sessionId: string, proposal: PlannerProposal): string {
  const material = JSON.stringify([sessionId, [...proposal.sourceObservationIds].sort(), actionFingerprint(proposal)]);
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

export const resolvedClarificationKey = (clarifyIntentId: string): string => `clarify:${clarifyIntentId}:resolved`;
