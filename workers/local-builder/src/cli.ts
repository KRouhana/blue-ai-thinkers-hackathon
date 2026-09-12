import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { createPrototypeEngine } from '../../../packages/prototype-engine/src/index.js';
import type { EngineOptions, PrototypeJob } from '../../../packages/prototype-engine/src/types.js';

const configIndex = process.argv.indexOf('--config');
const config = configIndex >= 0 ? JSON.parse(await readFile(process.argv[configIndex + 1], 'utf8')) as EngineOptions : {
  runtimeRoot: path.join(os.tmpdir(), `fork-c-${process.getuid?.() ?? 'local'}`),
  hostOrigin: 'http://localhost:3000', projects: [{ id: 'blank' }],
};
const send = (kind: string, data: unknown) => process.stdout.write(JSON.stringify({ kind, data }) + '\n');
const engine = await createPrototypeEngine({ ...config, onEvent: event => send('event', event) });
let current: Awaited<ReturnType<typeof engine.prepare>> | undefined;
let closing = false;
let activeJob: string | undefined;
send('help', { commands: ['prepare [projectId] [sessionId]', 'job <change>', 'patch <elementId> <size: sm|md|lg|xl>', 'undo', 'cancel', 'status', 'diff', 'request <JSON method/params>', 'quit'], note: 'Real local Codex execution. JSON lines on stdout. No B queue, HTTP mutation API, or simulated results.' });
const input = createInterface({ input: process.stdin, terminal: false });
async function close() {
  if (closing) return;
  closing = true;
  try { await engine.close(); input.close(); process.exitCode = 0; } catch (e) { closing = false; send('error', String(e)); }
}
async function command(line: string) {
  const [name, ...parts] = line.trim().split(/\s+/);
  try {
    if (name === 'quit') { await close(); return; }
    if (name === 'request') {
      const request = JSON.parse(line.trim().slice('request '.length));
      let result: unknown;
      switch (request.method) {
        case 'prepare': result = await engine.prepare(request.params); break;
        case 'applyPatch': result = await engine.applyPatch(request.params); break;
        case 'undo': result = await engine.undo(request.params); break;
        case 'runJob': result = await engine.runJob(request.params, event => send('progress', event)); break;
        case 'cancel': result = await engine.cancel(request.params.jobId); break;
        case 'getWorkspace': result = engine.getWorkspace(request.params.workspaceId); break;
        default: throw new Error('Unsupported adapter method.');
      }
      send('response', { requestId: request.requestId, result }); return;
    }
    if (name === 'cancel') { send('cancel', activeJob ? await engine.cancel(activeJob) : { accepted: false }); return; }
    if (name === 'prepare') {
      const projectId = parts[0] ?? config.projects[0].id;
      current = await engine.prepare({ sessionId: parts[1] ?? 'local-session', projectConfigId: projectId, mode: config.projects.find(p => p.id === projectId)?.sourcePath ? 'existing_repo' : 'blank_template' });
      send('prepared', current); return;
    }
    if (!current) throw new Error('Run prepare first.');
    const details = engine.getWorkspace(current.workspaceId);
    if (name === 'status') { send('workspace', details); return; }
    if (name === 'diff') {
      if (!details.lastCheckpointId) throw new Error('No completed change to inspect.');
      send('diff', await engine.getChanges(current.workspaceId, details.lastCheckpointId)); return;
    }
    if (name === 'job') {
      if (activeJob) throw new Error('A local job is already running. Cancel it or wait.');
      const jobId = randomUUID(); activeJob = jobId;
      const job: PrototypeJob = { id: jobId, experimentId: randomUUID(), sessionId: parts.length ? (await getSession()) : '', workspaceId: current.workspaceId, intentId: randomUUID(), expectedRevision: details.revision, brief: parts.join(' '), relevantSources: [], constraints: [], mockedIntegrations: [], mode: 'demo_only', verification: 'compile_and_render' };
      try { send('result', await engine.runJob(job, event => send('progress', event))); } finally { activeJob = undefined; }
      return;
    }
    if (name === 'undo') {
      if (!details.lastCheckpointId) throw new Error('No completed change to undo.');
      send('undo', await engine.undo({ operationId: randomUUID(), workspaceId: current.workspaceId, expectedRevision: details.revision, checkpointId: details.lastCheckpointId })); return;
    }
    if (name === 'patch') {
      send('patch', await engine.applyPatch({ operationId: randomUUID(), sessionId: await getSession(), workspaceId: current.workspaceId, expectedRevision: details.revision, patch: { kind: 'set_size', elementId: parts[0], value: parts[1] as 'lg' } })); return;
    }
    if (name) throw new Error(`Unknown command: ${name}`);
  } catch (e) { send('error', String(e)); }
}
// The local driver reads its own private preparation metadata; B already owns this binding in integration.
async function getSession(): Promise<string> {
  const metadata = JSON.parse(await readFile(path.join(config.runtimeRoot, current!.workspaceId, 'state.json'), 'utf8'));
  return metadata.sessionId;
}
input.on('line', line => { void command(line); });
input.on('close', () => { void close(); });
process.on('SIGINT', () => { void close(); });
process.on('SIGTERM', () => { void close(); });
