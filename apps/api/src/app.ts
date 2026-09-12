import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from './auth';
import { fail, handleError, ok } from './errors';
import { registerCaptureRoutes } from './routes/capture';
import { registerControlRoutes } from './routes/controls';
import { registerEventRoutes } from './routes/events';
import { registerJobRoutes } from './routes/jobs';
import { registerObservationRoutes } from './routes/observations';
import { registerSessionRoutes } from './routes/sessions';
import { registerTranscriptionRoutes } from './routes/transcription';
import type { ApiDeps } from './routes/deps';

export type { ApiDeps } from './routes/deps';

export function createApp(deps: ApiDeps): Hono {
  const app = new Hono();

  app.use('/api/*', cors({
    origin: [...deps.allowedOrigins],
    allowHeaders: ['Authorization', 'Content-Type', 'Last-Event-ID'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  }));
  app.use('/api/*', authMiddleware(deps.token, deps.allowedOrigins));

  app.onError((error, c) => handleError(error, c, deps.logger));
  app.notFound((c) => fail(c, 404, 'not_found', `no route for ${c.req.method} ${c.req.path}`));

  // Unauthenticated on purpose: it reports only whether this process is up and what is wired.
  app.get('/healthz', (c) => ok(c, { planner: deps.orchestrator.plannerLabel, engine: deps.orchestrator.engineLabel }));

  registerSessionRoutes(app, deps);
  registerCaptureRoutes(app, deps);
  registerObservationRoutes(app, deps);
  registerEventRoutes(app, deps);
  registerControlRoutes(app, deps);
  registerJobRoutes(app, deps);
  registerTranscriptionRoutes(app, deps);

  return app;
}
