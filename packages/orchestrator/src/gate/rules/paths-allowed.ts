import { isWorkspaceRelativePath } from '@fork/contracts';
import type { Rule } from '../gate';

export const pathsAllowed: Rule = ({ proposal }) => {
  if (proposal.kind !== 'prototype_change') return null;
  const outside = proposal.relevantSources.find((source) => !isWorkspaceRelativePath(source.path));
  if (!outside) return null;
  return { code: 'path_not_allowed', reason: `source path ${outside.path} is outside the workspace` };
};
