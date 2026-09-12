import { observationsBatchSchema } from '@fork/contracts';
import type { Hono } from 'hono';
import { ApiError, ok } from '../errors';
import { parseBody, type ApiDeps } from './deps';

export function registerObservationRoutes(app: Hono, deps: ApiDeps): void {
  app.post('/api/sessions/:id/observations', async (c) => {
    const sessionId = c.req.param('id');
    const body = await parseBody(c, observationsBatchSchema);
    const foreign = body.observations.filter((observation) => observation.sessionId !== sessionId);
    if (foreign.length > 0) {
      const ids = foreign.map((observation) => observation.id).join(', ');
      throw new ApiError(400, 'validation_failed', `observations ${ids} belong to another session`);
    }
    const report = await deps.orchestrator.ingestObservations(sessionId, body.observations);
    return ok(c, report, 202);
  });
}
