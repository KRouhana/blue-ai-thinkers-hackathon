import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

const bindingSchema = z.object({ sessionId: z.string(), hostId: z.string() });
export type Binding = z.infer<typeof bindingSchema>;
export interface Bindings {
  get(threadId: string): Promise<Binding | undefined>;
  set(threadId: string, value: Binding): Promise<void>;
}

/** Only supported SDK thread IDs and application session/host IDs are retained. */
export class FileBindings implements Bindings {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string) {}
  private async read() {
    try { return z.record(z.string(), bindingSchema).parse(JSON.parse(await readFile(this.path, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new Error('Slack session mapping cannot be read. Repair the local binding file before starting a session.');
    }
  }
  async get(threadId: string) {
    await this.queue;
    const values = await this.read();
    return Object.hasOwn(values, threadId) ? values[threadId] : undefined;
  }
  async set(threadId: string, value: Binding) {
    const update = this.queue.then(async () => {
      const values = await this.read();
      Object.defineProperty(values, threadId, { value: bindingSchema.parse(value), enumerable: true, configurable: true });
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, JSON.stringify(values), { mode: 0o600 });
      await rename(temporary, this.path);
    });
    this.queue = update.catch(() => undefined);
    await update;
  }
}
