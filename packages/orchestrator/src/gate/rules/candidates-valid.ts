import type { Rule } from '../gate';

export const candidatesValid: Rule = ({ proposal, observations }) => {
  if (proposal.kind !== 'clarify') return null;
  const visible = new Set(
    [...observations.values()]
      .map((stored) => stored.observation)
      .filter((observation) => observation.kind === 'preview_context')
      .flatMap((observation) => observation.elements.filter((element) => element.visible).map((element) => element.id)),
  );
  const ghost = proposal.candidates.find((candidate) => !visible.has(candidate.id));
  if (!ghost) return null;
  return { code: 'candidates_invalid', reason: `candidate ${ghost.id} is not a visible element` };
};
