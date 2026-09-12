import type { ApiIssue } from '@fork/contracts';
import { OrchestratorError } from '@fork/orchestrator';
import type { Logger } from '@fork/orchestrator';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly issues?: ApiIssue[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const ok = <T>(c: Context, data: T, status: ContentfulStatusCode = 200): Response =>
  c.json({ ok: true as const, data }, status);

export const fail = (c: Context, status: ContentfulStatusCode, code: string, message: string, issues?: ApiIssue[]): Response =>
  c.json({ ok: false as const, error: issues ? { code, message, issues } : { code, message } }, status);

export const issuesOf = (error: ZodError): ApiIssue[] =>
  error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join('.'), message: issue.message }));

/** Known failures keep their code; anything else is reported without leaking internals. */
export function handleError(error: unknown, c: Context, logger: Logger): Response {
  if (error instanceof ApiError) return fail(c, error.status, error.code, error.message, error.issues);
  if (error instanceof OrchestratorError) return fail(c, error.status as ContentfulStatusCode, error.code, error.message);
  if (error instanceof ZodError) return fail(c, 400, 'validation_failed', 'the request body did not validate', issuesOf(error));
  logger.error('unhandled api error', { path: c.req.path, error: error instanceof Error ? error.stack ?? error.message : String(error) });
  return fail(c, 500, 'internal_error', 'an unexpected error occurred; see the server log');
}
