import type { Rule } from '../gate';

export const sourcesFinalized: Rule = ({ proposal, session, observations }) => {
  for (const id of proposal.sourceObservationIds) {
    const stored = observations.get(id);
    if (!stored) return { code: 'source_missing', reason: `observation ${id} not found` };
    if (stored.observation.captureEpoch !== session.captureEpoch) {
      return { code: 'source_wrong_epoch', reason: `observation ${id} belongs to an older capture` };
    }
    if (stored.supersededBy) {
      return { code: 'source_superseded', reason: `observation ${id} was corrected by ${stored.supersededBy}` };
    }
    if (stored.observation.kind === 'transcript' && stored.observation.phase !== 'final') {
      return { code: 'source_not_final', reason: `observation ${id} is a caption delta` };
    }
  }
  return null;
};
