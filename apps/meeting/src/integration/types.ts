// Consume the supplied contract. B retains ownership of its authoritative package.
export type { SessionSnapshot, SessionEvent, SessionControl, Observation, WorkerProgress, Revision, ExperimentRecord } from '../../../../contracts.v2';
import type { SessionSnapshot, SessionEvent, SessionControl, Observation } from '../../../../contracts.v2';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';
export interface SessionClient {
  create(): Promise<SessionSnapshot>;
  snapshot(id: string): Promise<SessionSnapshot>;
  control(id: string, control: SessionControl): Promise<void>;
  capture(id: string, action: 'start' | 'pause' | 'resume' | 'stop'): Promise<void>;
  observe(id: string, observations: Observation[]): Promise<void>;
  subscribe(id: string, after: number, receive: (event: SessionEvent) => void,
    connection: (state: ConnectionState) => void): () => void;
}

// D-facing plug-in boundary, not a replacement for A's implementation.
export interface CaptureAdapter {
  source: string;
  available: boolean;
  start(context: { sessionId: string; captureEpoch: string; sink: (items: Observation[]) => Promise<void> }): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}
