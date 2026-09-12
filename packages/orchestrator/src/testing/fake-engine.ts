import type {
  PatchRequest, PatchResult, PrepareRequest, PreparedWorkspace, PreviewElement, PreviewPatch,
  PrototypeEngine, PrototypeJob, PrototypeResult, Revision, WorkerProgress,
} from '@fork/contracts';
import { DEMO_WORKSPACE } from './demo-workspace';

const same = (a: Revision, b: Revision): boolean => a.source === b.source && a.config === b.config;

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

export interface FakeEngineOptions {
  workspaceId?: string;
  previewUrl?: string;
  jobDelayMs?: number;
}

/**
 * FIXTURE PrototypeEngine. It simulates revisions, checkpoints, progress, and failure so the
 * orchestrator pipeline can be verified without Track C. It never edits a file and never claims to.
 */
export class FakePrototypeEngine implements PrototypeEngine {
  readonly label = 'FIXTURE' as const;

  private readonly workspaceId: string;
  private readonly previewUrl: string;
  private readonly jobDelayMs: number;

  private revision: Revision = { source: 1, config: 0 };
  private checkpoints: ReadonlyMap<string, Revision> = new Map();
  private patches: readonly PreviewPatch[] = [];
  private nextFailure: string | null = null;
  private running: ReadonlyMap<string, AbortController> = new Map();
  private checkpointCounter = 0;

  constructor(options: FakeEngineOptions = {}) {
    this.workspaceId = options.workspaceId ?? DEMO_WORKSPACE.workspaceId;
    this.previewUrl = options.previewUrl ?? DEMO_WORKSPACE.previewUrl;
    this.jobDelayMs = options.jobDelayMs ?? 10;
  }

  async prepare(_request: PrepareRequest): Promise<PreparedWorkspace> {
    this.revision = { source: 1, config: 0 };
    this.checkpoints = new Map();
    this.patches = [];
    return {
      workspaceId: this.workspaceId,
      revision: this.revision,
      repoMap: { ...DEMO_WORKSPACE.repoMap, workspaceId: this.workspaceId },
      previewUrl: this.previewUrl,
      renderState: 'rendered',
    };
  }

  async applyPatch(request: PatchRequest): Promise<PatchResult> {
    if (!same(request.expectedRevision, this.revision)) {
      return { operationId: request.operationId, applied: false, revision: this.revision, checkpointId: null, diagnostic: 'revision mismatch (FIXTURE)' };
    }
    const checkpointId = this.checkpoint(this.revision);
    this.revision = { ...this.revision, config: this.revision.config + 1 };
    this.patches = [...this.patches, request.patch];
    return { operationId: request.operationId, applied: true, revision: this.revision, checkpointId };
  }

  async undo(request: { operationId: string; workspaceId: string; expectedRevision: Revision; checkpointId: string }): Promise<PatchResult> {
    if (!same(request.expectedRevision, this.revision)) {
      return { operationId: request.operationId, applied: false, revision: this.revision, checkpointId: null, diagnostic: 'revision mismatch (FIXTURE)' };
    }
    if (!this.checkpoints.has(request.checkpointId)) {
      return { operationId: request.operationId, applied: false, revision: this.revision, checkpointId: null, diagnostic: 'unknown checkpoint (FIXTURE)' };
    }
    const checkpointId = this.checkpoint(this.revision);
    this.revision = { ...this.revision, config: this.revision.config + 1 };
    return { operationId: request.operationId, applied: true, revision: this.revision, checkpointId };
  }

  async runJob(job: PrototypeJob, progress: (event: WorkerProgress) => void, signal?: AbortSignal): Promise<PrototypeResult> {
    const controller = new AbortController();
    signal?.addEventListener('abort', () => controller.abort(), { once: true });
    this.running = new Map(this.running).set(job.id, controller);
    try {
      progress({ jobId: job.id, state: 'queued', message: 'FIXTURE: queued' });
      await delay(this.jobDelayMs, controller.signal);
      if (controller.signal.aborted) return this.terminal(job, 'cancelled', { compile: 'not_checked', page: 'not_checked', diagnostics: [] });
      progress({ jobId: job.id, state: 'running', message: 'FIXTURE: generating' });
      await delay(this.jobDelayMs, controller.signal);
      if (controller.signal.aborted) return this.terminal(job, 'cancelled', { compile: 'not_checked', page: 'not_checked', diagnostics: [] });
      progress({ jobId: job.id, state: 'checking', message: 'FIXTURE: checking compile and render' });

      const failure = this.nextFailure;
      if (failure !== null) {
        this.nextFailure = null;
        progress({ jobId: job.id, state: 'failed', message: 'FIXTURE: render check failed' });
        return this.terminal(job, 'failed', { compile: 'failed', page: 'not_checked', diagnostics: [failure] });
      }
      if (!same(job.expectedRevision, this.revision)) {
        progress({ jobId: job.id, state: 'superseded', message: 'FIXTURE: workspace moved on' });
        return this.terminal(job, 'superseded', { compile: 'not_checked', page: 'not_checked', diagnostics: ['workspace revision changed (FIXTURE)'] });
      }
      this.revision = { source: this.revision.source + 1, config: this.revision.config };
      progress({ jobId: job.id, state: 'ready', message: 'FIXTURE: preview renders; data mocked' });
      return {
        ...this.terminal(job, 'ready', { compile: 'passed', page: 'rendered', diagnostics: [] }),
        changedFiles: ['src/pages/Tasks.tsx (FIXTURE)'],
        checkpointId: this.checkpoint({ source: this.revision.source - 1, config: this.revision.config }),
      };
    } finally {
      const next = new Map(this.running);
      next.delete(job.id);
      this.running = next;
    }
  }

  async cancel(jobId: string): Promise<{ accepted: boolean }> {
    const controller = this.running.get(jobId);
    if (!controller) return { accepted: false };
    controller.abort();
    return { accepted: true };
  }

  // ── test hooks (never used by production code) ───────────────────────
  failNextJob(diagnostic: string): void {
    this.nextFailure = diagnostic;
  }

  currentRevision(): Revision {
    return this.revision;
  }

  elementsFor(route: string): PreviewElement[] {
    return DEMO_WORKSPACE.routes[route] ?? [];
  }

  appliedPatches(): readonly PreviewPatch[] {
    return this.patches;
  }

  private checkpoint(revision: Revision): string {
    this.checkpointCounter += 1;
    const id = `chk_${this.checkpointCounter}`;
    this.checkpoints = new Map(this.checkpoints).set(id, revision);
    return id;
  }

  private terminal(job: PrototypeJob, state: PrototypeResult['state'], check: PrototypeResult['check']): PrototypeResult {
    return {
      jobId: job.id,
      workspaceId: this.workspaceId,
      state,
      basedOn: job.expectedRevision,
      resultingRevision: this.revision,
      checkpointId: null,
      previewUrl: this.previewUrl,
      changedFiles: [],
      mockNotes: ['FIXTURE engine: generated work is simulated', ...job.mockedIntegrations],
      check,
    };
  }
}
