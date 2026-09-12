import type { Rule } from '../gate';

export const sizeBounds: Rule = ({ proposal, config }) => {
  if (proposal.kind === 'preview_patch' && proposal.patch.kind === 'set_label' && proposal.patch.value.length > config.maxLabelChars) {
    return { code: 'size_bounds', reason: `label longer than ${config.maxLabelChars} characters` };
  }
  if (proposal.kind === 'prototype_change') {
    if (proposal.brief.length > config.maxBriefChars) {
      return { code: 'size_bounds', reason: `brief longer than ${config.maxBriefChars} characters` };
    }
    if (proposal.relevantSources.length > config.maxRelevantSources) {
      return { code: 'size_bounds', reason: 'too many relevant sources' };
    }
  }
  return null;
};
