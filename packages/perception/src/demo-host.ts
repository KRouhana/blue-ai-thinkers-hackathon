import { createPreviewContextBridge } from './preview-context.js';
import type { Caption, CaptureStatus } from './types.js';

const statusElement = required<HTMLElement>('#status');
const captionsElement = required<HTMLElement>('#captions');
const meetingInput = required<HTMLInputElement>('#meeting-url');
const preview = required<HTMLIFrameElement>('#preview');

const bridge = createPreviewContextBridge({
  origin: window.location.origin,
  source: preview.contentWindow,
  sink: async (observations) => {
    await fetch('/api/observations', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ observations }),
    });
  },
});
window.addEventListener('beforeunload', () => bridge.dispose());

let latestStatus: (CaptureStatus & { sessionId: string; workspaceId: string }) | null = null;
const events = new EventSource('/events');
events.addEventListener('status', (event) => renderStatus(JSON.parse((event as MessageEvent<string>).data)));
events.addEventListener('captions', (event) => renderCaptions(JSON.parse((event as MessageEvent<string>).data)));

for (const action of ['start', 'pause', 'resume', 'stop'] as const) {
  required<HTMLButtonElement>(`[data-action="${action}"]`).addEventListener('click', () => void control(action));
}
preview.addEventListener('load', () => configurePreview());
void refreshStatus();

async function control(action: 'start' | 'pause' | 'resume' | 'stop'): Promise<void> {
  const body = action === 'start' ? { meetingUrl: meetingInput.value.trim() } : undefined;
  const response = await fetch(`/api/capture/${action}`, {
    method: 'POST',
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const status = await response.json() as CaptureStatus & { error?: string };
  if ('error' in status) statusElement.textContent = `Error: ${status.error}`;
  else renderStatus(status);
}

async function refreshStatus(): Promise<void> {
  const response = await fetch('/api/status');
  renderStatus(await response.json() as CaptureStatus & { sessionId: string; workspaceId: string });
}

function renderStatus(status: CaptureStatus & Partial<{ sessionId: string; workspaceId: string }>): void {
  latestStatus = status.sessionId && status.workspaceId ? status as typeof latestStatus : latestStatus;
  statusElement.textContent = `Source: ${status.source} · Status: ${status.state}${status.message ? ` — ${status.message}` : ''}`;
  required<HTMLButtonElement>('[data-action="start"]').disabled = status.state !== 'stopped' && status.state !== 'error';
  required<HTMLButtonElement>('[data-action="pause"]').disabled = status.state !== 'listening';
  required<HTMLButtonElement>('[data-action="resume"]').disabled = status.state !== 'paused';
  required<HTMLButtonElement>('[data-action="stop"]').disabled = status.state === 'stopped' || status.state === 'stopping';
  meetingInput.disabled = status.state !== 'stopped' && status.state !== 'error';
  configurePreview();
}

function renderCaptions(captions: Caption[]): void {
  captionsElement.textContent = captions.length ? captions.map((caption) => caption.text + (caption.final ? '' : ' …')).join('\n') : 'No speech captured yet.';
}

function configurePreview(): void {
  if (!latestStatus?.captureEpoch || !preview.contentWindow) return;
  preview.contentWindow.postMessage({
    version: 1,
    type: 'fork.preview.config',
    sessionId: latestStatus.sessionId,
    workspaceId: latestStatus.workspaceId,
    captureEpoch: latestStatus.captureEpoch,
    revision: { source: 0, config: 0 },
  }, window.location.origin);
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}
