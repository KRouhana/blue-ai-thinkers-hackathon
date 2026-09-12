import { useState, useSyncExternalStore } from 'react';
import type { CaptureController } from './capture-controller.js';
import type { Caption, CaptureStatus } from './types.js';

export interface PerceptionControlsProps {
  controller: CaptureController;
  /** A host may keep this controlled from its own meeting-link field. */
  meetingUrl?: string;
  className?: string;
}

/** Compact, silent controls. This component never enables TTS or actions. */
export function PerceptionControls({ controller, meetingUrl: initialMeetingUrl = '', className }: PerceptionControlsProps) {
  const status = useStatus(controller);
  const captions = useCaptions(controller);
  const [meetingUrl, setMeetingUrl] = useState(initialMeetingUrl);
  const [typedTranscript, setTypedTranscript] = useState('');
  const isStarting = status.state === 'starting' || status.state === 'stopping';

  return (
    <section className={className} aria-label="Meeting perception controls">
      <div aria-live="polite">
        <strong>Source:</strong> {sourceLabel(status.source)} · <strong>Status:</strong> {status.state}
        {status.botId ? ` · Fork bot ${status.botId}` : ''}
        {status.message ? ` — ${status.message}` : ''}
      </div>

      {status.source === 'recall_google_meet' && status.state === 'stopped' ? (
        <label>
          Google Meet link
          <input
            value={meetingUrl}
            onChange={(event) => setMeetingUrl(event.target.value)}
            inputMode="url"
            placeholder="https://meet.google.com/abc-defg-hij"
          />
        </label>
      ) : null}

      <div>
        {status.state === 'stopped' || status.state === 'error' ? (
          <button disabled={isStarting || (status.source === 'recall_google_meet' && !meetingUrl.trim())}
            onClick={() => void controller.start(meetingUrl.trim() ? { meetingUrl: meetingUrl.trim() } : {}).catch(() => undefined)}>
            Start
          </button>
        ) : null}
        {status.state === 'listening' ? <button disabled={isStarting} onClick={() => void controller.pause().catch(() => undefined)}>Pause</button> : null}
        {status.state === 'paused' ? <button disabled={isStarting} onClick={() => void controller.resume().catch(() => undefined)}>Resume</button> : null}
        {status.state !== 'stopped' ? <button disabled={isStarting} onClick={() => void controller.stop().catch(() => undefined)}>Stop</button> : null}
      </div>

      <CaptionPanel captions={captions} />

      <details>
        <summary>Typed transcript debug fallback</summary>
        <p>This is labelled developer input; it is not meeting audio and does not create a spoken reply.</p>
        <textarea value={typedTranscript} onChange={(event) => setTypedTranscript(event.target.value)} rows={3} />
        <button disabled={status.state !== 'listening' || !typedTranscript.trim()} onClick={() => {
          void controller.submitDebugTranscript(typedTranscript).catch(() => undefined);
          setTypedTranscript('');
        }}>
          Emit debug final
        </button>
      </details>
    </section>
  );
}

export function CaptionPanel({ captions }: { captions: readonly Caption[] }) {
  return (
    <section aria-label="Live captions" aria-live="polite">
      <strong>Captions</strong>
      {captions.length === 0 ? <p>No speech captured yet.</p> : (
        <ol>
          {captions.map((caption) => <li key={caption.itemId}>{caption.text}{caption.final ? '' : ' …'}</li>)}
        </ol>
      )}
    </section>
  );
}

function useStatus(controller: CaptureController): CaptureStatus {
  return useSyncExternalStore(
    (notify) => controller.subscribeStatus(notify),
    () => controller.getStatus(),
    () => controller.getStatus(),
  );
}

function useCaptions(controller: CaptureController): readonly Caption[] {
  return useSyncExternalStore(
    (notify) => controller.subscribeCaptions(notify),
    () => controller.getCaptions(),
    () => controller.getCaptions(),
  );
}

function sourceLabel(source: CaptureStatus['source']): string {
  switch (source) {
    case 'recall_google_meet': return 'visible Fork Google Meet bot';
    case 'browser_microphone': return 'browser microphone';
    case 'fixture': return 'fixture / developer input';
  }
}
