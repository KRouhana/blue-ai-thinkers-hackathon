import type { Revision } from '@fork/contracts';
import type { Rule } from '../gate';

const same = (a: Revision, b: Revision): boolean => a.source === b.source && a.config === b.config;

export const revisionMatch: Rule = ({ proposal, session, observations }) => {
  if (proposal.kind === 'observe' || proposal.kind === 'hold') return null;
  if (!same(proposal.expectedRevision, session.revision)) {
    return { code: 'revision_mismatch', reason: 'preview changed since this suggestion was planned' };
  }
  if (proposal.kind !== 'preview_patch') return null;
  const cited = observations.get(proposal.targetEvidence.contextObservationId)?.observation;
  if (cited?.kind === 'preview_context' && !same(cited.revision, session.revision)) {
    return { code: 'stale_context', reason: 'cited screen context predates the current preview revision' };
  }
  return null;
};
