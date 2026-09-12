import { ApiError } from '../errors';

export interface TranscriptionNegotiation {
  kind: 'client_secret' | 'sdp_answer';
  /** A short-lived credential or SDP answer. Long-lived provider keys never leave the server. */
  value: string;
  expiresAt: string | null;
}

export interface TranscriptionConnector {
  readonly label: 'live' | 'unconfigured';
  negotiate(input: { sessionId: string; sdp?: string }): Promise<TranscriptionNegotiation>;
}

/** Track A registers the real helper here. Until then this reports a setup blocker, never fake audio. */
export class UnconfiguredTranscriptionConnector implements TranscriptionConnector {
  readonly label = 'unconfigured' as const;

  async negotiate(): Promise<TranscriptionNegotiation> {
    throw new ApiError(
      503,
      'transcription_unconfigured',
      "Track A's transcription connector is not registered on this server; fixture mode has no live audio",
    );
  }
}
