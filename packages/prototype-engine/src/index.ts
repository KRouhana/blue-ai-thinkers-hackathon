import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import type { ChildProcess } from 'node:child_process';
import { PreviewVerifier } from './browser.js';
import { canonical, changedFiles, copyManifest, digest, id, readJson, restore, scan, validId, within, writeJson } from './files.js';
import { assetsRoot, builtRoot, cleanEnv, findCodex, isAlive, readableRuntimePaths, sandboxPreflight, spawnPreview, spawnWorker, terminate } from './runtime.js';
import { error, safeText, sameRevision, validatePatch, type BrowserEvidence, type EngineEvent, type EngineOptions, type Manifest, type PatchRequest, type PatchResult, type PreparedWorkspace, type PrepareRequest, type PreviewMetadata, type PrototypeEngine, type PrototypeJob, type PrototypeResult, type RunnerMessage, type WorkspaceDetails, type WorkspaceState, type WorkerProgress } from './types.js';
export type * from './types.js';

interface Workspace {
  state: WorkspaceState;
  directory: string;
  source: string;
  dependencyRoot: string;
  meta: PreviewMetadata;
  url: string;
  server?: ChildProcess;
  serverLog: string;
  check: BrowserEvidence;
}
interface Checkpoint { manifest: Manifest; fingerprint: string; }

/** One local C instance per runtimeRoot. B owns dispatch, state, queueing, and authorization. */
export class LocalPrototypeEngine implements PrototypeEngine {
  private workspaces = new Map<string, Workspace>();
  private active?: { jobId: string; controller: AbortController; child?: ChildProcess };
  private busy = false;
  private sequence = 0;
  private root: string;
  private codex = '';
  private codexHome: string;
  private verifier: PreviewVerifier;
  private closed = false;
  private constructor(private options: EngineOptions) {
    this.root = path.resolve(options.runtimeRoot);
    this.codexHome = path.resolve(options.codexHome ?? path.join(os.homedir(), '.codex'));
    this.verifier = new PreviewVerifier(options.browserExecutable, options.renderTimeoutMs);
  }
  static async create(options: EngineOptions): Promise<LocalPrototypeEngine> {
    if (process.platform !== 'darwin') throw error('UNSUPPORTED_HOST', 'C currently supports a local Mac host.');
    if (new URL(options.hostOrigin).origin !== options.hostOrigin) throw error('INVALID_ORIGIN', 'hostOrigin must be an exact HTTP(S) origin without a path.');
    if (!/^https?:\/\//.test(options.hostOrigin)) throw error('INVALID_ORIGIN', 'Expected an HTTP(S) host origin.');
    const engine = new LocalPrototypeEngine(options);
    await mkdir(engine.root, { recursive: true, mode: 0o700 });
    engine.root = await canonical(engine.root);
    const controllerRepo = await canonical(path.join(builtRoot, '../../..'));
    if (engine.root === controllerRepo || engine.root.startsWith(controllerRepo + path.sep)) throw error('INVALID_WORKSPACE', 'runtimeRoot must be outside the Fork controller repository.');
    const lock = path.join(engine.root, 'engine.lock');
    try { await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const owner = Number(await readFile(lock, 'utf8'));
      if (!Number.isSafeInteger(owner) || owner <= 0 || isAlive(owner)) throw error('WORKSPACE_BUSY', 'Another engine owns this runtime directory.');
      // Old child processes must be gone before taking over an interrupted runtime.
      for (const entry of await readdir(engine.root)) {
        if (!entry.endsWith('.pid')) continue;
        const pid = Number(await readFile(path.join(engine.root, entry), 'utf8'));
        if (!Number.isSafeInteger(pid) || isAlive(pid)) throw error('RECOVERY_REQUIRED', 'An old child is still running. Stop the old C process group before restarting.');
        await rm(path.join(engine.root, entry));
      }
      await rm(lock);
      await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
    }
    try {
      engine.codex = await findCodex(options.codexPath);
      for (const project of options.projects) validId(project.id);
      if (new Set(options.projects.map(p => p.id)).size !== options.projects.length) throw error('INVALID_PROJECT', 'Duplicate project configuration IDs.');
      return engine;
    } catch (e) { await rm(lock, { force: true }); throw e; }
  }
  private emit(w: Workspace, operationId: string, kind: EngineEvent['kind'], message: string, extra: Partial<EngineEvent> = {}): void {
    const event: EngineEvent = { workspaceId: w.state.id, operationId, sequence: ++this.sequence, at: new Date().toISOString(), kind, message: safeText(message), ...extra };
    try { this.options.onEvent?.(event); } catch { /* A UI sink must not strand a filesystem operation. */ }
  }
  private file(w: Workspace, name: string): string { return path.join(w.directory, name); }
  private async save(w: Workspace): Promise<void> { await writeJson(this.file(w, 'state.json'), w.state); }
  private enter(): void {
    if (this.closed) throw error('CLOSED', 'Engine has been closed.');
    if (this.busy) throw error('WORKSPACE_BUSY', 'C is already mutating a workspace. B must serialize calls.');
    this.busy = true;
  }
  private workspace(workspaceId: string): Workspace {
    validId(workspaceId);
    const w = this.workspaces.get(workspaceId);
    if (!w) throw error('UNKNOWN_WORKSPACE', 'Call prepare for this configured session first.');
    if (w.state.blocked) throw error('RECOVERY_REQUIRED', w.state.blocked);
    return w;
  }
  private async assertCurrent(w: Workspace, expected: { source: number; config: number }): Promise<void> {
    if (!expected || !Number.isSafeInteger(expected.source) || !Number.isSafeInteger(expected.config) || !sameRevision(w.state.revision, expected)) throw error('STALE_REVISION', 'Request does not match the current workspace revision.');
    if ((await scan(w.source)).fingerprint !== w.state.fingerprint) throw error('WORKSPACE_CONFLICT', 'Files changed outside C. Preserve them and prepare a fresh workspace; do not reset over external edits.');
  }
  private known<T>(w: Workspace, operationId: string, request: unknown): T | undefined {
    validId(operationId);
    const previous = w.state.operations[operationId];
    if (!previous) return undefined;
    if (previous.digest !== digest(request)) throw error('OPERATION_CONFLICT', 'Operation ID was reused with different content.');
    return structuredClone(previous.result) as T;
  }
  private async remember(w: Workspace, operationId: string, request: unknown, result: unknown): Promise<void> {
    if (!w.state.blocked) w.state.pending = null;
    w.state.operations[operationId] = { digest: digest(request), result };
    await this.save(w);
  }
  private async checkpoint(w: Workspace, operationId: string, kind: string): Promise<string> {
    if (Object.keys(w.state.operations).length >= 100) throw error('SESSION_LIMIT', 'This workspace reached 100 operations; retain/export it and prepare a new session.');
    const checkpointId = id();
    const dir = this.file(w, `checkpoints/${checkpointId}`);
    await copyManifest(w.source, path.join(dir, 'source'), w.state.manifest);
    await writeJson(path.join(dir, 'checkpoint.json'), { manifest: w.state.manifest, fingerprint: w.state.fingerprint });
    w.state.pending = { id: operationId, checkpointId, kind };
    await this.save(w);
    return checkpointId;
  }
  private async updateMeta(w: Workspace, operationId: string): Promise<void> {
    w.meta = { ...w.meta, revision: { ...w.state.revision }, operationId };
    await writeJson(this.file(w, 'preview.json'), w.meta);
  }
  private async verify(w: Workspace, operationId: string, signal?: AbortSignal): Promise<BrowserEvidence> {
    await this.updateMeta(w, operationId);
    w.check = await this.verifier.check(w.url, w.meta, signal);
    if (w.check.compile === 'passed' && w.check.page === 'rendered') this.emit(w, operationId, 'preview', 'Preview compiled and rendered.', { revision: w.state.revision });
    else this.emit(w, operationId, 'error', w.check.diagnostics.join('\n'));
    return w.check;
  }
  private async restoreCheckpoint(w: Workspace, checkpointId: string, operationId: string): Promise<void> {
    validId(checkpointId);
    const dir = this.file(w, `checkpoints/${checkpointId}`);
    const checkpoint = await readJson<Checkpoint>(path.join(dir, 'checkpoint.json'));
    await restore(path.join(dir, 'source'), w.source, checkpoint.manifest);
    w.state.manifest = checkpoint.manifest;
    w.state.fingerprint = checkpoint.fingerprint;
    w.state.revision = { source: w.state.revision.source + 1, config: w.state.revision.config + 1 };
    w.state.threadId = undefined;
    this.emit(w, operationId, 'phase', 'Restoring the previous source and preview.');
    const check = await this.verify(w, operationId);
    if (check.compile !== 'passed' || check.page !== 'rendered') throw error('RESTORE_FAILED', 'Checkpoint files were restored, but the preview could not be verified.');
  }
  private async captureResult(w: Workspace): Promise<string[]> {
    const current = await scan(w.source);
    const changes = changedFiles(w.state.manifest, current.manifest);
    if (changes.some(p => p !== 'public/fork-config.json')) w.state.revision.source++;
    if (changes.includes('public/fork-config.json')) w.state.revision.config++;
    w.state.manifest = current.manifest;
    w.state.fingerprint = current.fingerprint;
    return changes;
  }
  private async startPreview(w: Workspace): Promise<void> {
    const port = await new Promise<number>((resolve, reject) => {
      const socket = net.createServer(); socket.once('error', reject);
      socket.listen(0, '127.0.0.1', () => { const port = (socket.address() as net.AddressInfo).port; socket.close(() => resolve(port)); });
    });
    w.meta.instanceId = id();
    await this.updateMeta(w, 'prepare');
    const temp = this.file(w, 'preview-temp');
    const readable = await readableRuntimePaths(w.dependencyRoot);
    const child = await spawnPreview({ source: w.source, meta: this.file(w, 'preview.json'), temp, readable, port, dependencyRoot: w.dependencyRoot });
    w.server = child;
    await writeFile(path.join(this.root, `${w.state.id}-preview.pid`), String(child.pid));
    child.stdout?.on('data', b => { w.serverLog = (w.serverLog + safeText(String(b))).slice(-8000); });
    child.stderr?.on('data', b => { w.serverLog = (w.serverLog + safeText(String(b))).slice(-8000); });
    child.on('error', () => {});
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(error('PREVIEW_TIMEOUT', w.serverLog || 'Preview did not start.')), 20_000);
      child.once('error', e => { clearTimeout(timer); reject(e); });
      child.once('exit', code => { clearTimeout(timer); reject(error('PREVIEW_EXITED', `Preview exited (${code}): ${w.serverLog}`)); });
      child.once('message', message => {
        if ((message as { kind: string }).kind === 'listening') { clearTimeout(timer); resolve(); }
      });
    });
    w.url = `http://127.0.0.1:${port}${w.state.project.route ?? '/'}`;
  }
  async prepare(request: PrepareRequest): Promise<PreparedWorkspace> {
    validId(request.sessionId); validId(request.projectConfigId);
    const project = this.options.projects.find(p => p.id === request.projectConfigId);
    if (!project) throw error('UNKNOWN_PROJECT', 'Project must be registered in host configuration.');
    if (!['blank_template', 'existing_repo'].includes(request.mode) || (request.mode === 'existing_repo') !== !!project.sourcePath) throw error('INVALID_PROJECT', 'Preparation mode must match configured source.');
    if (project.route && (!project.route.startsWith('/') || project.route.startsWith('//') || project.route.includes('?') || project.route.includes('#'))) throw error('INVALID_ROUTE', 'Configure one local pathname.');
    const workspaceId = digest({ session: request.sessionId, project: request.projectConfigId }).slice(0, 24);
    const existing = this.workspaces.get(workspaceId);
    if (existing) return this.getWorkspace(workspaceId);
    this.enter();
    let w: Workspace | undefined;
    try {
      const directory = path.join(this.root, workspaceId);
      const source = path.join(directory, 'source');
      const original = await canonical(project.sourcePath ?? path.join(assetsRoot, 'template'));
      if (original === this.root || original.startsWith(this.root + path.sep) || this.root.startsWith(original + path.sep)) throw error('INVALID_PROJECT', 'Source and runtime directories must not overlap.');
      const dependencyRoot = await canonical(project.dependencyPath ?? (project.sourcePath ? path.join(original, 'node_modules') : path.join(builtRoot, '../node_modules')));
      const pkg = await readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(path.join(original, 'package.json'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (!deps.react || !deps['react-dom'] || !deps.vite) throw error('UNSUPPORTED_FRAMEWORK', 'Initial support is React/Vite with installed dependencies.');
      await readFile(path.join(dependencyRoot, 'react/package.json'));
      await readFile(path.join(dependencyRoot, 'react-dom/package.json'));
      let state: WorkspaceState;
      try {
        state = await readJson<WorkspaceState>(path.join(directory, 'state.json'));
        if (digest(state.project) !== digest(project)) throw error('PROJECT_CONFIG_CHANGED', 'Use a new session after changing host project configuration.');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        const before = await scan(original, true);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await copyManifest(original, source, before.manifest);
        if ((await scan(original, true)).fingerprint !== before.fingerprint) throw error('SOURCE_CHANGED', 'Original files changed while copying. Retry preparation.');
        const prepared = await scan(source);
        state = { id: workspaceId, sessionId: request.sessionId, project, mode: request.mode, revision: { source: 0, config: 0 }, manifest: prepared.manifest, fingerprint: prepared.fingerprint, lastCheckpointId: null, blocked: null, pending: null, operations: {} };
      }
      await mkdir(path.join(source, '.fork-cache'), { recursive: true });
      try { await symlink(dependencyRoot, path.join(source, 'node_modules'), 'dir'); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; if (await canonical(path.join(source, 'node_modules')) !== dependencyRoot) throw error('DEPENDENCY_CONFLICT', 'Dependency link changed.'); }
      w = { state, directory, source, dependencyRoot, url: '', serverLog: '', check: { compile: 'failed', page: 'failed', diagnostics: ['Preview has not been checked.'] }, meta: { workspaceId, revision: state.revision, operationId: 'prepare', instanceId: id(), hostOrigin: this.options.hostOrigin } };
      await this.save(w);
      await sandboxPreflight(this.codex, source, this.codexHome, await readableRuntimePaths(dependencyRoot));
      await this.startPreview(w);
      if (state.pending) {
        await this.restoreCheckpoint(w, state.pending.checkpointId, state.pending.id);
        state.pending = null; state.blocked = null;
      } else if (state.blocked) throw error('RECOVERY_REQUIRED', state.blocked);
      else await this.assertCurrent(w, state.revision);
      const check = await this.verify(w, 'prepare');
      if (check.page !== 'rendered' || check.compile !== 'passed') throw error('PREVIEW_FAILED', check.diagnostics.join('\n'));
      await this.save(w);
      this.workspaces.set(workspaceId, w);
      return this.getWorkspace(workspaceId);
    } catch (e) {
      if (w?.server) await terminate(w.server);
      throw e;
    } finally { this.busy = false; }
  }
  getWorkspace(workspaceId: string): WorkspaceDetails {
    const w = this.workspace(workspaceId);
    const sources = Object.entries(w.state.manifest).filter(([p]) => /\.(jsx?|tsx?|css|html)$/.test(p)).slice(0, 80).map(([p, f]) => ({ kind: 'repo' as const, path: p, fingerprint: f.hash }));
    return {
      workspaceId, sourcePath: w.source, revision: { ...w.state.revision }, previewUrl: w.url,
      renderState: w.check.page === 'rendered' && w.check.compile === 'passed' ? 'rendered' : 'failed',
      repoMap: { workspaceId, origin: w.state.mode, fingerprint: w.state.fingerprint, framework: { name: 'React/Vite', verified: true }, routes: [{ route: w.state.project.route ?? '/', sources }], relevantSources: sources, mockCapabilities: [], limitations: ['One configured route; no automatic arbitrary-framework or backend onboarding.', 'Controlled Vite startup ignores project vite.config and lifecycle scripts.', 'Generated app external network access is disabled.'] },
      startupCommand: 'C-supervised Vite (configFile=false, loopback only)', lastCheckpointId: w.state.lastCheckpointId, blocked: w.state.blocked, check: structuredClone(w.check),
    };
  }
  async runJob(job: PrototypeJob, progress: (event: WorkerProgress) => void, signal?: AbortSignal): Promise<PrototypeResult> {
    const w = this.workspace(job.workspaceId);
    if (job.sessionId !== w.state.sessionId || job.mode !== 'demo_only' || job.verification !== 'compile_and_render' || typeof job.brief !== 'string' || !job.brief.trim() || job.brief.length > 12_000 || !Array.isArray(job.constraints) || !Array.isArray(job.relevantSources) || !Array.isArray(job.mockedIntegrations)) throw error('INVALID_JOB', 'Invalid job or session binding.');
    const previous = this.known<PrototypeResult>(w, job.id, job);
    if (previous) return previous;
    this.enter();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    this.active = { jobId: job.id, controller };
    let checkpointId: string | null = null;
    const before = { ...w.state.revision };
    let files: string[] = [];
    let failureCheck: PrototypeResult['check'] = { compile: 'not_checked', page: 'not_checked', diagnostics: [] };
    const report = (state: WorkerProgress['state'], message: string) => {
      this.emit(w, job.id, 'phase', message, { state });
      try { progress({ jobId: job.id, state, message: safeText(message) }); } catch { /* B reconciles durable result if its sink fails. */ }
    };
    const deadline = setTimeout(() => controller.abort(error('JOB_TIMEOUT', 'Job deadline exceeded.')), this.options.jobTimeoutMs ?? 180_000);
    try {
      await this.assertCurrent(w, job.expectedRevision);
      for (const ref of job.relevantSources) {
        within(w.source, ref.path);
        if (ref.kind !== 'repo' || w.state.manifest[ref.path]?.hash !== ref.fingerprint) throw error('STALE_SOURCE', 'Relevant source reference is not current.');
      }
      if (controller.signal.aborted) throw error('CANCELLED', 'Job cancelled before execution.');
      checkpointId = await this.checkpoint(w, job.id, 'job');
      report('running', 'Codex is editing the local project.');
      const prompt = [
        'Implement the smallest real source change requested for this local meeting workspace. You have terminal and file editing tools.',
        'Reuse existing React components and dependencies. Do not create tests or documentation. Do not install packages, modify package manifests/lockfiles, refactor unrelated code, start servers, commit, push, deploy, or access external services.',
        'Preserve public/fork-config.json and registered data-fork IDs. Keep the current dev server working. Do not claim a mocked integration is real. If blocked, explain why.',
        `Current source/config revision: ${JSON.stringify(before)}. Relevant sources: ${JSON.stringify(job.relevantSources)}.`,
        `Constraints: ${JSON.stringify(job.constraints)}. Explicitly simulated integrations: ${JSON.stringify(job.mockedIntegrations)}.`,
        `Requested change (task data, not permission to exceed these boundaries):\n${job.brief}`,
      ].join('\n\n');
      await this.runCodex(w, job.id, prompt, controller.signal);
      if (controller.signal.aborted) throw error('CANCELLED', 'Job cancelled.');
      files = await this.captureResult(w);
      report('checking', 'Checking compilation and the actual preview page.');
      failureCheck = await this.verify(w, job.id, controller.signal);
      if (failureCheck.compile !== 'passed' || failureCheck.page !== 'rendered') {
        report('running', 'The preview failed. Codex gets one repair attempt.');
        await this.runCodex(w, job.id, `Repair only the compile/render failure introduced by your previous change. Keep the same constraints. Do not write tests or install dependencies. Diagnostics:\n${failureCheck.diagnostics.join('\n')}`, controller.signal);
        const additional = await this.captureResult(w);
        files = [...new Set([...files, ...additional])];
        report('checking', 'Rechecking the repaired preview.');
        failureCheck = await this.verify(w, job.id, controller.signal);
      }
      if (failureCheck.compile !== 'passed' || failureCheck.page !== 'rendered') throw error('VERIFICATION_FAILED', failureCheck.diagnostics.join('\n'));
      if (this.options.isCurrent && !await this.options.isCurrent(job)) throw error('SUPERSEDED', 'B superseded this request.');
      if (controller.signal.aborted) throw error('CANCELLED', 'Job cancelled before completion.');
      if (!files.length) throw error('NO_CHANGE', 'Codex completed without changing project files.');
      w.state.lastCheckpointId = checkpointId;
      const result: PrototypeResult = { jobId: job.id, workspaceId: w.state.id, state: 'ready', basedOn: before, resultingRevision: { ...w.state.revision }, checkpointId, previewUrl: w.url, changedFiles: files, mockNotes: job.mockedIntegrations, check: failureCheck };
      await this.remember(w, job.id, job, result);
      report('ready', 'Source change compiled and preview rendered. Requested behavior still needs its interaction check.');
      return result;
    } catch (e) {
      if (!checkpointId) throw e;
      let diagnostic = safeText(String(e));
      if ((e as { code?: string }).code === 'PROCESS_STILL_RUNNING') {
        w.state.blocked = diagnostic;
      } else {
        try { await this.restoreCheckpoint(w, checkpointId, job.id); }
        catch (restoreError) { w.state.blocked = safeText(String(restoreError)); diagnostic += '\n' + w.state.blocked; }
      }
      const state = (e as { code?: string }).code === 'SUPERSEDED' ? 'superseded' : controller.signal.aborted && !(controller.signal.reason instanceof Error && 'code' in controller.signal.reason && controller.signal.reason.code === 'JOB_TIMEOUT') ? 'cancelled' : 'failed';
      const result: PrototypeResult = { jobId: job.id, workspaceId: w.state.id, state, basedOn: before, resultingRevision: { ...w.state.revision }, checkpointId, previewUrl: w.state.blocked ? null : w.url, changedFiles: [], mockNotes: job.mockedIntegrations, check: { ...failureCheck, diagnostics: [...failureCheck.diagnostics, diagnostic] } };
      await this.remember(w, job.id, job, result);
      report(state, w.state.blocked ? diagnostic : `${diagnostic}\nPrevious working preview restored.`);
      return result;
    } finally { clearTimeout(deadline); signal?.removeEventListener('abort', abort); this.active = undefined; this.busy = false; }
  }
  private async runCodex(w: Workspace, operationId: string, prompt: string, signal: AbortSignal): Promise<void> {
    const runtimePath = this.file(w, 'worker-temp');
    await mkdir(runtimePath, { recursive: true, mode: 0o700 });
    const child = spawnWorker(path.join(builtRoot, 'packages/prototype-engine/src/codex-session.js'), w.source, runtimePath);
    if (this.active) this.active.child = child;
    await writeFile(path.join(this.root, `${w.state.id}-worker.pid`), String(child.pid));
    let stderr = '';
    child.stderr?.on('data', b => { stderr = (stderr + safeText(String(b))).slice(-8000); });
    child.on('error', () => {});
    const abort = () => { if (child.connected) child.send({ cancel: true }); setTimeout(() => { void terminate(child).catch(() => {}); }, 1000).unref(); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (signal.aborted) throw error('CANCELLED', 'Worker cancelled before start.');
      const readablePaths = await readableRuntimePaths(w.dependencyRoot);
      await new Promise<void>((resolve, reject) => {
        let done = false;
        child.once('error', reject);
        child.once('exit', code => { if (!done) reject(error('WORKER_EXITED', stderr || `Worker exited (${code}).`)); });
        child.on('message', (message: RunnerMessage) => {
          if (message.kind === 'done') { done = true; w.state.threadId = message.threadId; resolve(); }
          else if (message.kind === 'error') { done = true; reject(error('CODEX_FAILED', message.message ?? 'Worker failed.')); }
          else {
            const event = message.event as { type: string; item?: { type: string; command?: string; aggregated_output?: string; text?: string; changes?: Array<{ path: string }> } };
            if (event.item?.type === 'command_execution') {
              this.emit(w, operationId, 'command', event.item.command ?? 'Command');
              if (event.item.aggregated_output) this.emit(w, operationId, 'output', event.item.aggregated_output);
            } else if (event.item?.type === 'file_change') this.emit(w, operationId, 'files', 'Source files changed.', { files: event.item.changes?.map(c => path.isAbsolute(c.path) ? path.relative(w.source, c.path) : c.path) });
            else if (event.item?.type === 'agent_message') this.emit(w, operationId, 'output', event.item.text ?? '');
          }
        });
        child.send({ sourcePath: w.source, codexPath: this.codex, codexHome: this.codexHome, runtimePath, readablePaths, prompt, model: this.options.model, threadId: w.state.threadId });
      });
    } finally {
      signal.removeEventListener('abort', abort);
      await terminate(child);
      await rm(path.join(this.root, `${w.state.id}-worker.pid`), { force: true });
      if (this.active) this.active.child = undefined;
    }
  }
  async cancel(jobId: string): Promise<{ accepted: boolean }> {
    validId(jobId);
    if (this.active?.jobId !== jobId) return { accepted: false };
    this.active.controller.abort();
    return { accepted: true };
  }
  async applyPatch(request: PatchRequest): Promise<PatchResult> {
    const w = this.workspace(request.workspaceId);
    if (request.sessionId !== w.state.sessionId) throw error('INVALID_SESSION', 'Session does not own workspace.');
    validatePatch(request.patch);
    const previous = this.known<PatchResult>(w, request.operationId, request);
    if (previous) return previous;
    const property = { set_size: 'size', set_background: 'background', set_label: 'label', set_radius: 'radius', set_visibility: 'visible' }[request.patch.kind];
    const registry = w.state.project.registeredElements ?? (w.state.mode === 'blank_template' ? { 'start-button': { sourcePath: 'src/main.jsx', properties: ['size', 'background', 'label', 'radius', 'visible'] } } : {});
    const target = registry[request.patch.elementId];
    if (!target || !target.properties.includes(property as never)) throw error('UNREGISTERED_TARGET', 'Use a source job for this element/property.');
    const source = await readFile(within(w.source, target.sourcePath), 'utf8');
    if (!source.includes(`data-fork-id="${request.patch.elementId}"`)) throw error('STALE_TARGET', 'Registered source mapping no longer matches the element.');
    this.enter();
    let checkpointId: string | null = null;
    try {
      await this.assertCurrent(w, request.expectedRevision);
      const configPath = within(w.source, 'public/fork-config.json');
      const config = await readJson<{ elements: Record<string, Record<string, unknown>> }>(configPath);
      if (!config.elements || typeof config.elements !== 'object' || Array.isArray(config.elements)) throw error('INVALID_CONFIG', 'Invalid registered component config.');
      checkpointId = await this.checkpoint(w, request.operationId, 'patch');
      config.elements[request.patch.elementId] = { ...config.elements[request.patch.elementId], [property]: request.patch.value };
      await writeJson(configPath, config);
      await this.captureResult(w);
      const check = await this.verify(w, request.operationId);
      if (check.page !== 'rendered' || check.compile !== 'passed') throw error('PATCH_RENDER_FAILED', check.diagnostics.join('\n'));
      w.state.lastCheckpointId = checkpointId;
      const result = { operationId: request.operationId, applied: true, revision: { ...w.state.revision }, checkpointId };
      await this.remember(w, request.operationId, request, result);
      return result;
    } catch (e) {
      if (!checkpointId) throw e;
      try { await this.restoreCheckpoint(w, checkpointId, request.operationId); } catch (r) { w.state.blocked = safeText(String(r)); }
      const result = { operationId: request.operationId, applied: false, revision: { ...w.state.revision }, checkpointId, diagnostic: safeText(String(e)) + (w.state.blocked ? `\n${w.state.blocked}` : '') };
      await this.remember(w, request.operationId, request, result);
      return result;
    } finally { this.busy = false; }
  }
  async undo(request: { operationId: string; workspaceId: string; expectedRevision: { source: number; config: number }; checkpointId: string }): Promise<PatchResult> {
    const w = this.workspace(request.workspaceId);
    const previous = this.known<PatchResult>(w, request.operationId, request);
    if (previous) return previous;
    if (request.checkpointId !== w.state.lastCheckpointId) throw error('UNDO_CONFLICT', 'Only the latest successful change can be undone.');
    this.enter();
    let checkpointId: string | null = null;
    try {
      await this.assertCurrent(w, request.expectedRevision);
      checkpointId = await this.checkpoint(w, request.operationId, 'undo');
      await this.restoreCheckpoint(w, request.checkpointId, request.operationId);
      w.state.lastCheckpointId = checkpointId;
      const result = { operationId: request.operationId, applied: true, revision: { ...w.state.revision }, checkpointId };
      await this.remember(w, request.operationId, request, result);
      return result;
    } catch (e) {
      if (checkpointId) {
        try { await this.restoreCheckpoint(w, checkpointId, request.operationId); } catch (r) { w.state.blocked = safeText(String(r)); }
        w.state.pending = null; await this.save(w);
      }
      throw e;
    } finally { this.busy = false; }
  }
  /** Private host artifact; B must authenticate callers and never forward source contents into the iframe. */
  async getChanges(workspaceId: string, checkpointId: string): Promise<{ files: Array<{ path: string; before: string | null; after: string | null }> }> {
    const w = this.workspace(workspaceId); validId(checkpointId);
    const dir = this.file(w, `checkpoints/${checkpointId}`);
    const checkpoint = await readJson<Checkpoint>(path.join(dir, 'checkpoint.json'));
    const files = changedFiles(checkpoint.manifest, w.state.manifest);
    return { files: await Promise.all(files.map(async relative => ({ path: relative,
      before: checkpoint.manifest[relative] ? (await readFile(within(path.join(dir, 'source'), relative), 'utf8')).slice(0, 100_000) : null,
      after: w.state.manifest[relative] ? (await readFile(within(w.source, relative), 'utf8')).slice(0, 100_000) : null }))) };
  }
  async close(): Promise<void> {
    this.active?.controller.abort();
    for (let i = 0; this.busy && i < 300; i++) await new Promise(resolve => setTimeout(resolve, 100));
    if (this.busy) throw error('SHUTDOWN_PENDING', 'Cancellation/restoration is still running. Keep the engine alive and retry close.');
    for (const w of this.workspaces.values()) {
      if (w.server) await terminate(w.server);
      await rm(path.join(this.root, `${w.state.id}-preview.pid`), { force: true });
    }
    await this.verifier.close();
    await rm(path.join(this.root, 'engine.lock'), { force: true });
    this.closed = true;
  }
}

export const createPrototypeEngine = (options: EngineOptions): Promise<LocalPrototypeEngine> => LocalPrototypeEngine.create(options);
