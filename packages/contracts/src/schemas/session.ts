import { z } from 'zod';
import { idSchema, isoTimeSchema, revisionSchema } from './primitives';
import { candidateSchema } from './planner';
import { workerProgressSchema } from './engine';

export const experimentRecordSchema = z.strictObject({
  id: idSchema,
  intentId: idSchema,
  status: z.enum(['proposed', 'applying', 'visible', 'reverted', 'failed', 'superseded']),
  summary: z.string().max(200),
  origin: z.enum(['inferred_experiment', 'host_control']),
  sourceObservationIds: z.array(idSchema).max(20),
  revision: revisionSchema,
  checkpointId: idSchema.nullable(),
  mockNotes: z.array(z.string().max(300)).max(20),
});

export const clarificationSchema = z.strictObject({
  intentId: idSchema,
  question: z.string().max(200),
  candidates: z.array(candidateSchema).min(2).max(4),
});

export const sessionSnapshotSchema = z.strictObject({
  id: idSchema,
  captureEpoch: idSchema,
  capture: z.enum(['stopped', 'listening', 'paused']),
  prototypeAutonomyEnabled: z.boolean(),
  workspaceId: idSchema.nullable(),
  revision: revisionSchema,
  previewUrl: z.string().max(500).nullable(),
  currentTopic: z.string().max(200).nullable(),
  lastEventSequence: z.number().int().min(0),
  experiments: z.array(experimentRecordSchema).max(100),
  clarification: clarificationSchema.nullable(),
});

export const sessionControlSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('pause') }),
  z.strictObject({ kind: z.literal('resume') }),
  z.strictObject({ kind: z.literal('stop') }),
  z.strictObject({ kind: z.literal('undo'), experimentId: idSchema }),
  z.strictObject({ kind: z.literal('cancel_job'), jobId: idSchema }),
  z.strictObject({ kind: z.literal('clarification_answer'), intentId: idSchema, candidateId: idSchema }),
]);

export const outputPayloadSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('snapshot'), snapshot: sessionSnapshotSchema }),
  z.strictObject({ kind: z.literal('experiment'), experiment: experimentRecordSchema }),
  z.strictObject({ kind: z.literal('job'), progress: workerProgressSchema }),
  z.strictObject({ kind: z.literal('status'), message: z.string().max(500) }),
  z.strictObject({
    kind: z.literal('clarification'),
    intentId: idSchema,
    question: z.string().max(200),
    candidates: z.array(candidateSchema).min(2).max(4),
  }),
  z.strictObject({ kind: z.literal('error'), code: z.string().max(100), message: z.string().max(500) }),
]);

export const sessionEventSchema = z.strictObject({
  id: idSchema,
  sessionId: idSchema,
  sequence: z.number().int().min(1),
  at: isoTimeSchema,
  payload: outputPayloadSchema,
});
