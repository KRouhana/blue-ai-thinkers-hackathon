import { z } from 'zod';
import { idSchema } from './primitives';
import { observationSchema } from './observations';
// sessionControlSchema lives in ./session (not re-exported here: two `export *` of one name is a TS2308 ambiguity).

export const createSessionRequestSchema = z.strictObject({ projectConfigId: idSchema });

export const captureRequestSchema = z.strictObject({
  action: z.enum(['start', 'pause', 'stop']),
  prototypeAutonomyEnabled: z.boolean().optional(),
});

export const observationsBatchSchema = z.strictObject({ observations: z.array(observationSchema).min(1).max(100) });

export const transcriptionConnectionRequestSchema = z.strictObject({ sdp: z.string().max(20000).optional() });

export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
export type CaptureRequest = z.infer<typeof captureRequestSchema>;
export type ObservationsBatch = z.infer<typeof observationsBatchSchema>;
export type TranscriptionConnectionRequest = z.infer<typeof transcriptionConnectionRequestSchema>;

export interface ApiIssue {
  path: string;
  message: string;
}

export type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; issues?: ApiIssue[] } };

export interface IngestReport {
  accepted: number;
  duplicates: string[];
  staleEpoch: string[];
  ignoredPartials: number;
}
