import type { Rule } from '../gate';

export const operationPermitted: Rule = ({ proposal, session, config }) => {
  if (proposal.kind === 'observe' || proposal.kind === 'hold') return null;
  if (!config.allowedOperations.includes(proposal.kind)) {
    return { code: 'operation_not_permitted', reason: `${proposal.kind} is disabled by configuration` };
  }
  const needsWorkspace = proposal.kind === 'prototype_change' || proposal.kind === 'preview_patch';
  if (needsWorkspace && !session.workspaceId) {
    return { code: 'no_workspace', reason: 'session has no prepared workspace' };
  }
  return null;
};
