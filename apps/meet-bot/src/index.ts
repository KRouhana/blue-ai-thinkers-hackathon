// Joins a Google Meet call with ONE Recall.ai bot that does two things at once:
// shows the Fork meeting workspace (apps/meeting, headless, no dashboard) as its
// camera output (video out), and — when audio/session flags are supplied — streams
// the meeting's mixed audio to Track A's real transcription pipeline
// (@fork/perception/node), forwarding the resulting Observations straight to
// Track B's control API (video in). Without those flags it's video-only, same as
// before. Recall's cloud infrastructure renders the given webpage and runs the
// call; no local browser automation needed. All public URLs must be reachable by
// Recall's cloud (no localhost/127.0.0.1) — put a tunnel in front of local servers.
//
// Bot-request shape verified against https://docs.recall.ai (stream-media,
// bot_retrieve, bot_leave_call_create) on 2026-09-12. The audio half reuses
// Track A's own request builder (buildRecallBotRequest) so its recording_config
// exactly matches what A's receiver expects, merged with our output_media.camera.
import { createServer } from 'node:http';
import { CaptureController, buildRecallBotRequest, type Observation } from '@fork/perception';
import { createRecallAudioReceiver, recallCallbackUrl, OpenAIRealtimeTranscriber } from '@fork/perception/node';

interface Options {
  url: string; presenterUrl: string; name: string; region: string;
  audioCallbackBase?: string; sessionId?: string; openAiApiKey?: string; recallVerificationSecret?: string;
  apiBase: string; apiToken?: string; receiverPort: number;
}

function parseArgs(argv: string[]): Options {
  const get = (flag: string) => { const i = argv.indexOf(flag); return i === -1 ? undefined : argv[i + 1]; };
  const url = get('--url');
  const presenterUrl = get('--presenter-url');
  if (!url || !presenterUrl) {
    throw new Error('Usage: npm run meetbot -- --url https://meet.google.com/xxx-yyyy-zzz --presenter-url https://<public-tunnel>/[?session=<id>] [--name "Fork"] [--region us-east-1] [--audio-callback-base https://<public-tunnel-to-this-process>] [--session-id <B session id>]');
  }
  const rejectLocal = (label: string, value: string) => { if (!/^https:\/\//.test(value) || value.includes('127.0.0.1') || value.includes('localhost')) throw new Error(`${label} must be a public HTTPS URL. Recall's cloud bot cannot reach 127.0.0.1/localhost on this Mac; put a tunnel (ngrok, cloudflared) in front of it.`); };
  rejectLocal('--presenter-url', presenterUrl);
  const audioCallbackBase = get('--audio-callback-base');
  if (audioCallbackBase) rejectLocal('--audio-callback-base', audioCallbackBase);
  return {
    url, presenterUrl, name: get('--name') || 'Fork', region: get('--region') || process.env.RECALL_REGION || 'us-east-1',
    audioCallbackBase, sessionId: get('--session-id'),
    openAiApiKey: process.env.OPENAI_API_KEY, recallVerificationSecret: process.env.RECALL_WORKSPACE_VERIFICATION_SECRET,
    apiBase: process.env.FORK_API_BASE || 'http://127.0.0.1:8787', apiToken: process.env.FORK_API_TOKEN,
    receiverPort: Number(process.env.PERCEPTION_PORT ?? 4318),
  };
}

function recallClient(region: string, apiKey: string) {
  const base = `https://${region}.recall.ai/api/v1`;
  const headers = { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' };
  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
    if (!response.ok) throw new Error(`Recall API ${init?.method || 'GET'} ${path} -> HTTP ${response.status}: ${await response.text()}`);
    return response.status === 204 ? null : response.json();
  }
  return {
    createBot: (body: Record<string, unknown>) => request('/bot/', { method: 'POST', body: JSON.stringify(body) }) as Promise<{ id: string; status_changes: { code: string; created_at: string }[] }>,
    getBot: (id: string) => request(`/bot/${id}/`) as Promise<{ id: string; status_changes: { code: string; created_at: string }[] }>,
    leaveCall: (id: string) => request(`/bot/${id}/leave_call/`, { method: 'POST' }),
  };
}

/** Forwards A's real Observations straight into B's control API (POST .../observations). */
function forwardToB(apiBase: string, apiToken: string | undefined, sessionId: string) {
  return async (observations: Observation[]) => {
    const response = await fetch(`${apiBase}/api/sessions/${encodeURIComponent(sessionId)}/observations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}) },
      body: JSON.stringify({ observations }),
    });
    if (!response.ok) console.error(`[meet-bot] B rejected ${observations.length} observation(s): HTTP ${response.status}`);
  };
}

async function main() {
  const apiKey = process.env.RECALL_API_KEY;
  if (!apiKey) throw new Error('Set RECALL_API_KEY in .env (from the Recall.ai dashboard) before running the meet bot.');
  const options = parseArgs(process.argv.slice(2));
  const recall = recallClient(options.region, apiKey);
  const audioEnabled = !!(options.audioCallbackBase && options.sessionId && options.openAiApiKey && options.recallVerificationSecret);

  console.log(`Joining ${options.url} as "${options.name}" (region ${options.region})...`);
  console.log(`Camera output: ${options.presenterUrl}`);
  console.log(audioEnabled ? 'Audio capture: ENABLED (Track A transcription -> Track B observations)' : 'Audio capture: disabled (video-only; supply --audio-callback-base, --session-id, OPENAI_API_KEY, RECALL_WORKSPACE_VERIFICATION_SECRET to enable)');

  let controller: CaptureController | undefined;
  let receiver: { close(): void } | undefined;
  let httpServer: ReturnType<typeof createServer> | undefined;
  let callbackUrl: string | undefined;

  if (audioEnabled) {
    callbackUrl = recallCallbackUrl(options.audioCallbackBase!);
    httpServer = createServer((_request, response) => response.end('fork meet-bot receiver'));
    controller = new CaptureController({
      sessionId: options.sessionId!,
      streamId: 'google-meet',
      sink: forwardToB(options.apiBase, options.apiToken, options.sessionId!),
      source: 'recall_google_meet',
      // No meetingBot here: we create the ONE merged bot ourselves below, not via
      // A's RecallBotClient (which would create an audio-only second bot).
      createTranscriptionSession: () => new OpenAIRealtimeTranscriber({ apiKey: options.openAiApiKey! }),
    });
    receiver = createRecallAudioReceiver({ server: httpServer, controller, verificationSecret: options.recallVerificationSecret! });
    await new Promise<void>(resolve => httpServer!.listen(options.receiverPort, resolve));
    console.log(`Audio receiver listening locally on :${options.receiverPort} (expects Recall at ${callbackUrl})`);
    await controller.start({}); // no meetingUrl: just connects the transcription session
  }

  const captureEpoch = crypto.randomUUID();
  const audioRequest = audioEnabled ? buildRecallBotRequest({ meetingUrl: options.url, callbackUrl: callbackUrl!, botName: options.name, captureEpoch }) : {};
  const bot = await recall.createBot({
    meeting_url: options.url,
    bot_name: options.name,
    output_media: { camera: { kind: 'webpage', config: { url: options.presenterUrl } } },
    ...(audioEnabled ? { metadata: (audioRequest as { metadata: unknown }).metadata, recording_config: (audioRequest as { recording_config: unknown }).recording_config } : {}),
  });
  console.log(`Bot created: ${bot.id}`);
  console.log('Note: some meetings still require the host to admit an unrecognized guest.');

  let lastStatus = '';
  const poll = setInterval(async () => {
    try {
      const current = await recall.getBot(bot.id);
      const status = current.status_changes.at(-1)?.code || 'unknown';
      if (status !== lastStatus) { console.log(`[${new Date().toLocaleTimeString()}] status: ${status}`); lastStatus = status; }
      if (['call_ended', 'done', 'fatal'].includes(status)) { clearInterval(poll); void leave(status === 'fatal' ? 1 : 0); }
    } catch (error) { console.error('Status check failed:', error); }
  }, 4000);

  const leave = async (code = 0) => {
    clearInterval(poll);
    console.log('\nLeaving the call...');
    try { await recall.leaveCall(bot.id); } catch (error) { console.error('leave_call failed:', error); }
    await Promise.allSettled([controller?.stop(), Promise.resolve(receiver?.close()), httpServer ? new Promise(resolve => httpServer!.close(resolve)) : Promise.resolve()]);
    process.exit(code);
  };
  process.on('SIGINT', () => void leave(0));
  process.on('SIGTERM', () => void leave(0));
}

void main().catch(error => { console.error(error); process.exit(1); });
