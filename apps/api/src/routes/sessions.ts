import { createSessionRequestSchema } from '@fork/contracts';
import type { Hono } from 'hono';
import { fail, ok } from '../errors';
import { parseBody, type ApiDeps } from './deps';

const EVENT_PAGE = 200;

export function registerSessionRoutes(app: Hono, deps: ApiDeps): void {
  app.post('/api/sessions', async (c) => {
    const body = await parseBody(c, createSessionRequestSchema);
    const created = await deps.orchestrator.createSession(body);
    return ok(c, created, 201);
  });

  app.get('/api/sessions/:id', (c) => {
    const sessionId = c.req.param('id');
    const snapshot = deps.orchestrator.getSnapshot(sessionId);
    if (!snapshot) return fail(c, 404, 'session_not_found', 'unknown session');
    const after = Math.max(0, snapshot.lastEventSequence - EVENT_PAGE);
    return ok(c, { snapshot, events: deps.orchestrator.listEvents(sessionId, after, EVENT_PAGE) });
  });
}
