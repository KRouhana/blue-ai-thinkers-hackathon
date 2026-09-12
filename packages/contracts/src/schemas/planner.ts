import { z } from 'zod';
import { colorTokenSchema, idSchema, radiusTokenSchema, revisionSchema, sizeTokenSchema, sourceRefSchema } from './primitives';

export const previewPatchSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('set_size'), elementId: idSchema, value: sizeTokenSchema }),
  z.strictObject({ kind: z.literal('set_background'), elementId: idSchema, value: colorTokenSchema }),
  z.strictObject({ kind: z.literal('set_label'), elementId: idSchema, value: z.string().min(1).max(60) }),
  z.strictObject({ kind: z.literal('set_radius'), elementId: idSchema, value: radiusTokenSchema }),
  z.strictObject({ kind: z.literal('set_visibility'), elementId: idSchema, value: z.boolean() }),
]);

export const targetBasisSchema = z.enum(['explicit_label', 'recent_referent', 'route', 'focus', 'hover', 'selection']);

export const targetEvidenceSchema = z.strictObject({
  contextObservationId: idSchema,
  elementId: idSchema,
  basis: z.array(targetBasisSchema).min(1).max(6),
  explanation: z.string().min(1).max(300),
});

export const candidateSchema = z.strictObject({ id: idSchema, label: z.string().max(200) });

const intentBase = {
  id: idSchema,
  sessionId: idSchema,
  captureEpoch: idSchema,
  sourceObservationIds: z.array(idSchema).min(1).max(20),
  expectedRevision: revisionSchema,
  summary: z.string().min(1).max(200),
};

export const plannerProposalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...intentBase, kind: z.literal('observe'), reason: z.string().max(300) }),
  z.strictObject({ ...intentBase, kind: z.literal('hold'), reason: z.string().max(300) }),
  z.strictObject({
    ...intentBase,
    kind: z.literal('clarify'),
    question: z.string().min(1).max(200),
    candidates: z.array(candidateSchema).min(2).max(4),
  }),
  z.strictObject({ ...intentBase, kind: z.literal('preview_patch'), patch: previewPatchSchema, targetEvidence: targetEvidenceSchema }),
  z.strictObject({
    ...intentBase,
    kind: z.literal('prototype_change'),
    brief: z.string().min(1).max(600),
    relevantSources: z.array(sourceRefSchema).max(8),
    constraints: z.array(z.string().max(200)).max(8),
    mockedIntegrations: z.array(z.string().max(200)).max(8),
  }),
  z.strictObject({ ...intentBase, kind: z.literal('undo'), experimentId: idSchema }),
  z.strictObject({ ...intentBase, kind: z.literal('pause') }),
]);
