import type { Hono } from 'hono';
import { fail, ok } from '../errors';
import type { ApiDeps } from './deps';

export function registerJobRoutes(app: Hono, deps: ApiDeps): void {
  app.get('/api/jobs/:id', (c) => {
    const stored = deps.orchestrator.getJob(c.req.param('id'));
    if (!stored) return fail(c, 404, 'job_not_found', 'unknown job');
    return ok(c, {
      id: stored.job.id,
      sessionId: stored.job.sessionId,
      experimentId: stored.job.experimentId,
      state: stored.state,
      message: stored.message,
      brief: stored.job.brief,
      result: stored.result,
      updatedAt: stored.updatedAt,
    });
  });
}
