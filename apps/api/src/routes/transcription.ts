import { transcriptionConnectionRequestSchema } from '@fork/contracts';
import type { Hono } from 'hono';
import { ApiError, ok } from '../errors';
import { parseBody, type ApiDeps } from './deps';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

/** Provider negotiation is the one route that spends money, so it is scoped and rate limited. */
export function registerTranscriptionRoutes(app: Hono, deps: ApiDeps): void {
  let attempts: ReadonlyMap<string, readonly number[]> = new Map();

  const allow = (sessionId: string, now: number): boolean => {
    const recent = (attempts.get(sessionId) ?? []).filter((at) => now - at < WINDOW_MS);
    if (recent.length >= MAX_PER_WINDOW) {
      attempts = new Map(attempts).set(sessionId, recent);
      return false;
    }
    attempts = new Map(attempts).set(sessionId, [...recent, now]);
    return true;
  };

  app.post('/api/sessions/:id/transcription-connection', async (c) => {
    const sessionId = c.req.param('id');
    const body = await parseBody(c, transcriptionConnectionRequestSchema);
    const snapshot = deps.orchestrator.getSnapshot(sessionId);
    if (!snapshot) throw new ApiError(404, 'session_not_found', 'unknown session');
    if (snapshot.capture === 'stopped') {
      throw new ApiError(409, 'invalid_state', 'start capture on the host before negotiating a transcription connection');
    }
    if (!allow(sessionId, Date.now())) {
      throw new ApiError(429, 'rate_limited', `at most ${MAX_PER_WINDOW} negotiations per minute per session`);
    }
    const negotiation = await deps.transcription.negotiate(body.sdp === undefined ? { sessionId } : { sessionId, sdp: body.sdp });
    return ok(c, negotiation);
  });
}
