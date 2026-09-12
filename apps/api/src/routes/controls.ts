import { sessionControlSchema } from '@fork/contracts';
import type { Hono } from 'hono';
import { ok } from '../errors';
import { parseBody, type ApiDeps } from './deps';

export function registerControlRoutes(app: Hono, deps: ApiDeps): void {
  app.post('/api/sessions/:id/controls', async (c) => {
    const control = await parseBody(c, sessionControlSchema);
    const snapshot = await deps.orchestrator.applyControl(c.req.param('id'), control);
    return ok(c, { snapshot });
  });
}
