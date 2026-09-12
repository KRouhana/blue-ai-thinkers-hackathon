import { captureRequestSchema } from '@fork/contracts';
import type { Hono } from 'hono';
import { ok } from '../errors';
import { parseBody, type ApiDeps } from './deps';

export function registerCaptureRoutes(app: Hono, deps: ApiDeps): void {
  app.post('/api/sessions/:id/capture', async (c) => {
    const body = await parseBody(c, captureRequestSchema);
    const snapshot = await deps.orchestrator.setCapture(c.req.param('id'), body);
    return ok(c, { snapshot });
  });
}
