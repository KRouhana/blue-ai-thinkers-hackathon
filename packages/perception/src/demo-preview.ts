import { PreviewContextCollector, postPreviewContext } from './preview-context.js';
import type { Revision } from './contracts.js';

interface PreviewConfig {
  version: 1;
  type: 'fork.preview.config';
  sessionId: string;
  workspaceId: string;
  captureEpoch: string;
  revision: Revision;
}

let collector: PreviewContextCollector | null = null;
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.origin !== window.location.origin || event.source !== window.parent || !isConfig(event.data)) return;
  collector?.stop();
  const config = event.data;
  collector = new PreviewContextCollector({
    sessionId: config.sessionId,
    workspaceId: config.workspaceId,
    captureEpoch: () => config.captureEpoch,
    revision: () => config.revision,
  });
  collector.start((snapshot) => postPreviewContext(window.parent, window.location.origin, snapshot));
});

function isConfig(value: unknown): value is PreviewConfig {
  return typeof value === 'object' && value !== null
    && (value as { version?: unknown }).version === 1
    && (value as { type?: unknown }).type === 'fork.preview.config'
    && typeof (value as { sessionId?: unknown }).sessionId === 'string'
    && typeof (value as { workspaceId?: unknown }).workspaceId === 'string'
    && typeof (value as { captureEpoch?: unknown }).captureEpoch === 'string';
}
