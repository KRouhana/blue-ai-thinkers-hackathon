import { targetBasisSchema } from '@fork/contracts';
import { z } from 'zod';

const patchKindSchema = z.enum(['set_size', 'set_background', 'set_label', 'set_radius', 'set_visibility']);

/**
 * Flat and nullable on purpose: OpenAI strict structured output rejects length/size keywords and
 * optional fields. Contract bounds are enforced afterwards by toProposal() + plannerProposalSchema.
 */
export const plannerOutputSchema = z.strictObject({
  kind: z.enum(['observe', 'hold', 'clarify', 'preview_patch', 'prototype_change', 'undo', 'pause']),
  summary: z.string(),
  reason: z.string(),
  currentTopic: z.string().nullable(),
  resolvesClarification: z.boolean(),
  patch: z.strictObject({ kind: patchKindSchema, elementId: z.string(), value: z.string() }).nullable(),
  targetEvidence: z.strictObject({
    elementId: z.string(),
    basis: z.array(targetBasisSchema),
    explanation: z.string(),
  }).nullable(),
  clarify: z.strictObject({
    question: z.string(),
    candidateElementIds: z.array(z.string()),
    pendingPatch: z.strictObject({ kind: patchKindSchema, value: z.string() }).nullable(),
  }).nullable(),
  prototype: z.strictObject({
    brief: z.string(),
    relevantSourcePaths: z.array(z.string()),
    constraints: z.array(z.string()),
    mockedIntegrations: z.array(z.string()),
  }).nullable(),
  undoExperimentId: z.string().nullable(),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;
export type PlannerOutputKind = PlannerOutput['kind'];

export const OBSERVE_OUTPUT: PlannerOutput = {
  kind: 'observe', summary: 'Discussion only', reason: 'nothing actionable in this turn', currentTopic: null,
  resolvesClarification: false, patch: null, targetEvidence: null, clarify: null, prototype: null, undoExperimentId: null,
};

export const holdOutput = (reason: string): PlannerOutput => ({
  ...OBSERVE_OUTPUT, kind: 'hold', summary: 'Waiting for clearer context', reason,
});
