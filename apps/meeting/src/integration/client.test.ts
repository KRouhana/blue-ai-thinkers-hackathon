import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createHttpClient } from './client';
import type { ConnectionState, SessionEvent, SessionSnapshot } from './types';

const snapshot = (sequence = 4): SessionSnapshot => ({ id: 'session-a', captureEpoch: 'epoch-a', capture: 'listening', prototypeAutonomyEnabled: true, workspaceId: 'workspace-a', revision: { source: 2, config: 3 }, previewUrl: 'http://localhost:5174', currentTopic: null, lastEventSequence: sequence, experiments: [], clarification: null });
const event = (sequence: number): SessionEvent => ({ id: `event-${sequence}`, sessionId: 'session-a', sequence, at: '2026-09-12T12:00:00Z', payload: { kind: 'status', message: 'Building' } });
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
// B (apps/api) wraps every JSON body as {ok, data}; GET /sessions/:id additionally nests {snapshot, events}.
const created = (value: SessionSnapshot) => Response.json({ ok: true, data: value });
const fetched = (value: unknown) => Response.json({ ok: true, data: { snapshot: value, events: [] } });

function transport(t: TestContext) {
  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((message: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    listeners = new Map<string, Set<(message: { data: string }) => void>>();
    constructor(readonly url: string) { FakeEventSource.instances.push(this); }
    close() { this.closed = true; }
    addEventListener(type: string, listener: (message: { data: string }) => void) { (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(listener); }
    removeEventListener(type: string, listener: (message: { data: string }) => void) { this.listeners.get(type)?.delete(listener); }
    send(data: unknown, type = 'message') {
      const message = { data: JSON.stringify(data) };
      if (type === 'message') this.onmessage?.(message);
      for (const listener of this.listeners.get(type) ?? []) listener(message);
    }
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'EventSource');
  Object.defineProperty(globalThis, 'EventSource', { configurable: true, writable: true, value: FakeEventSource });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'EventSource', descriptor); else Reflect.deleteProperty(globalThis, 'EventSource'); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => fetched(snapshot(8)));
  const received: SessionEvent[] = [];
  const connections: ConnectionState[] = [];
  const unsubscribe = createHttpClient().subscribe('session-a', 4, e => received.push(e), state => connections.push(state));
  t.after(unsubscribe);
  return { FakeEventSource, fetchMock, received, connections, unsubscribe, source: FakeEventSource.instances[0] };
}

test('HTTP client sends configured project and encoded session controls without caching', async t => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init }); return calls.length === 1 ? created(snapshot()) : new Response(null, { status: 204 }); });
  const client = createHttpClient('/api', 'configured-project');
  assert.deepEqual(await client.create(), snapshot());
  await client.control('id/with space', { kind: 'cancel_job', jobId: 'job-a' });
  await client.capture('session-a', 'start');
  assert.equal(calls[0].url, '/api/sessions');
  assert.deepEqual(JSON.parse(calls[0].init?.body as string), { projectConfigId: 'configured-project' });
  assert.equal(calls[1].url, '/api/sessions/id%2Fwith%20space/controls');
  assert.deepEqual(JSON.parse(calls[1].init?.body as string), { kind: 'cancel_job', jobId: 'job-a' });
  assert.deepEqual(JSON.parse(calls[2].init?.body as string), { action: 'start', prototypeAutonomyEnabled: true });
  for (const call of calls) {
    assert.equal(call.init?.credentials, 'same-origin');
    assert.equal(call.init?.cache, 'no-store');
  }
});

test('HTTP errors and invalid snapshots are surfaced instead of reporting success', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
  await assert.rejects(createHttpClient().control('session-a', { kind: 'pause' }), /HTTP 403/);
  fetchMock.mock.mockImplementation(async () => fetched({ id: 'session-a' }));
  await assert.rejects(createHttpClient().snapshot('session-a'));
  fetchMock.mock.mockImplementation(async () => fetched({ ...snapshot(), id: 'another-session' }));
  await assert.rejects(createHttpClient().snapshot('session-a'), /session/i);
});

test('SSE ignores duplicates and recovers sequence gaps using a fresh snapshot', async t => {
  const { source, connections, received, FakeEventSource, fetchMock } = transport(t);
  assert.equal(source.url, '/api/sessions/session-a/events?after=4');
  source.onopen?.();
  source.send(event(5));
  source.send(event(5));
  source.send(event(4));
  assert.deepEqual(received.map(e => e.sequence), [5]);
  source.send(event(7));
  assert.equal(source.closed, true);
  assert.deepEqual(connections, ['connecting', 'connected', 'reconnecting']);
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(received.map(e => e.sequence), [5, 8]);
  assert.equal(received[1].payload.kind, 'snapshot');
  assert.equal(FakeEventSource.instances[1].url, '/api/sessions/session-a/events?after=8');
  FakeEventSource.instances[1].send(event(9));
  assert.equal(received.at(-1)?.sequence, 9);
});

test('a bare {kind, snapshot} frame (B\'s actual opening SSE line, named event "snapshot") is accepted', t => {
  const { source, received, connections } = transport(t);
  source.onopen?.();
  source.send({ kind: 'snapshot', snapshot: snapshot(4) }, 'snapshot');
  assert.deepEqual(received.map(e => e.sequence), []); // sequence 4 == after=4, not newer: correctly ignored
  source.send({ kind: 'snapshot', snapshot: snapshot(6) }, 'snapshot');
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].payload, { kind: 'snapshot', snapshot: snapshot(6) });
  assert.deepEqual(connections, ['connecting', 'connected']);
});

test('SSE wrong-session messages trigger recovery and never reach consumers', t => {
  const { source, received, connections } = transport(t);
  source.send({ ...event(5), sessionId: 'another-session' });
  assert.deepEqual(received, []);
  assert.equal(source.closed, true);
  assert.equal(connections.at(-1), 'reconnecting');
});

test('unsubscribe cancels pending reconnect and ignores queued callbacks', async t => {
  const { source, received, unsubscribe, fetchMock, FakeEventSource, connections } = transport(t);
  source.onerror?.();
  unsubscribe();
  const previousConnections = connections.slice();
  source.send(event(5));
  source.onopen?.();
  t.mock.timers.tick(10_000);
  await flush();
  assert.deepEqual(received, []);
  assert.deepEqual(connections, previousConnections);
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(FakeEventSource.instances.length, 1);
});

test('unsubscribe during snapshot fetch prevents delivery and stream recreation', async t => {
  const { source, received, unsubscribe, fetchMock, FakeEventSource } = transport(t);
  let resolveFetch!: (response: Response) => void;
  fetchMock.mock.mockImplementation(() => new Promise<Response>(resolve => { resolveFetch = resolve; }));
  source.onerror?.();
  t.mock.timers.tick(1000);
  unsubscribe();
  resolveFetch(fetched(snapshot(8)));
  await flush();
  assert.deepEqual(received, []);
  assert.equal(FakeEventSource.instances.length, 1);
});

test('reconnect rejects stale snapshots and retries without moving sequence backward', async t => {
  const { source, received, fetchMock, FakeEventSource } = transport(t);
  fetchMock.mock.mockImplementation(async () => fetched(snapshot(3)));
  source.send(event(5));
  source.onerror?.();
  t.mock.timers.tick(1000);
  await flush();
  assert.deepEqual(received.map(e => e.sequence), [5]);
  assert.equal(FakeEventSource.instances.length, 1);
  fetchMock.mock.mockImplementation(async () => fetched(snapshot(8)));
  t.mock.timers.tick(2000);
  await flush();
  assert.deepEqual(received.map(e => e.sequence), [5, 8]);
  assert.equal(FakeEventSource.instances[1].url, '/api/sessions/session-a/events?after=8');
});
