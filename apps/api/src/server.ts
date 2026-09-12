import { serve } from '@hono/node-server';
import { consoleLogger } from '@fork/orchestrator';
import { compose } from './compose';
import { loadEnv } from './env';

const logger = consoleLogger;

function boot(): void {
  const env = loadEnv();
  const { app, store, orchestrator, plannerLabel, engineLabel } = compose(env, logger);

  if (env.generatedToken) {
    // Printed once so the operator can paste it into the meeting shell; a configured token is never logged.
    logger.warn('FORK_API_TOKEN was not set; generated a token for this run', { token: env.token });
  }

  const server = serve({ fetch: app.fetch, hostname: env.host, port: env.port }, (info) => {
    logger.info('fork control api listening', {
      url: `http://${info.address}:${info.port}`,
      planner: plannerLabel,
      engine: engineLabel,
      db: env.dbPath,
      allowedOrigins: env.allowedOrigins,
    });
  });

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    logger.info('shutting down', { signal });
    orchestrator.dispose();
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

try {
  boot();
} catch (error) {
  logger.error('fork control api could not start', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}
