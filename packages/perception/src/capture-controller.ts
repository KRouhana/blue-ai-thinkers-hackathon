import type { TranscriptObservation } from './contracts.js';
import { createObservationId, iso } from './ids.js';
import { Pcm16To24kResampler } from './resample.js';
import type {
  Caption,
  CaptureControllerOptions,
  CaptureStartOptions,
  CaptureStatus,
  TranscriptionEvent,
  TranscriptionSession,
} from './types.js';

type StatusListener = (status: CaptureStatus) => void;
type CaptionListener = (captions: readonly Caption[]) => void;

/**
 * The one-way Track A lifecycle. It only accepts audio/context and emits
 * observations to the injected sink; it has no planning or mutation authority.
 */
export class CaptureController {
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly resampler = new Pcm16To24kResampler();
  private readonly statuses = new Set<StatusListener>();
  private readonly captionListeners = new Set<CaptionListener>();
  private readonly captions = new Map<string, Caption>();
  private readonly finalized = new Map<string, { text: string; observationId: string; version: number }>();
  private status: CaptureStatus;
  private transcription: TranscriptionSession | null = null;
  private unsubscribeTranscription: (() => void) | null = null;
  private bot: Awaited<ReturnType<NonNullable<CaptureControllerOptions['meetingBot']>['start']>> | null = null;
  private serial: Promise<void> = Promise.resolve();
  /** Old Recall packets are discarded after a resume even if they arrive late. */
  private acceptAudioAfter: Date | null = null;
  /** Recall sends 200 ms PCM packets. Commit after a natural 800 ms pause. */
  private speechActive = false;
  private silenceMs = 0;

  constructor(private readonly options: CaptureControllerOptions) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => createObservationId('capture'));
    this.status = {
      state: 'stopped',
      source: options.source ?? (options.meetingBot ? 'recall_google_meet' : 'fixture'),
      captureEpoch: null,
      botId: null,
      message: null,
    };
  }

  getStatus(): CaptureStatus {
    return { ...this.status };
  }

  getCaptions(): readonly Caption[] {
    return [...this.captions.values()];
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statuses.add(listener);
    listener(this.getStatus());
    return () => this.statuses.delete(listener);
  }

  subscribeCaptions(listener: CaptionListener): () => void {
    this.captionListeners.add(listener);
    listener(this.getCaptions());
    return () => this.captionListeners.delete(listener);
  }

  async start(startOptions: CaptureStartOptions = {}): Promise<void> {
    return this.enqueue(async () => {
      if (this.status.state !== 'stopped' && this.status.state !== 'error') {
        throw new Error(`Cannot start while capture is ${this.status.state}.`);
      }
      if (this.options.meetingBot && !startOptions.meetingUrl) {
        throw new Error('A Google Meet URL is required to start the Recall source.');
      }
      if (this.options.meetingBot && !this.options.callbackUrl) {
        throw new Error('A public WSS callback URL is required to start the Recall source.');
      }
      // Do not leave a visible bot from a failed run in the meeting when retrying.
      const priorBot = this.bot;
      this.bot = null;
      if (priorBot) await priorBot.leave();

      const captureEpoch = this.createId();
      this.captions.clear();
      this.finalized.clear();
      this.resampler.reset();
      this.resetLocalTurnDetection();
      this.acceptAudioAfter = this.now();
      this.setStatus({ state: 'starting', captureEpoch, message: 'Connecting transcription…' });

      try {
        await this.connectTranscription(captureEpoch);
        if (this.options.meetingBot && startOptions.meetingUrl && this.options.callbackUrl) {
          this.bot = await this.options.meetingBot.start({
            meetingUrl: startOptions.meetingUrl,
            callbackUrl: this.options.callbackUrl,
            captureEpoch,
          });
        }
        this.setStatus({
          state: 'listening',
          captureEpoch,
          botId: this.bot?.id ?? null,
          message: this.bot ? 'Fork is joining Google Meet. Admit it if prompted.' : 'Listening.',
        });
      } catch (error) {
        await this.closeTranscription();
        this.setStatus({ state: 'error', captureEpoch: null, botId: null, message: errorMessage(error) });
        throw error;
      }
    });
  }

  async pause(): Promise<void> {
    return this.enqueue(async () => {
      if (this.status.state !== 'listening') return;
      this.setStatus({ state: 'paused', message: 'Paused. Incoming audio is discarded.' });
      this.acceptAudioAfter = null;
      await this.closeTranscription();
      this.resampler.reset();
      this.resetLocalTurnDetection();
    });
  }

  async resume(): Promise<void> {
    return this.enqueue(async () => {
      if (this.status.state !== 'paused') {
        throw new Error(`Cannot resume while capture is ${this.status.state}.`);
      }
      const captureEpoch = this.createId();
      this.captions.clear();
      this.finalized.clear();
      this.resampler.reset();
      this.resetLocalTurnDetection();
      this.acceptAudioAfter = this.now();
      this.setStatus({ state: 'starting', captureEpoch, botId: this.bot?.id ?? null, message: 'Resuming a new capture epoch…' });
      try {
        await this.connectTranscription(captureEpoch);
        this.setStatus({ state: 'listening', captureEpoch, botId: this.bot?.id ?? null, message: 'Listening.' });
      } catch (error) {
        await this.closeTranscription();
        this.setStatus({ state: 'error', captureEpoch: null, botId: this.bot?.id ?? null, message: errorMessage(error) });
        throw error;
      }
    });
  }

  async stop(): Promise<void> {
    return this.enqueue(async () => {
      if (this.status.state === 'stopped') return;
      this.setStatus({ state: 'stopping', message: 'Closing capture and removing Fork from the meeting…' });
      // State changes before teardown, so no late callback can be accepted.
      await this.closeTranscription();
      this.resampler.reset();
      this.resetLocalTurnDetection();
      this.acceptAudioAfter = null;
      const bot = this.bot;
      this.bot = null;
      try {
        if (bot) await bot.leave();
      } catch (error) {
        this.setStatus({ state: 'error', message: `Fork could not leave the meeting: ${errorMessage(error)}` });
        throw error;
      }
      this.setStatus({ state: 'stopped', captureEpoch: null, botId: null, message: null });
    });
  }

  /** Receivers call this only after Recall's signed WebSocket upgrade passed verification. */
  ingestRecallPcm16(audio: Int16Array, capturedAt?: Date): void {
    if (this.status.state !== 'listening' || !this.transcription) return;
    if (capturedAt && this.acceptAudioAfter && capturedAt < this.acceptAudioAfter) return;
    if (this.bot && this.status.message !== 'Listening to Google Meet audio.') {
      this.setStatus({ state: 'listening', message: 'Listening to Google Meet audio.' });
    }
    const resampled = this.resampler.convert(audio);
    if (resampled.length > 0) this.transcription.appendPcm24(resampled);
    this.updateLocalTurnDetection(audio);
  }

  /** Explicit developer-only fallback; it never impersonates or replaces live speech. */
  async submitDebugTranscript(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.status.state !== 'listening' || !this.status.captureEpoch) return;
    await this.handleTranscriptionEvent(this.status.captureEpoch, {
      type: 'completed',
      itemId: `typed-${this.createId()}`,
      text: trimmed,
      audioTurnSequence: null,
      orderReliable: false,
    });
  }

  private async connectTranscription(captureEpoch: string): Promise<void> {
    const transcription = this.options.createTranscriptionSession();
    this.transcription = transcription;
    this.unsubscribeTranscription = transcription.subscribe((event) => {
      void this.handleTranscriptionEvent(captureEpoch, event);
    });
    await transcription.connect();
  }

  private async closeTranscription(): Promise<void> {
    this.unsubscribeTranscription?.();
    this.unsubscribeTranscription = null;
    const transcription = this.transcription;
    this.transcription = null;
    if (transcription) await transcription.close();
  }

  private async handleTranscriptionEvent(captureEpoch: string, event: TranscriptionEvent): Promise<void> {
    // A final from a former connection/epoch is never allowed through.
    if (this.status.state !== 'listening' || this.status.captureEpoch !== captureEpoch) return;
    if (event.type === 'error') {
      this.setStatus({ state: 'error', message: event.text || 'Transcription connection failed.' });
      await this.closeTranscription();
      return;
    }

    this.captions.set(event.itemId, {
      itemId: event.itemId,
      text: event.text,
      final: event.type === 'completed',
      updatedAt: iso(this.now),
    });
    this.publishCaptions();
    if (event.type !== 'completed' || !event.text.trim()) return;

    const previous = this.finalized.get(event.itemId);
    if (previous?.text === event.text) return;
    const version = (previous?.version ?? 0) + 1;
    const observation: TranscriptObservation = {
      id: this.createId(),
      kind: 'transcript',
      sessionId: this.options.sessionId,
      captureEpoch,
      capturedAt: iso(this.now),
      version,
      phase: 'final',
      providerItemId: event.itemId,
      audioTurnSequence: event.audioTurnSequence,
      orderReliable: event.orderReliable,
      streamId: this.options.streamId,
      text: event.text,
      speaker: { label: null, verified: false },
      ...(previous ? { supersedesObservationId: previous.observationId } : {}),
    };
    this.finalized.set(event.itemId, { text: event.text, observationId: observation.id, version });
    await this.options.sink([observation]);
  }

  private setStatus(update: Partial<CaptureStatus> & Pick<CaptureStatus, 'state'>): void {
    this.status = {
      ...this.status,
      ...update,
      captureEpoch: update.captureEpoch === undefined ? this.status.captureEpoch : update.captureEpoch,
      botId: update.botId === undefined ? this.status.botId : update.botId,
      message: update.message === undefined ? this.status.message : update.message,
    };
    for (const listener of this.statuses) listener(this.getStatus());
  }

  private publishCaptions(): void {
    const captions = this.getCaptions();
    for (const listener of this.captionListeners) listener(captions);
  }

  /**
   * gpt-live-transcribe rejects server-side VAD configuration. Recall supplies
   * bounded PCM chunks, so an in-memory energy gate gives it explicit turns
   * without retaining any audio or triggering a response.
   */
  private updateLocalTurnDetection(audio: Int16Array): void {
    if (!this.transcription?.commitAudio) return;
    const durationMs = Math.round((audio.length / 16_000) * 1_000);
    if (hasSpeechEnergy(audio)) {
      this.speechActive = true;
      this.silenceMs = 0;
      return;
    }
    if (!this.speechActive) return;
    this.silenceMs += durationMs;
    if (this.silenceMs >= 800) {
      this.transcription.commitAudio();
      this.resetLocalTurnDetection();
    }
  }

  private resetLocalTurnDetection(): void {
    this.speechActive = false;
    this.silenceMs = 0;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.serial.then(operation, operation);
    this.serial = result.catch(() => undefined);
    return result;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unknown capture error occurred.';
}

function hasSpeechEnergy(audio: Int16Array): boolean {
  if (audio.length === 0) return false;
  let sum = 0;
  for (const sample of audio) sum += Math.abs(sample);
  // Roughly 1% full-scale; deliberately conservative for Meet background noise.
  return sum / audio.length >= 320;
}
