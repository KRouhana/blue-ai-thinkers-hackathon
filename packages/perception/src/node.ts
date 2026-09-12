import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { CaptureController } from './capture-controller.js';
import { RecallBotClient, type RecallRegion } from './recall.js';
import type { ObservationSink } from './contracts.js';
import type { CaptureControllerOptions, TranscriptionEvent, TranscriptionSession } from './types.js';

export interface OpenAIRealtimeTranscriberOptions {
  apiKey: string;
  /** Override only for a compatible OpenAI gateway/test server. */
  url?: string;
  prompt?: string;
  keywords?: string[];
  languages?: string[];
}

/**
 * A server-owned OpenAI Realtime transcription connection. It never sends a
 * response request, TTS request, or tool call. Audio remains in memory only.
 */
export class OpenAIRealtimeTranscriber implements TranscriptionSession {
  private socket: WebSocket | null = null;
  private closed = false;
  private ready = false;
  private sequence = 0;
  private readonly listeners = new Set<(event: TranscriptionEvent) => void>();
  private readonly itemSequences = new Map<string, number>();
  private readonly deltas = new Map<string, string>();

  constructor(private readonly options: OpenAIRealtimeTranscriberOptions) {
    if (!options.apiKey) throw new Error('OPENAI_API_KEY is required.');
  }

  async connect(): Promise<void> {
    if (this.socket) throw new Error('The OpenAI transcription session is already connected.');
    this.closed = false;
    // Dedicated transcription sessions use the Realtime transcription intent;
    // the model itself is selected in the first session.update payload below.
    const url = this.options.url ?? 'wss://api.openai.com/v1/realtime?intent=transcription';
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url, {
        headers: { authorization: `Bearer ${this.options.apiKey}` },
      });
      this.socket = socket;
      const fail = (error: Error) => {
        this.socket = null;
        reject(error);
      };
      socket.once('error', fail);
      socket.once('open', () => {
        socket.off('error', fail);
        this.ready = true;
        socket.on('message', (data) => this.handleMessage(data.toString()));
        socket.on('error', (error) => this.emitError(error.message));
        socket.on('close', () => {
          const wasClosedByUs = this.closed;
          this.ready = false;
          if (!wasClosedByUs) this.emitError('OpenAI transcription connection closed unexpectedly.');
        });
        this.send({
          type: 'session.update',
          session: {
            type: 'transcription',
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: 24000 },
                transcription: {
                  model: 'gpt-live-transcribe',
                  delay: 'low',
                  ...(this.options.prompt ? { prompt: this.options.prompt } : {}),
                  ...(this.options.keywords?.length ? { keywords: this.options.keywords } : {}),
                  ...(this.options.languages?.length ? { languages: this.options.languages } : {}),
                },
                // Recall sends a continuous meeting stream; server VAD commits turns.
                turn_detection: { type: 'server_vad' },
              },
            },
          },
        });
        resolve();
      });
    });
  }

  appendPcm24(audio: Int16Array): void {
    if (!this.ready || this.closed || audio.byteLength === 0) return;
    const bytes = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
    this.send({ type: 'input_audio_buffer.append', audio: bytes.toString('base64') });
  }

  subscribe(listener: (event: TranscriptionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.ready = false;
    const socket = this.socket;
    this.socket = null;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.close();
      // A broken connection should not keep Stop hanging indefinitely.
      setTimeout(() => {
        if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
        resolve();
      }, 1_000).unref();
    });
  }

  private handleMessage(raw: string): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.emitError('OpenAI returned an invalid transcription event.');
      return;
    }
    const type = typeof event.type === 'string' ? event.type : '';
    const itemId = typeof event.item_id === 'string' ? event.item_id : '';
    if (type === 'input_audio_buffer.committed' && itemId) {
      this.itemSequences.set(itemId, ++this.sequence);
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.delta' && itemId) {
      const appended = typeof event.delta === 'string' ? event.delta : '';
      const text = `${this.deltas.get(itemId) ?? ''}${appended}`;
      this.deltas.set(itemId, text);
      this.emit({ type: 'delta', itemId, text, ...this.orderFor(itemId) });
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.completed' && itemId) {
      const text = typeof event.transcript === 'string' ? event.transcript : this.deltas.get(itemId) ?? '';
      this.deltas.delete(itemId);
      this.emit({ type: 'completed', itemId, text, ...this.orderFor(itemId) });
      return;
    }
    if (type === 'error') {
      const message = nestedErrorMessage(event) ?? 'OpenAI rejected the transcription session.';
      this.emitError(message);
    }
  }

  private orderFor(itemId: string): Pick<TranscriptionEvent, 'audioTurnSequence' | 'orderReliable'> {
    const sequence = this.itemSequences.get(itemId);
    return sequence === undefined
      ? { audioTurnSequence: null, orderReliable: false }
      : { audioTurnSequence: sequence, orderReliable: true };
  }

  private send(event: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  private emit(event: TranscriptionEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private emitError(text: string): void {
    this.emit({ type: 'error', itemId: 'connection', text, audioTurnSequence: null, orderReliable: false });
  }
}

function nestedErrorMessage(event: Record<string, unknown>): string | null {
  const error = event.error;
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return typeof event.message === 'string' ? event.message : null;
}

export interface RecallSignatureInput {
  secret: string;
  headers: Record<string, string | string[] | undefined>;
  /** Use null for Recall's signed WebSocket upgrade, the exact raw body otherwise. */
  payload: string | null;
}

/** Implements Recall's `whsec_` HMAC verification including rotated secrets. */
export function verifyRecallSignature(input: RecallSignatureInput): boolean {
  if (!input.secret.startsWith('whsec_')) return false;
  const id = firstHeader(input.headers, 'webhook-id');
  const timestamp = firstHeader(input.headers, 'webhook-timestamp');
  const signatureHeader = firstHeader(input.headers, 'webhook-signature');
  if (!id || !timestamp || !signatureHeader) return false;
  const key = Buffer.from(input.secret.slice('whsec_'.length), 'base64');
  if (key.length === 0) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${input.payload ?? ''}`).digest('base64');
  return signatureHeader.split(' ').some((part) => {
    const candidate = part.startsWith('v1,') ? part.slice(3) : '';
    if (!candidate) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(candidate);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

function firstHeader(headers: RecallSignatureInput['headers'], name: string): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export interface RecallAudioReceiverOptions {
  server: HttpServer;
  controller: CaptureController;
  verificationSecret: string;
  path?: string;
}

/**
 * Mounts a signed WSS endpoint. The message body is parsed only after its
 * upgrade signature passes; received PCM is resampled and forwarded in memory.
 */
export function createRecallAudioReceiver(options: RecallAudioReceiverOptions): { close(): void } {
  const path = options.path ?? '/recall/audio/';
  const webSockets = new WebSocketServer({ noServer: true });
  const sockets = new Set<WebSocket>();
  const onUpgrade = (request: IncomingMessage, socket: import('node:net').Socket, head: Buffer) => {
    const requestedPath = new URL(request.url ?? '/', 'http://receiver.local').pathname;
    if (requestedPath !== path) return;
    const verified = verifyRecallSignature({
      secret: options.verificationSecret,
      headers: request.headers,
      payload: null,
    });
    if (!verified) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSockets.emit('connection', webSocket, request);
    });
  };
  options.server.on('upgrade', onUpgrade);
  webSockets.on('connection', (webSocket: WebSocket) => {
    sockets.add(webSocket);
    webSocket.on('message', (raw, isBinary) => {
      if (isBinary) return;
      const audioEvent = parseRecallAudioEvent(raw.toString());
      if (audioEvent) options.controller.ingestRecallPcm16(audioEvent.audio, audioEvent.capturedAt);
    });
    webSocket.on('close', () => sockets.delete(webSocket));
  });
  return {
    close(): void {
      options.server.off('upgrade', onUpgrade);
      for (const socket of sockets) socket.close();
      webSockets.close();
    },
  };
}

/** Parses only the declared mixed-audio envelope; no packet is retained. */
export function extractRecallPcm16(raw: string): Int16Array | null {
  return parseRecallAudioEvent(raw)?.audio ?? null;
}

function parseRecallAudioEvent(raw: string): { audio: Int16Array; capturedAt: Date } | null {
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(event) || event.event !== 'audio_mixed_raw.data' || !isRecord(event.data) || !isRecord(event.data.data)) {
    return null;
  }
  const encoded = event.data.data.buffer;
  const absoluteTimestamp = isRecord(event.data.data.timestamp) ? event.data.data.timestamp.absolute : null;
  if (typeof encoded !== 'string' || encoded.length === 0 || typeof absoluteTimestamp !== 'string') return null;
  const capturedAt = new Date(absoluteTimestamp);
  if (Number.isNaN(capturedAt.getTime())) return null;
  let pcm: Buffer;
  try {
    pcm = Buffer.from(encoded, 'base64');
  } catch {
    return null;
  }
  if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0) return null;
  const samples = new Int16Array(pcm.byteLength / 2);
  for (let index = 0; index < samples.length; index += 1) samples[index] = pcm.readInt16LE(index * 2);
  return { audio: samples, capturedAt };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface RecallRuntimeOptions {
  server: HttpServer;
  sink: ObservationSink;
  sessionId: string;
  streamId: string;
  openAiApiKey: string;
  recallApiKey: string;
  recallVerificationSecret: string;
  publicApiBaseUrl: string;
  recallRegion?: RecallRegion;
  controller?: Omit<CaptureControllerOptions, 'sink' | 'meetingBot' | 'callbackUrl' | 'createTranscriptionSession'>;
}

/** Creates the server half that B/D can mount without importing a root app. */
export function createRecallRuntime(options: RecallRuntimeOptions): {
  controller: CaptureController;
  receiver: { close(): void };
  callbackUrl: string;
} {
  const callbackUrl = recallCallbackUrl(options.publicApiBaseUrl);
  const controller = new CaptureController({
    sessionId: options.sessionId,
    streamId: options.streamId,
    sink: options.sink,
    source: 'recall_google_meet',
    meetingBot: new RecallBotClient({
      apiKey: options.recallApiKey,
      ...(options.recallRegion ? { region: options.recallRegion } : {}),
    }),
    callbackUrl,
    createTranscriptionSession: () => new OpenAIRealtimeTranscriber({ apiKey: options.openAiApiKey }),
    ...options.controller,
  });
  const receiver = createRecallAudioReceiver({
    server: options.server,
    controller,
    verificationSecret: options.recallVerificationSecret,
  });
  return { controller, receiver, callbackUrl };
}

export function recallCallbackUrl(publicApiBaseUrl: string): string {
  const base = new URL(publicApiBaseUrl);
  if (base.protocol !== 'https:' || base.hostname === 'localhost') {
    throw new Error('PUBLIC_API_BASE_URL must be a stable public HTTPS URL.');
  }
  base.protocol = 'wss:';
  base.pathname = '/recall/audio/';
  base.search = '';
  base.hash = '';
  return base.toString();
}
