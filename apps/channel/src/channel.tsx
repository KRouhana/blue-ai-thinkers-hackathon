import { createChannel, type InteractionContext } from '@copilotkit/channels';
import { errorCard, helpCard, resultCard } from './cards';
import { createService, parseCommand, type Command } from './service';
import type { SessionApi } from './api';
import type { Bindings } from './bindings';

export function createForkChannel(options: { name: string; api: SessionApi; bindings: Bindings; hostIds: ReadonlySet<string>; meetingUrl: string }) {
  const service = createService(options.api, options.bindings, options.hostIds);
  // 0.9.2 explicitly permits handler-only Channels. B owns all inference.
  const channel = createChannel({ name: options.name, identifyUser: 'platform' });
  async function reply(thread: Pick<InteractionContext['thread'], 'post' | 'platform'>, actorId: string | undefined, command: Command) {
    try {
      // conversationKey is the public property on the concrete SDK Thread.
      // The UI interaction interface omits it, so narrow the delivered object.
      if (thread.platform !== 'slack' || !('conversationKey' in thread) || typeof thread.conversationKey !== 'string') throw new Error('This control requires a supported Slack thread.');
      const result = await service.run(thread.conversationKey, actorId, command);
      await thread.post(resultCard(result, options.meetingUrl, click));
    } catch (error) {
      // Only our bounded integration errors are displayed; provider errors may contain credentials.
      const message = error instanceof Error && /^(No session|Only |Session service|Slack session mapping|This control)/.test(error.message)
        ? error.message : 'The action could not be completed. Check the local Slack listener and B’s API configuration.';
      await thread.post(errorCard(message));
    }
  }
  const click = async (command: Command, context: InteractionContext) => {
    await reply(context.thread, context.actor.id, command);
  };
  channel.onMention(async ({ thread, message }) => {
    if (message.operation.kind !== 'created') return;
    await reply(thread, message.actor.id, parseCommand(message.text));
  });
  channel.onWelcome(async ({ thread }) => { await thread.post(helpCard(click)); });
  channel.onThreadStarted(async ({ thread }) => { await thread.post(helpCard(click)); });
  // No subscription to ordinary thread messages and no transcript duplication.
  return channel;
}
