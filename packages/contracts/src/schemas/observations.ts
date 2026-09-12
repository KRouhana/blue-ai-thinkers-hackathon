import { z } from 'zod';
import { editablePropertySchema, idSchema, isoTimeSchema, revisionSchema, sourceRefSchema } from './primitives';

export const previewElementSchema = z.strictObject({
  id: idSchema,
  role: z.string().min(1).max(64),
  label: z.string().max(200),
  section: z.string().max(200).optional(),
  visible: z.boolean(),
  box: z.strictObject({ x: z.number(), y: z.number(), width: z.number().min(0), height: z.number().min(0) }),
  editable: z.array(editablePropertySchema).max(5),
  source: sourceRefSchema.optional(),
});

const observationBase = {
  id: idSchema,
  sessionId: idSchema,
  captureEpoch: idSchema,
  capturedAt: isoTimeSchema,
  version: z.number().int().min(1),
};

const pointerSchema = z.strictObject({ elementId: idSchema, at: isoTimeSchema });

export const transcriptObservationSchema = z.strictObject({
  ...observationBase,
  kind: z.literal('transcript'),
  phase: z.enum(['partial', 'final']),
  providerItemId: z.string().min(1).max(200),
  audioTurnSequence: z.number().int().min(0).nullable(),
  orderReliable: z.boolean(),
  streamId: idSchema,
  text: z.string().max(4000),
  supersedesObservationId: idSchema.optional(),
  speaker: z.strictObject({ label: z.string().max(100).nullable(), verified: z.literal(false) }),
});

export const previewContextObservationSchema = z.strictObject({
  ...observationBase,
  kind: z.literal('preview_context'),
  workspaceId: idSchema,
  revision: revisionSchema,
  route: z.string().min(1).max(500),
  viewport: z.strictObject({ width: z.number().min(0), height: z.number().min(0) }),
  elements: z.array(previewElementSchema).max(200),
  focusId: idSchema.nullable(),
  hover: pointerSchema.nullable(),
  selection: pointerSchema.nullable(),
});

export const observationSchema = z.discriminatedUnion('kind', [
  transcriptObservationSchema,
  previewContextObservationSchema,
]);
