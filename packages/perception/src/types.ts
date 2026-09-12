import type { ObservationSink, Revision } from './contracts.js';

export type CaptureState = 'stopped' | 'starting' | 'listening' | 'paused' | 'stopping' | 'error';

export interface CaptureStatus {
  state: CaptureState;
  source: 'recall_google_meet' | 'browser_microphone' | 'fixture';
  captureEpoch: string | null;
  botId: string | null;
  message: string | null;
}

export interface Caption {
  itemId: string;
  text: string;
  final: boolean;
  updatedAt: string;
}

export interface TranscriptionEvent {
  type: 'delta' | 'completed' | 'error';
  itemId: string;
  text: string;
  /** The sequence emitted by OpenAI when its input buffer was committed. */
  audioTurnSequence: number | null;
  orderReliable: boolean;
}

export interface TranscriptionSession {
  connect(): Promise<void>;
  appendPcm24(audio: Int16Array): void;
  subscribe(listener: (event: TranscriptionEvent) => void): () => void;
  close(): Promise<void>;
}

export interface MeetingBotSession {
  id: string;
  leave(): Promise<void>;
}

export interface MeetingBotStarter {
  start(input: { meetingUrl: string; callbackUrl: string; captureEpoch: string }): Promise<MeetingBotSession>;
}

export interface CaptureControllerOptions {
  sessionId: string;
  streamId: string;
  sink: ObservationSink;
  source?: CaptureStatus['source'];
  createTranscriptionSession: () => TranscriptionSession;
  meetingBot?: MeetingBotStarter;
  callbackUrl?: string;
  now?: () => Date;
  createId?: () => string;
}

export interface CaptureStartOptions {
  meetingUrl?: string;
}

export interface PreviewCollectorOptions {
  sessionId: string;
  workspaceId: string;
  revision: () => Revision;
  captureEpoch: () => string;
  root?: HTMLElement;
  maxElements?: number;
  now?: () => Date;
  createId?: () => string;
}
