import type { EditableProperty, PreviewPatch } from '@fork/contracts';
import type { Rule } from '../gate';

const PROPERTY_FOR: Record<PreviewPatch['kind'], EditableProperty> = {
  set_size: 'size',
  set_background: 'background',
  set_label: 'label',
  set_radius: 'radius',
  set_visibility: 'visible',
};

export const targetValid: Rule = ({ proposal, observations }) => {
  if (proposal.kind !== 'preview_patch') return null;
  const { patch, targetEvidence } = proposal;
  if (patch.elementId !== targetEvidence.elementId) {
    return { code: 'target_mismatch', reason: 'patch target differs from cited evidence' };
  }
  const cited = observations.get(targetEvidence.contextObservationId)?.observation;
  if (!cited || cited.kind !== 'preview_context') {
    return { code: 'target_missing', reason: 'cited context observation not found' };
  }
  const element = cited.elements.find((candidate) => candidate.id === patch.elementId);
  if (!element) return { code: 'target_missing', reason: `element ${patch.elementId} not in cited context` };
  if (!element.visible) return { code: 'target_hidden', reason: `element ${element.label} is not visible` };
  if (!element.editable.includes(PROPERTY_FOR[patch.kind])) {
    return { code: 'target_not_editable', reason: `${element.label} does not allow ${PROPERTY_FOR[patch.kind]}` };
  }
  return null;
};
