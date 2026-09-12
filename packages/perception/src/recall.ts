import type { MeetingBotSession, MeetingBotStarter } from './types.js';

export type RecallRegion = 'us-west-2' | 'us-east-1' | 'eu-central-1' | 'ap-northeast-1';

export interface RecallBotClientOptions {
  apiKey: string;
  region?: RecallRegion;
  botName?: string;
  fetch?: typeof globalThis.fetch;
}

interface RecallBotResponse {
  id?: unknown;
  detail?: unknown;
}

/**
 * Returns the privacy-preserving bot request, as a separately testable value.
 * `retention: null` prevents Recall from retaining the generated media; raw
 * mixed PCM is only delivered over the live WSS endpoint.
 */
export function buildRecallBotRequest(input: {
  meetingUrl: string;
  callbackUrl: string;
  botName: string;
  captureEpoch: string;
}): Record<string, unknown> {
  validateGoogleMeetUrl(input.meetingUrl);
  validateWssUrl(input.callbackUrl);
  return {
    meeting_url: input.meetingUrl,
    bot_name: input.botName,
    metadata: { capture_epoch: input.captureEpoch, source: 'fork_perception' },
    recording_config: {
      // no retained recording, transcript, video, or raw media artifact
      retention: null,
      video_mixed_mp4: null,
      audio_mixed_raw: {},
      realtime_endpoints: [{
        type: 'websocket',
        url: input.callbackUrl,
        events: ['audio_mixed_raw.data'],
      }],
    },
  };
}

export class RecallBotClient implements MeetingBotStarter {
  private readonly region: RecallRegion;
  private readonly botName: string;
  private readonly request: typeof globalThis.fetch;

  constructor(private readonly options: RecallBotClientOptions) {
    this.region = options.region ?? 'us-east-1';
    this.botName = options.botName ?? 'Fork';
    this.request = options.fetch ?? globalThis.fetch;
    if (!this.request) throw new Error('A fetch implementation is required for RecallBotClient.');
    if (!options.apiKey) throw new Error('RECALL_API_KEY is required.');
  }

  async start(input: { meetingUrl: string; callbackUrl: string; captureEpoch: string }): Promise<MeetingBotSession> {
    const response = await this.request(`${recallApiBase(this.region)}/api/v1/bot/`, {
      method: 'POST',
      headers: {
        authorization: this.options.apiKey,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildRecallBotRequest({ ...input, botName: this.botName })),
    });
    const result = await parseResponse(response);
    if (!response.ok || typeof result.id !== 'string') {
      throw new Error(`Recall bot creation failed (${response.status}): ${detailFrom(result)}`);
    }
    return { id: result.id, leave: () => this.leave(result.id as string) };
  }

  async leave(botId: string): Promise<void> {
    const response = await this.request(`${recallApiBase(this.region)}/api/v1/bot/${encodeURIComponent(botId)}/leave_call/`, {
      method: 'POST',
      headers: { authorization: this.options.apiKey, accept: 'application/json' },
    });
    if (!response.ok && response.status !== 404) {
      const result = await parseResponse(response);
      throw new Error(`Recall bot removal failed (${response.status}): ${detailFrom(result)}`);
    }
  }
}

export function recallApiBase(region: RecallRegion): string {
  return `https://${region}.recall.ai`;
}

function validateGoogleMeetUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The meeting URL must be a valid Google Meet URL.');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'meet.google.com') {
    throw new Error('Only an HTTPS meet.google.com link may be used for this source.');
  }
}

function validateWssUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The Recall callback must be a valid public WSS URL.');
  }
  if (url.protocol !== 'wss:' || url.hostname === 'localhost') {
    throw new Error('The Recall callback must be a public WSS URL, not localhost.');
  }
}

async function parseResponse(response: Response): Promise<RecallBotResponse> {
  try {
    return await response.json() as RecallBotResponse;
  } catch {
    return {};
  }
}

function detailFrom(result: RecallBotResponse): string {
  return typeof result.detail === 'string' ? result.detail : 'unexpected response';
}
