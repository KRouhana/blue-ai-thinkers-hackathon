import type { PlannerProposal, PreviewPatch, SizeToken } from '@fork/contracts';

const SIZE_ORDER: readonly SizeToken[] = ['sm', 'md', 'lg', 'xl'];

export const sizeIndex = (token: SizeToken): number => SIZE_ORDER.indexOf(token);

const isSizeToken = (value: string): value is SizeToken => (SIZE_ORDER as readonly string[]).includes(value);

function describeSize(value: SizeToken, label: string, previous: string | null): string {
  const bigger = previous !== null && isSizeToken(previous) ? sizeIndex(value) > sizeIndex(previous) : sizeIndex(value) >= 2;
  return `Trying a ${bigger ? 'larger' : 'smaller'} ${label} button`;
}

/** Short, user-facing evidence for the on-screen status line. Never private reasoning. */
export function describePatch(patch: PreviewPatch, label: string): string {
  return describePatchRelative(patch, label, null);
}

export function describePatchRelative(patch: PreviewPatch, label: string, previousValue: string | null): string {
  switch (patch.kind) {
    case 'set_size':
      return describeSize(patch.value, label, previousValue);
    case 'set_background':
      return `Trying a ${patch.value} ${label} button`;
    case 'set_label':
      return `Trying the label "${patch.value}" on ${label}`;
    case 'set_radius':
      return `Trying a ${patch.value === 'none' ? 'square' : `${patch.value}-shaped`} ${label} button`;
    case 'set_visibility':
      return `Trying ${label} ${patch.value ? 'shown' : 'hidden'}`;
  }
}

export function describeProposal(proposal: PlannerProposal, label: string | null): string {
  if (proposal.kind === 'preview_patch') return describePatch(proposal.patch, label ?? proposal.patch.elementId);
  if (proposal.kind === 'prototype_change') return `Prototyping: ${proposal.brief.slice(0, 120)}`;
  return proposal.summary;
}
