import { z } from 'zod';
// Defensive decoding at D's network boundary. B owns server-side validation.
const revision = z.object({ source: z.number().int().nonnegative(), config: z.number().int().nonnegative() });
const clarification = z.object({ intentId: z.string(), question: z.string(), candidates: z.array(z.object({ id: z.string(), label: z.string() })) });
export const experimentSchema = z.object({
  id: z.string(), intentId: z.string(), status: z.enum(['proposed','applying','visible','reverted','failed','superseded']),
  summary: z.string(), origin: z.enum(['inferred_experiment','host_control']), sourceObservationIds: z.array(z.string()),
  revision, checkpointId: z.string().nullable(), mockNotes: z.array(z.string()),
});
export const snapshotSchema = z.object({
  id: z.string(), captureEpoch: z.string(), capture: z.enum(['stopped','listening','paused']),
  prototypeAutonomyEnabled: z.boolean(), workspaceId: z.string().nullable(), revision,
  previewUrl: z.string().nullable(), currentTopic: z.string().nullable(), lastEventSequence: z.number().int().nonnegative(),
  experiments: z.array(experimentSchema), clarification: clarification.nullable(),
});
export const eventSchema = z.object({
  id: z.string(), sessionId: z.string(), sequence: z.number().int().nonnegative(), at: z.string(),
  payload: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('snapshot'), snapshot: snapshotSchema }),
    z.object({ kind: z.literal('experiment'), experiment: experimentSchema }),
    z.object({ kind: z.literal('job'), progress: z.object({ jobId: z.string(), state: z.enum(['queued','running','checking','ready','failed','cancelled','superseded']), message: z.string() }) }),
    z.object({ kind: z.literal('status'), message: z.string() }),
    clarification.extend({ kind: z.literal('clarification') }),
    z.object({ kind: z.literal('error'), code: z.string(), message: z.string() }),
  ]),
});
