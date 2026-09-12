import type { SessionSnapshot } from '../../../contracts.v2';
import type { SessionApi } from './api';
import type { Bindings } from './bindings';

export type Command = 'start' | 'open' | 'status' | 'pause' | 'stop' | 'recap' | 'help';
export type Result = { kind: 'help' } | { kind: 'session'; snapshot: SessionSnapshot; recap: boolean; requested?: 'pause' | 'stop' };

export function parseCommand(text: string): Command {
  const value = text.replace(/<@[^>]+>/g, '').trim().toLowerCase().replace(/^fork\s+/, '');
  return (['start', 'open', 'status', 'pause', 'stop', 'recap'] as const).find(command => command === value) ?? 'help';
}

export function createService(api: SessionApi, bindings: Bindings, hostIds: ReadonlySet<string>) {
  const queues = new Map<string, Promise<unknown>>();
  async function execute(threadId: string, actorId: string | undefined, command: Command): Promise<Result> {
    if (command === 'help') return { kind: 'help' };
    let binding = await bindings.get(threadId);
    if (!binding) {
      if (command !== 'start' && command !== 'open') throw new Error('No session is linked to this thread. An allowed host can mention Fork with “start”.');
      if (!actorId || !hostIds.has(actorId)) throw new Error('Only a configured Slack host can create a session.');
      const snapshot = await api.create();
      binding = { sessionId: snapshot.id, hostId: actorId };
      await bindings.set(threadId, binding);
      return { kind: 'session', snapshot, recap: false };
    }
    if (command === 'pause' || command === 'stop') {
      if (!actorId || !hostIds.has(actorId) || actorId !== binding.hostId) throw new Error('Only this session’s configured host can control it.');
      await api.control(binding.sessionId, { kind: command });
    }
    const snapshot = await api.snapshot(binding.sessionId);
    return { kind: 'session', snapshot, recap: command === 'recap' || command === 'stop',
      ...((command === 'pause' || command === 'stop') ? { requested: command } : {}),
    };
  }
  return {
    run(threadId: string, actorId: string | undefined, command: Command): Promise<Result> {
      const previous = queues.get(threadId) ?? Promise.resolve();
      const result = previous.catch(() => undefined).then(() => execute(threadId, actorId, command));
      queues.set(threadId, result);
      void result.finally(() => { if (queues.get(threadId) === result) queues.delete(threadId); }).catch(() => undefined);
      return result;
    },
  };
}
