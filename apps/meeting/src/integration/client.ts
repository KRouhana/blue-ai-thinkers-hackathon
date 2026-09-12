import type { SessionClient, SessionSnapshot, SessionEvent } from './types';
import { snapshotSchema, eventSchema } from './schema';

export function createHttpClient(base = '/api', projectConfigId = 'demo-product', mode: 'existing_repo' | 'blank_template' = 'existing_repo'): SessionClient {
  const path = (id: string) => `${base}/sessions/${encodeURIComponent(id)}`;
  async function request(url: string, body?: unknown) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000), redirect: 'error',
      ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Session service returned HTTP ${response.status}. Check B’s API and session authorization.`);
    if (response.status === 204) return undefined;
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  }
  const snapshot = async (id: string) => {
    const value = snapshotSchema.parse(await request(path(id)));
    if (value.id !== id) throw new Error('Session service returned a different session.');
    return value;
  };
  return {
    create: async () => snapshotSchema.parse(await request(`${base}/sessions`, { projectConfigId, mode })),
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
          source.onmessage = message => {
            if (stopped || source !== activeSource) return;
            try {
              const event: SessionEvent = eventSchema.parse(JSON.parse(message.data));
              if (event.sessionId !== id) throw new Error('Wrong session');
              if (event.sequence <= sequence) return;
              if (event.payload.kind !== 'snapshot' && event.sequence !== sequence + 1) { recover(); return; }
              if (event.payload.kind === 'snapshot' && (event.payload.snapshot.id !== id || event.payload.snapshot.lastEventSequence !== event.sequence)) throw new Error('Invalid snapshot');
              sequence = event.sequence;
              receive(event);
            } catch { recover(); }
          };
          source.onerror = () => { if (!stopped && source === activeSource) recover(); };
        } catch { recover(); }
      }
      connection('connecting');
      void connect(false);
      return () => { stopped = true; source?.close(); clearTimeout(timer); };
    },
  };
}
