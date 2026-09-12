import { createHash, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { fail } from './errors';

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

export const tokensMatch = (supplied: string, expected: string): boolean => timingSafeEqual(digest(supplied), digest(expected));

/**
 * Loopback is not authorization: an untrusted page in the host's browser can reach 127.0.0.1.
 * Every call needs the session token, and browser calls need an allowlisted origin.
 */
export function authMiddleware(token: string, allowedOrigins: readonly string[]): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('origin');
    if (origin && !allowedOrigins.includes(origin)) {
      return fail(c, 403, 'forbidden_origin', 'this origin is not allowed to call the Fork control API');
    }
    const header = c.req.header('authorization') ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
    // EventSource cannot set headers, so the event stream alone accepts the token as a query parameter.
    const fromQuery = c.req.path.endsWith('/events') ? c.req.query('access_token') ?? null : null;
    const supplied = bearer ?? fromQuery;
    if (!supplied || !tokensMatch(supplied, token)) {
      return fail(c, 401, 'unauthorized', 'a valid session token is required');
    }
    await next();
    return undefined;
  };
}
