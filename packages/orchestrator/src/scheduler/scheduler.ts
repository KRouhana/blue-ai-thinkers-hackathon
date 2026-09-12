import { runJob } from './run-job';
import { runPatch } from './run-patch';
import { runUndo } from './run-undo';
import { publishStatus, transition } from './shared';
import type { SchedulerDeps, WorkItem } from './types';

interface Active {
  item: WorkItem;
  controller: AbortController;
  done: Promise<void>;
}

function without<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  const next = new Map(map);
  next.delete(key);
  return next;
}

const tick = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve); });

/**
 * One writer per session. Newer requests on the same target supersede older pending ones and
 * cancel a running job; a superseded intent's late result is never published as desired state.
 */
export class Scheduler {
  private queues: ReadonlyMap<string, readonly WorkItem[]> = new Map();
  private active: ReadonlyMap<string, Active> = new Map();
  private supersededIntents: ReadonlySet<string> = new Set();

  constructor(private readonly deps: SchedulerDeps) {}

  enqueue(item: WorkItem): void {
    this.supersedeCompeting(item);
    const queue = this.queues.get(item.sessionId) ?? [];
    const kept = queue.filter((queued) => queued.targetKey !== item.targetKey);
    this.queues = new Map(this.queues).set(item.sessionId, [...kept, item]);
    this.drain(item.sessionId);
  }

  async cancelJob(sessionId: string, jobId: string): Promise<boolean> {
    const active = this.active.get(sessionId);
    if (active?.item.kind === 'job' && active.item.job.id === jobId) {
      active.controller.abort();
      await this.deps.engine.cancel(jobId);
      return true;
    }
    const queue = this.queues.get(sessionId) ?? [];
    const queued = queue.find((item) => item.kind === 'job' && item.job.id === jobId);
    if (!queued) return false;
    this.queues = new Map(this.queues).set(sessionId, queue.filter((item) => item !== queued));
    this.supersedeItem(queued, 'cancelled before it started');
    return true;
  }

  /** Stop: drop everything queued and cancel the active writer. */
  async cancelAll(sessionId: string): Promise<void> {
    for (const item of this.queues.get(sessionId) ?? []) this.supersedeItem(item, 'capture stopped');
    this.queues = new Map(this.queues).set(sessionId, []);
    const active = this.active.get(sessionId);
    if (!active) return;
    active.controller.abort();
    if (active.item.kind === 'job') await this.deps.engine.cancel(active.item.job.id);
    await active.done;
  }

  async idle(sessionId: string): Promise<void> {
    for (;;) {
      const active = this.active.get(sessionId);
      const queued = this.queues.get(sessionId) ?? [];
      if (!active && queued.length === 0) return;
      if (active) await active.done;
      else await tick();
    }
  }

  private supersedeCompeting(item: WorkItem): void {
    for (const queued of this.queues.get(item.sessionId) ?? []) {
      if (queued.targetKey === item.targetKey) this.supersedeItem(queued, 'replaced by a newer request on the same target');
    }
    const active = this.active.get(item.sessionId);
    if (!active || active.item.targetKey !== item.targetKey) return;
    if (active.item.intentId) this.supersededIntents = new Set([...this.supersededIntents, active.item.intentId]);
    active.controller.abort();
    if (active.item.kind === 'job') void this.deps.engine.cancel(active.item.job.id);
  }

  private supersedeItem(item: WorkItem, reason: string): void {
    transition(this.deps, item.sessionId, item.experimentId, { status: 'superseded' });
    if (item.intentId) {
      this.deps.store.updateIntent(item.intentId, { gateStatus: 'superseded', gateReason: reason });
      this.supersededIntents = new Set([...this.supersededIntents, item.intentId]);
    }
  }

  private drain(sessionId: string): void {
    if (this.active.has(sessionId)) return;
    const queue = this.queues.get(sessionId) ?? [];
    const [next, ...rest] = queue;
    if (!next) return;
    this.queues = new Map(this.queues).set(sessionId, rest);

    const controller = new AbortController();
    const done = this.runItem(next, controller)
      .catch((error: unknown) => { this.reportFailure(next, error); })
      .finally(() => {
        this.active = without(this.active, sessionId);
        this.drain(sessionId);
      });
    this.active = new Map(this.active).set(sessionId, { item: next, controller, done });
  }

  private async runItem(item: WorkItem, controller: AbortController): Promise<void> {
    const context = { isSuperseded: (intentId: string | null) => intentId !== null && this.supersededIntents.has(intentId), signal: controller.signal };
    if (item.kind === 'patch') return runPatch(this.deps, item);
    if (item.kind === 'undo') return runUndo(this.deps, item);
    return runJob(this.deps, item, context);
  }

  private reportFailure(item: WorkItem, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.deps.logger.error('scheduler work item failed', { sessionId: item.sessionId, experimentId: item.experimentId, error: message });
    try {
      transition(this.deps, item.sessionId, item.experimentId, { status: 'failed' });
      publishStatus(this.deps, item.sessionId, `Could not apply: ${message}`);
    } catch (publishError) {
      this.deps.logger.error('scheduler could not report a failure', { error: String(publishError) });
    }
  }
}
