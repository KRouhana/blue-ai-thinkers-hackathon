# meet-bot — one Google Meet bot for video out and audio in

Google Meet has no public API for a bot to join as a real media participant. [Recall.ai](https://recall.ai) is a third-party meeting-bot service that handles the join for Zoom/Meet/Teams. This process creates **one** Recall bot per call that does two things at once:

- **Video out**: displays a webpage — `apps/meeting` (headless, no dashboard: just the live prototype) — as the bot's camera feed.
- **Audio in** (optional, needs more credentials): streams the meeting's mixed audio to Track A's real transcription pipeline (`@fork/perception`, Recall → OpenAI `gpt-live-transcribe`), forwarding the resulting Observations straight into Track B's control API.

Both halves use the **same bot join** — Recall's `output_media.camera` and `recording_config` are set in one `POST /api/v1/bot/` request, so only one "Fork" shows up in the call, not two. This is a paid third-party service, not something Google or Slack provide directly, and requires your own Recall.ai account.

## Video-only (unchanged from before)

```sh
npm run meetbot -- --url https://meet.google.com/xxx-yyyy-zzz --presenter-url "https://<tunnel>/?session=<id>"
```

1. Create a [Recall.ai](https://recall.ai) account and get an API key. Set `RECALL_API_KEY` (and `RECALL_REGION` if not `us-east-1`) in the repo root `.env`.
2. Start the meeting workspace: `npm run dev` from the repo root (serves at `http://127.0.0.1:3000`).
3. Expose it publicly with a tunnel (`ngrok http 3000`) — Recall's cloud bot cannot reach `127.0.0.1`.
4. Note the session ID from the workspace's URL bar (`?session=<id>`), or omit it to show whatever session loads by default.

## Video + audio (Track A wired in)

Add these flags/env vars:

```sh
npm run meetbot -- --url https://meet.google.com/xxx-yyyy-zzz \
  --presenter-url "https://<tunnel>/?session=<id>" \
  --audio-callback-base "https://<tunnel-to-this-process>" \
  --session-id <the same B session id>
```

Needs in `.env`: `OPENAI_API_KEY` (access to `gpt-live-transcribe`), `RECALL_WORKSPACE_VERIFICATION_SECRET` (from your Recall workspace — verifies the signed WSS upgrade), `FORK_API_BASE`/`FORK_API_TOKEN` (B's control API — same values D already uses). `--audio-callback-base` needs its own public HTTPS tunnel pointed at this process's local receiver port (`PERCEPTION_PORT`, default `4318`) — a **second** tunnel, separate from the one fronting the meeting workspace, since this is a different local port.

Without all four (`--audio-callback-base`, `--session-id`, `OPENAI_API_KEY`, `RECALL_WORKSPACE_VERIFICATION_SECRET`), it silently falls back to video-only — nothing breaks, audio just isn't requested.

Ctrl+C makes the bot leave the call, stops the audio receiver, and closes the transcription session — that's the kill switch; there's no in-page stop control.

## How the merge works

Track A's own `RecallBotClient` (`packages/perception/src/recall.ts`) creates its own bot with only `recording_config` — using it as-is here would join a **second**, audio-only "Fork" alongside the video one. Instead, this process uses A's lower-level pieces directly: `CaptureController` (without a `meetingBot`, so it doesn't create its own bot), A's `createRecallAudioReceiver` (mounts the signed WSS endpoint), A's `OpenAIRealtimeTranscriber`, and A's `buildRecallBotRequest` (for its exact `recording_config`/`metadata` shape) — then merges that with this process's own `output_media.camera` into one bot-creation call. A's `packages/perception/src/*` files were not modified; everything is composed via its published `@fork/perception` / `@fork/perception/node` exports.

## Known limits

- **Host admission still applies.** Meet requires the host to admit an unrecognized guest; Recall's bot doesn't bypass that.
- **Paid/rate-limited service.** Recall.ai and OpenAI both bill per use; check current pricing before a long-running demo.
- **Two tunnels needed for audio+video.** One public HTTPS URL for the presenter view, a separate one (WSS-capable) for the audio receiver.
- **API shape verified against Recall's docs on 2026-09-12** (`stream-media`, `bot_retrieve`, `bot_leave_call_create`). Recall's reference/dashboard is the source of truth if fields drift.
- **Not end-to-end tested against a live Meet call.** No Recall or OpenAI API key was available in this environment. What *was* verified, for real, without mocks: (1) the merged bot-request JSON shape (`output_media.camera` + `recording_config` in one object, built from A's own `buildRecallBotRequest` plus this process's video config); (2) the audio receiver, built by composing `CaptureController` + A's `createRecallAudioReceiver`, actually rejects a WebSocket upgrade with no Recall signature — real HTTP 401, no live Recall connection needed for that check. The full join → speak → transcribe → observation-in-B loop is unverified; verify with real accounts before a demo.
