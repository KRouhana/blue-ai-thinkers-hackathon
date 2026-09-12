/**
 * Local-only live-demo host. It exists so Track A can be exercised before B/D
 * mount its exports. It stores neither raw audio nor observations on disk.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { CaptureController } from './capture-controller.js';
import type { Observation, ObservationSink } from './contracts.js';
import { createRecallRuntime } from './node.js';

const port = integerEnv('PERCEPTION_PORT', 4318);
const sessionId = process.env.PERCEPTION_DEMO_SESSION_ID ?? 'live-demo';
const workspaceId = process.env.PERCEPTION_DEMO_WORKSPACE_ID ?? 'local-preview';
const clients = new Set<ServerResponse>();
let controller: CaptureController;

const server = createServer((request, response) => {
  void handle(request, response);
});

const runtime = createRecallRuntime({
  server,
  sink: async (observations) => publish('observations', observations),
  sessionId,
  streamId: 'google-meet',
  openRouterApiKey: requiredEnv('OPENROUTER_API_KEY'),
  openRouterTranscriptionModel: process.env.OPENROUTER_TRANSCRIPTION_MODEL?.trim() || 'openai/gpt-transcribe',
  recallApiKey: requiredEnv('RECALL_API_KEY'),
  recallVerificationSecret: requiredEnv('RECALL_WORKSPACE_VERIFICATION_SECRET'),
  recallRegion: recallRegion(requiredEnv('RECALL_REGION')),
  publicApiBaseUrl: requiredEnv('PUBLIC_API_BASE_URL'),
});
controller = runtime.controller;
controller.subscribeStatus((status) => publish('status', status));
controller.subscribeCaptions((captions) => publish('captions', captions));

server.listen(port, '127.0.0.1', () => {
  // Deliberately excludes environment values and any received media.
  console.info(`Fork perception demo: http://127.0.0.1:${port}`);
  console.info(`Recall callback: ${runtime.callbackUrl}`);
});

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
  if (request.method === 'GET' && url.pathname === '/') return html(response, hostPage());
  if (request.method === 'GET' && url.pathname === '/preview') return html(response, previewPage());
  if (request.method === 'GET' && url.pathname === '/events') return events(request, response);
  if (request.method === 'GET' && url.pathname === '/api/status') return json(response, {
    ...controller.getStatus(), sessionId, workspaceId,
  });
  if (request.method === 'POST' && url.pathname === '/api/capture/start') return start(request, response);
  if (request.method === 'POST' && url.pathname === '/api/capture/pause') return control(response, () => controller.pause());
  if (request.method === 'POST' && url.pathname === '/api/capture/resume') return control(response, () => controller.resume());
  if (request.method === 'POST' && url.pathname === '/api/capture/stop') return control(response, () => controller.stop());
  if (request.method === 'POST' && url.pathname === '/api/observations') return receivePreview(request, response);
  if (request.method === 'GET' && url.pathname.startsWith('/assets/')) return asset(url.pathname, response);
  response.writeHead(404).end('Not found');
}

async function start(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await requestJson(request);
  const meetingUrl = typeof body.meetingUrl === 'string' ? body.meetingUrl : '';
  if (!meetingUrl) return json(response, { error: 'A Google Meet link is required.' }, 400);
  await control(response, () => controller.start({ meetingUrl }));
}

async function control(response: ServerResponse, operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
    json(response, controller.getStatus());
  } catch {
    // The status surface is safe and avoids echoing upstream request details.
    json(response, { error: controller.getStatus().message ?? 'The capture operation failed.' }, 400);
  }
}

async function receivePreview(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await requestJson(request);
  const observations = Array.isArray(body.observations) ? body.observations : [];
  if (!observations.every(isPreviewObservation)) return json(response, { error: 'Only validated preview-context observations are accepted.' }, 400);
  await receiveFromPreview(observations);
  json(response, { accepted: observations.length });
}

const receiveFromPreview: ObservationSink = async (observations) => publish('observations', observations);

function isPreviewObservation(value: unknown): value is Extract<Observation, { kind: 'preview_context' }> {
  return typeof value === 'object' && value !== null
    && (value as { kind?: unknown }).kind === 'preview_context'
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { sessionId?: unknown }).sessionId === 'string'
    && Array.isArray((value as { elements?: unknown }).elements);
}

function events(request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive',
  });
  response.write(': connected\n\n');
  clients.add(response);
  request.on('close', () => clients.delete(response));
}

function publish(type: string, data: unknown): void {
  const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) client.write(event);
}

async function asset(pathname: string, response: ServerResponse): Promise<void> {
  const name = basename(pathname);
  if (!/^[a-z0-9_-]+\.js$/i.test(name)) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const source = await readFile(resolve('dist', name));
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }).end(source);
  } catch {
    response.writeHead(404).end('Build the package before running the demo.');
  }
}

function json(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(body));
}

function html(response: ServerResponse, body: string): void {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(body);
}

async function requestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required in .env.`);
  return value;
}

function integerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isSafeInteger(value) && value > 0 && value < 65_536 ? value : fallback;
}

function recallRegion(value: string): 'us-west-2' | 'us-east-1' | 'eu-central-1' | 'ap-northeast-1' {
  if (value === 'us-west-2' || value === 'us-east-1' || value === 'eu-central-1' || value === 'ap-northeast-1') return value;
  throw new Error('RECALL_REGION must be us-west-2, us-east-1, eu-central-1, or ap-northeast-1.');
}

async function shutdown(): Promise<void> {
  await controller.stop().catch(() => undefined);
  runtime.receiver.close();
  server.close();
}

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

function hostPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fork perception demo</title>
<style>body{font:15px system-ui;max-width:900px;margin:2rem auto;padding:0 1rem}input{width:min(34rem,100%)}button{margin:.25rem}pre{white-space:pre-wrap;background:#f4f4f5;padding:.75rem;border-radius:.5rem}iframe{width:100%;height:260px;border:1px solid #ddd;border-radius:.5rem}</style></head>
<body><h1>Fork perception — live demo</h1><p id="status">Loading…</p>
<label>Consented Google Meet link <input id="meeting-url" type="url" placeholder="https://meet.google.com/abc-defg-hij"></label>
<p><button data-action="start">Start</button><button data-action="pause">Pause</button><button data-action="resume">Resume</button><button data-action="stop">Stop</button></p>
<h2>Live captions</h2><pre id="captions">No speech captured yet.</pre>
<h2>Preview context</h2><p>Hover or focus an annotated element in this frame. It is evidence only; it cannot change the preview.</p><iframe id="preview" src="/preview" title="Annotated preview"></iframe>
<script type="module" src="/assets/demo-host.js"></script></body></html>`;
}

function previewPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:15px system-ui;padding:1rem}button{padding:.7rem 1rem;border-radius:.5rem;border:0;background:#155eef;color:white}.card{border:1px solid #ddd;padding:1rem;border-radius:.5rem}</style></head>
<body><main data-fork-section="Signup"><h1>Demo signup</h1><div class="card"><h2>Build something together</h2><button data-fork-id="start-trial" data-fork-editable="size,background,label,radius">Start trial</button></div></main>
<script type="module" src="/assets/demo-preview.js"></script></body></html>`;
}
