import { z } from 'zod';
import { idSchema, revisionSchema, sourceRefSchema } from './primitives';
import { previewPatchSchema } from './planner';

export const jobStateSchema = z.enum(['queued', 'running', 'checking', 'ready', 'failed', 'cancelled', 'superseded']);

export const repoMapSchema = z.strictObject({
  workspaceId: idSchema,
  origin: z.enum(['blank_template', 'existing_repo']),
  fingerprint: z.string().min(1).max(200),
  framework: z.strictObject({ name: z.string().max(100), verified: z.boolean() }),
  routes: z.array(z.strictObject({ route: z.string().max(500), sources: z.array(sourceRefSchema).max(20) })).max(100),
  relevantSources: z.array(sourceRefSchema).max(50),
  mockCapabilities: z.array(z.string().max(200)).max(50),
  limitations: z.array(z.string().max(300)).max(50),
});

export const prototypeJobSchema = z.strictObject({
  id: idSchema,
  experimentId: idSchema,
  sessionId: idSchema,
  workspaceId: idSchema,
  intentId: idSchema,
  expectedRevision: revisionSchema,
  brief: z.string().min(1).max(600),
  relevantSources: z.array(sourceRefSchema).max(8),
  constraints: z.array(z.string().max(200)).max(8),
  mockedIntegrations: z.array(z.string().max(200)).max(8),
  mode: z.literal('demo_only'),
  verification: z.literal('compile_and_render'),
});

export const workerProgressSchema = z.strictObject({ jobId: idSchema, state: jobStateSchema, message: z.string().max(500) });

export const renderCheckSchema = z.strictObject({
  compile: z.enum(['passed', 'failed', 'not_checked']),
  page: z.enum(['rendered', 'failed', 'not_checked']),
  diagnostics: z.array(z.string().max(1000)).max(50),
});

export const prototypeResultSchema = z.strictObject({
  jobId: idSchema,
  workspaceId: idSchema,
  state: z.enum(['ready', 'failed', 'cancelled', 'superseded']),
  basedOn: revisionSchema,
  resultingRevision: revisionSchema,
  checkpointId: idSchema.nullable(),
  previewUrl: z.string().max(500).nullable(),
  changedFiles: z.array(z.string().max(500)).max(200),
  mockNotes: z.array(z.string().max(300)).max(20),
  check: renderCheckSchema,
});

export const prepareRequestSchema = z.strictObject({
  sessionId: idSchema,
  projectConfigId: idSchema,
  mode: z.enum(['blank_template', 'existing_repo']),
});

// A real PrototypeEngine (e.g. Track C's) legitimately returns more than this: its
// prepare() result is also its richer WorkspaceDetails (sourcePath, checkpoints,
// registered elements, etc. — see that engine's own docs). This isn't untrusted
// input needing a strict allowlist, just B's own internal shape check on its
// composed engine's response, so extra known-good fields are fine to ignore.
export const preparedWorkspaceSchema = z.object({
  workspaceId: idSchema,
  revision: revisionSchema,
  repoMap: repoMapSchema,
  previewUrl: z.string().max(500),
  renderState: z.enum(['starting', 'rendered', 'failed']),
});

export const patchRequestSchema = z.strictObject({
  operationId: idSchema,
  sessionId: idSchema,
  workspaceId: idSchema,
  expectedRevision: revisionSchema,
  patch: previewPatchSchema,
});

export const patchResultSchema = z.strictObject({
  operationId: idSchema,
  applied: z.boolean(),
  revision: revisionSchema,
  checkpointId: idSchema.nullable(),
  diagnostic: z.string().max(1000).optional(),
});
