/**
 * Compile-time guard: every runtime schema infers a type assignable to the verbatim
 * contract type in ../types.ts, and vice versa where the contract is the stricter side.
 * `npm run typecheck` is the real assertion; the runtime test only keeps the file in the suite.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { z } from 'zod';
import type {
  ExperimentRecord, Observation, OutputPayload, PatchResult, PlannerProposal, PreparedWorkspace, PreviewPatch,
  PrototypeJob, PrototypeResult, RepoMap, SessionControl, SessionEvent, SessionSnapshot, WorkerProgress,
} from '../types';
import type {
  experimentRecordSchema, observationSchema, outputPayloadSchema, patchResultSchema, plannerProposalSchema,
  preparedWorkspaceSchema, previewPatchSchema, prototypeJobSchema, prototypeResultSchema, repoMapSchema,
  sessionControlSchema, sessionEventSchema, sessionSnapshotSchema, workerProgressSchema,
} from './index';

type Infer<S> = S extends z.ZodType ? z.infer<S> : never;
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

const checks: [
  MutuallyAssignable<Infer<typeof observationSchema>, Observation>,
  MutuallyAssignable<Infer<typeof previewPatchSchema>, PreviewPatch>,
  MutuallyAssignable<Infer<typeof plannerProposalSchema>, PlannerProposal>,
  MutuallyAssignable<Infer<typeof repoMapSchema>, RepoMap>,
  MutuallyAssignable<Infer<typeof prototypeJobSchema>, PrototypeJob>,
  MutuallyAssignable<Infer<typeof workerProgressSchema>, WorkerProgress>,
  MutuallyAssignable<Infer<typeof prototypeResultSchema>, PrototypeResult>,
  MutuallyAssignable<Infer<typeof preparedWorkspaceSchema>, PreparedWorkspace>,
  MutuallyAssignable<Infer<typeof patchResultSchema>, PatchResult>,
  MutuallyAssignable<Infer<typeof experimentRecordSchema>, ExperimentRecord>,
  MutuallyAssignable<Infer<typeof sessionSnapshotSchema>, SessionSnapshot>,
  MutuallyAssignable<Infer<typeof sessionControlSchema>, SessionControl>,
  MutuallyAssignable<Infer<typeof outputPayloadSchema>, OutputPayload>,
  MutuallyAssignable<Infer<typeof sessionEventSchema>, SessionEvent>,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true];

test('schema-inferred types match the verbatim contract types (enforced by tsc)', () => {
  assert.equal(checks.length, 14);
});
