import type { Rule } from '../gate';

export const dedupe: Rule = ({ proposal, hasDedupeKey, dedupeKey }) => {
  if (proposal.kind === 'observe' || proposal.kind === 'hold') return null;
  if (!hasDedupeKey(dedupeKey)) return null;
  return { code: 'duplicate', reason: 'same request already handled for these observations' };
};
