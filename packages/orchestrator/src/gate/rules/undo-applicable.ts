import type { Rule } from '../gate';

export const undoApplicable: Rule = ({ proposal, experiments }) => {
  if (proposal.kind !== 'undo') return null;
  const target = experiments.find((experiment) => experiment.id === proposal.experimentId);
  if (target && target.status === 'visible' && target.checkpointId) return null;
  return { code: 'undo_not_applicable', reason: 'no visible experiment with a checkpoint to revert' };
};
