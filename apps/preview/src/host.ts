export interface PreviewEnvelope {
  type: 'fork.preview.context' | 'fork.preview.rendered' | 'fork.preview.error';
  version: 1;
  workspaceId: string;
  revision: { source: number; config: number };
  operationId: string;
  instanceId: string;
  payload: Record<string, unknown>;
}
/** D subscribes once per iframe; A converts context payloads into its observation envelope. */
export function connectPreview(options: {
  iframe: HTMLIFrameElement;
  previewUrl: string;
  workspaceId: string;
  onMessage: (message: PreviewEnvelope) => void;
}): () => void {
  const origin = new URL(options.previewUrl).origin;
  const listen = (event: MessageEvent) => {
    if (event.origin !== origin || event.source !== options.iframe.contentWindow) return;
    const data = event.data;
    if (!data || !['fork.preview.context', 'fork.preview.rendered', 'fork.preview.error'].includes(data.type) || data.version !== 1 || data.workspaceId !== options.workspaceId) return;
    if (typeof data.operationId !== 'string' || data.operationId.length > 128 || typeof data.instanceId !== 'string' || data.instanceId.length > 128 || !data.payload || typeof data.payload !== 'object') return;
    if (!Number.isSafeInteger(data.revision?.source) || data.revision.source < 0 || !Number.isSafeInteger(data.revision?.config) || data.revision.config < 0) return;
    try { if (JSON.stringify(data).length > 64_000) return; } catch { return; }
    options.onMessage(data as PreviewEnvelope);
  };
  window.addEventListener('message', listen);
  return () => window.removeEventListener('message', listen);
}
