type Settle = (sessionId: string) => Promise<void>;
type OnError = (error: unknown, sessionId: string) => void;

function without<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  const next = new Map(map);
  next.delete(key);
  return next;
}

/** Per-session debounce: planning runs once the room stops talking, not once per token. */
export class SettleWindow {
  private timers: ReadonlyMap<string, NodeJS.Timeout> = new Map();

  constructor(
    private readonly settleMs: number,
    private readonly settle: Settle,
    private readonly onError: OnError = () => {},
  ) {}

  touch(sessionId: string): void {
    this.cancel(sessionId);
    const timer = setTimeout(() => {
      this.timers = without(this.timers, sessionId);
      void this.run(sessionId);
    }, this.settleMs);
    // A pending settle must never hold the process open.
    timer.unref();
    this.timers = new Map(this.timers).set(sessionId, timer);
  }

  async flush(sessionId: string): Promise<void> {
    this.cancel(sessionId);
    await this.run(sessionId);
  }

  cancel(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    this.timers = without(this.timers, sessionId);
  }

  dispose(): void {
    for (const sessionId of [...this.timers.keys()]) this.cancel(sessionId);
  }

  private async run(sessionId: string): Promise<void> {
    try {
      await this.settle(sessionId);
    } catch (error) {
      this.onError(error, sessionId);
    }
  }
}
