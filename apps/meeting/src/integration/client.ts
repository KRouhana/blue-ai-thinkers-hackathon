import type { SessionClient, SessionSnapshot, SessionEvent } from './types';
import { snapshotSchema, eventSchema } from './schema';

// B's routes (apps/api) wrap every JSON body as {ok, data} / {ok:false, error}, never a bare payload.
const EVENT_KINDS = ['snapshot', 'experiment', 'job', 'status', 'clarification', 'error'] as const;

// B's createSessionRequestSchema is a strict object accepting only { projectConfigId }: the
// existing_repo/blank_template mode is fixed server-side per project in B's fork.projects.json
// allowlist, not a client-supplied value. `mode` is accepted here only to preserve the config
// surface D exposes (FORK_PROJECT_MODE) for local documentation/labeling; it is never sent to B.
export function createHttpClient(base = '/api', projectConfigId = 'demo-product', _mode: 'existing_repo' | 'blank_template' = 'existing_repo'): SessionClient {
  const path = (id: string) => `${base}/sessions/${encodeURIComponent(id)}`;
  async function request(url: string, body?: unknown) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000), redirect: 'error',
      ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (response.status === 204) return undefined;
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : undefined;
    if (!response.ok || parsed?.ok === false) throw new Error(`Session service returned HTTP ${response.status}${parsed?.error?.message ? `: ${parsed.error.message}` : ''}. Check B’s API and session authorization.`);
    return parsed?.ok === true ? parsed.data : parsed;
  }
  const snapshot = async (id: string) => {
    const value = snapshotSchema.parse((await request(path(id)))?.snapshot);
    if (value.id !== id) throw new Error('Session service returned a different session.');
    return value;
  };
  return {
    create: async () => snapshotSchema.parse((await request(`${base}/sessions`, { projectConfigId }))?.snapshot),
    snapshot,
    control: async (id, control) => { await request(`${path(id)}/controls`, control); },
    capture: async (id, action) => { await request(`${path(id)}/capture`, { action, prototypeAutonomyEnabled: action === 'start' || action === 'resume' }); },
    observe: async (id, observations) => { await request(`${path(id)}/observations`, { observations }); },
    subscribe(id, after, receive, connection) {
      let stopped = false, source: EventSource | undefined, timer: ReturnType<typeof setTimeout> | undefined;
      let sequence = after, attempts = 0;
      const recover = () => {
        source?.close();
        source = undefined;
        if (stopped || timer) return;
        connection('reconnecting');
        timer = setTimeout(() => { timer = undefined; void connect(true); }, Math.min(1000 * 2 ** attempts++, 10000));
      };
      async function connect(reset: boolean) {
        if (stopped) return;
        try {
          if (reset) {
            const value: SessionSnapshot = await snapshot(id);
            if (stopped) return;
            if (value.lastEventSequence < sequence) throw new Error('Session snapshot is behind the last received event.');
            sequence = value.lastEventSequence;
            receive({ id: `reset-${sequence}`, sessionId: id, sequence, at: new Date().toISOString(), payload: { kind: 'snapshot', snapshot: value } });
          }
          source = new EventSource(`${path(id)}/events?after=${sequence}`);
          const activeSource = source;
          source.onopen = () => { if (stopped || source !== activeSource) return; attempts = 0; connection('connected'); };
          const handle = (message: { data: string }) => {
            if (stopped || source !== activeSource) return;
            try {
              const raw = JSON.parse(message.data);
              // B's opening SSE frame is a bare {kind:'snapshot', snapshot}, not a full SessionEvent
              // (it carries no SSE id so a reconnect never skips an event the client hasn't seen).
              // Every later frame (via B's ordered event bus) is a full SessionEvent.
              const bareSnapshot = raw && typeof raw === 'object' && raw.kind === 'snapshot' && raw.id === undefined;
              const event: SessionEvent = bareSnapshot
                ? (() => { const value = snapshotSchema.parse(raw.snapshot); return { id: `snapshot-${value.lastEventSequence}`, sessionId: id, sequence: value.lastEventSequence, at: new Date().toISOString(), payload: { kind: 'snapshot' as const, snapshot: value } }; })()
                : eventSchema.parse(raw);
              if (event.sessionId !== id) throw new Error('Wrong session');
              if (event.sequence <= sequence) return;
              if (event.payload.kind !== 'snapshot' && event.sequence !== sequence + 1) { recover(); return; }
              if (event.payload.kind === 'snapshot' && (event.payload.snapshot.id !== id || event.payload.snapshot.lastEventSequence !== event.sequence)) throw new Error('Invalid snapshot');
              sequence = event.sequence;
              receive(event);
            } catch { recover(); }
          };
          for (const kind of EVENT_KINDS) source.addEventListener(kind, handle);
          source.onmessage = handle;
          source.onerror = () => { if (!stopped && source === activeSource) recover(); };
        } catch { recover(); }
      }
      connection('connecting');
      void connect(false);
      return () => { stopped = true; source?.close(); clearTimeout(timer); };
    },
  };
}
