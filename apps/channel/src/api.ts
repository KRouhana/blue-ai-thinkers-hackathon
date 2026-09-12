import type { SessionSnapshot, SessionControl, PrepareRequest } from '../../../contracts.v2';
import { snapshotSchema } from '../../meeting/src/integration/schema';

export interface SessionApi {
  create(): Promise<SessionSnapshot>;
  snapshot(id: string): Promise<SessionSnapshot>;
  control(id: string, control: SessionControl): Promise<void>;
}

export function createSessionApi(base: string, token: string, projectConfigId: string, request = fetch, mode: PrepareRequest['mode'] = 'existing_repo'): SessionApi {
  const origin = new URL(base);
  if (origin.username || origin.password || origin.search || origin.hash || !['http:', 'https:'].includes(origin.protocol)) throw new Error('Invalid FORK_API_BASE.');
  if (!token.trim()) throw new Error('FORK_API_TOKEN is required.');
  if (mode !== 'existing_repo' && mode !== 'blank_template') throw new Error('FORK_PROJECT_MODE must be existing_repo or blank_template.');
  const root = `${origin.href.replace(/\/$/, '')}/api/sessions`;
  async function call(path: string, body?: unknown) {
    let response: Response;
    try {
      response = await request(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000), redirect: 'error',
      });
    } catch { throw new Error('Session service is unavailable. Check B’s API connection.'); }
    if (!response.ok) throw new Error(`Session service returned HTTP ${response.status}. Check B’s API authorization.`);
    if (response.status === 204) return undefined;
    try { const body = await response.text(); return body ? JSON.parse(body) : undefined; }
    catch { throw new Error('Session service returned invalid JSON.'); }
  }
  const decode = (value: unknown) => {
    const result = snapshotSchema.safeParse(value);
    if (!result.success) throw new Error('Session service returned an invalid snapshot.');
    return result.data;
  };
  return {
    create: async () => decode(await call(root, { projectConfigId, mode })),
    snapshot: async id => {
      const result = decode(await call(`${root}/${encodeURIComponent(id)}`));
      if (result.id !== id) throw new Error('Session service returned a different session.');
      return result;
    },
    control: async (id, control) => { await call(`${root}/${encodeURIComponent(id)}/controls`, control); },
  };
}
