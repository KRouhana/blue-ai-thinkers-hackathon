import { MUTATING_KINDS, type Rule } from '../gate';

export const sessionEnabled: Rule = ({ proposal, session }) => {
  if (!MUTATING_KINDS.has(proposal.kind)) return null;
  if (session.capture !== 'listening') return { code: 'session_disabled', reason: `capture is ${session.capture}` };
  if (!session.prototypeAutonomyEnabled) {
    return { code: 'session_disabled', reason: 'prototype autonomy not enabled by host' };
  }
  return null;
};
