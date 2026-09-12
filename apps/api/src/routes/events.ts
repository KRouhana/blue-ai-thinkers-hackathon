import type { SessionEvent } from '@fork/contracts';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { fail } from '../errors';
import type { ApiDeps } from './deps';

const REPLAY_LIMIT = 500;
const KEEPALIVE_MS = 15_000;
const POLL_MS = 250;

const cursorOf = (header: string | undefined, query: string | undefined): number => {
  const raw = Number(header ?? query ?? 0);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
};

/**
 * Snapshot first, then ordered replay, then live events. The opening snapshot carries no SSE id,
 * so a reconnect never skips events the client has not actually seen.
 */
export function registerEventRoutes(app: Hono, deps: ApiDeps): void {
  app.get('/api/sessions/:id/events', (c) => {
    const sessionId = c.req.param('id');
    const snapshot = deps.orchestrator.getSnapshot(sessionId);
    if (!snapshot) return fail(c, 404, 'session_not_found', 'unknown session');
    const after = cursorOf(c.req.header('last-event-id'), c.req.query('after'));

    return streamSSE(c, async (stream) => {
      const queue: SessionEvent[] = [];
      const unsubscribe = deps.orchestrator.subscribe(sessionId, (event) => { queue.push(event); });
      stream.onAbort(unsubscribe);

      const send = (event: SessionEvent): Promise<void> =>
        stream.writeSSE({ id: String(event.sequence), event: event.payload.kind, data: JSON.stringify(event) });

      try {
        await stream.writeSSE({ event: 'snapshot', data: JSON.stringify({ kind: 'snapshot', snapshot }) });
        for (const event of deps.orchestrator.listEvents(sessionId, after, REPLAY_LIMIT)) await send(event);

        let lastWrite = Date.now();
        while (!stream.aborted) {
          const next = queue.shift();
          if (next) {
            // A replayed event can repeat here in a narrow race; clients dedupe by sequence.
            await send(next);
            lastWrite = Date.now();
            continue;
          }
          if (Date.now() - lastWrite > KEEPALIVE_MS) {
            await stream.writeSSE({ event: 'keepalive', data: '' });
            lastWrite = Date.now();
          }
          await stream.sleep(POLL_MS);
        }
      } finally {
        unsubscribe();
      }
    });
  });
}
