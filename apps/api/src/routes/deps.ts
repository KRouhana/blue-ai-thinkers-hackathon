import type { Logger, Orchestrator } from '@fork/orchestrator';
import type { Context } from 'hono';
import { ApiError, issuesOf } from '../errors';
import type { TranscriptionConnector } from '../transcription/connector';
import type { z } from 'zod';

export interface ApiDeps {
  orchestrator: Orchestrator;
  token: string;
  allowedOrigins: readonly string[];
  transcription: TranscriptionConnector;
  logger: Logger;
}

/** One place where an untrusted body becomes a typed value, or a 400 with the offending paths. */
export async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const raw = await c.req.json().catch(() => undefined);
  if (raw === undefined) throw new ApiError(400, 'validation_failed', 'the request body must be JSON');
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, 'validation_failed', 'the request body did not validate', issuesOf(parsed.error));
  }
  return parsed.data;
}
