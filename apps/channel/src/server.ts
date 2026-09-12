import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { CopilotKitIntelligence, CopilotRuntime } from '@copilotkit/runtime/v2';
import { createCopilotNodeListener } from '@copilotkit/runtime/v2/node';
import { createForkChannel } from './channel';
import { createSessionApi } from './api';
import { FileBindings } from './bindings';
import { workspaceLink } from './cards';

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required; configure the root .env file.`);
  return value;
}

async function main() {
  const name = required('CHANNEL_CODE');
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) || name.length < 3 || name.length > 64 || name === 'channels') throw new Error('CHANNEL_CODE is invalid. Use the exact code from Intelligence.');
  const key = required('INTELLIGENCE_API_KEY');
  const hostIds = new Set(required('FORK_SLACK_HOST_IDS').split(',').map(id => id.trim()).filter(Boolean));
  if (!hostIds.size) throw new Error('FORK_SLACK_HOST_IDS requires at least one Slack host ID.');
  const meetingUrl = process.env.FORK_MEETING_URL ?? 'http://127.0.0.1:3000';
  workspaceLink(meetingUrl, 'validate');
  const projectMode = process.env.FORK_PROJECT_MODE ?? 'existing_repo';
  if (projectMode !== 'existing_repo' && projectMode !== 'blank_template') throw new Error('FORK_PROJECT_MODE must be existing_repo or blank_template.');
  const api = createSessionApi(process.env.FORK_API_BASE ?? 'http://127.0.0.1:8787', required('FORK_API_TOKEN'), process.env.FORK_PROJECT_CONFIG_ID ?? 'demo-product', fetch, projectMode);
  const bindings = new FileBindings(process.env.FORK_SLACK_BINDINGS_PATH ?? fileURLToPath(new URL('../../../.fork/slack-bindings.json', import.meta.url)));
  const channel = createForkChannel({ name, api, bindings, hostIds, meetingUrl });
  if (Boolean(process.env.INTELLIGENCE_API_URL) !== Boolean(process.env.INTELLIGENCE_GATEWAY_WS_URL)) throw new Error('Configure both Intelligence URL overrides together or neither.');
  const intelligence = new CopilotKitIntelligence({ apiKey: key, apiUrl: process.env.INTELLIGENCE_API_URL, wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL });
  const runtime = new CopilotRuntime({ agents: {}, intelligence, channels: [channel] });
  let teardown: (() => Promise<void>) | undefined;
  const shutdown = async () => { await teardown?.(); process.exit(0); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  const listener = createCopilotNodeListener({ runtime, basePath: '/api/copilotkit' });
  const channels = listener.channels;
  const server = createServer(listener);
  teardown = async () => { await channels.stop(); if (server.listening) server.close(); };
  try {
    await channels.ready({ timeoutMs: 30_000 });
    if (channels.status().overall !== 'online') throw new Error('Channel is not online. Complete managed setup and run npm run channel:status.');
    const port = Number(process.env.FORK_CHANNEL_PORT ?? 3001);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('FORK_CHANNEL_PORT is invalid.');
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    console.log(`Fork Slack listener online on 127.0.0.1:${port}. Verify delivery with a real Slack mention.`);
  } catch {
    await teardown();
    throw new Error('Slack listener could not start. Check the managed Channel setup, connection, and local port; run npm run channel:status.');
  }
}

main().catch(error => {
  const message = error instanceof Error && /^(CHANNEL_CODE |INTELLIGENCE_API_KEY |FORK_[A-Z_]+ |Invalid FORK_|Configure both Intelligence|Slack listener could not start)/.test(error.message)
    ? error.message : 'Slack listener failed. Check the local configuration and managed Channel setup.';
  console.error(message);
  process.exitCode = 1;
});
