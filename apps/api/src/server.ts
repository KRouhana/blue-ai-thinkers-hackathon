import { serve } from '@hono/node-server';
import { consoleLogger } from '@fork/orchestrator';
import { compose } from './compose';
import { loadEnv } from './env';

const logger = consoleLogger;

async function boot(): Promise<void> {
  const env = loadEnv();
  const { app, close, plannerLabel, engineLabel } = await compose(env, logger);

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
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    logger.info('shutting down', { signal });
    server.close();
    try {
      await close();
      if ('closeAllConnections' in server && typeof server.closeAllConnections === 'function') server.closeAllConnections();
      process.exit(0);
    } catch (error) {
      logger.error('shutdown could not complete', { error: error instanceof Error ? error.message : String(error) });
      process.exitCode = 1;
    }
  };
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
}

boot().catch((error: unknown) => {
  logger.error('fork control api could not start', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
