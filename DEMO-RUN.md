# Live Meet demo

Run from the repository root with dependencies installed and an ignored `.env`.

- `MODEL_PROVIDER=openrouter`, `MODEL=openai/gpt-5.6-sol`: B's planner.
- `OPENROUTER_TRANSCRIPTION_MODEL=openai/gpt-transcribe`: speech-to-text via OpenRouter's `/api/v1/audio/transcriptions` endpoint. This model is listed under `models?output_modalities=transcription`.
- C uses the existing Codex CLI account. The worker environment excludes API keys.
- `FORK_MODE=live`, `FORK_ENGINE=live`, `FORK_PLANNER=live`.
- Optional `FORK_RESUME_SESSION_ID` resumes a known session after API restart. Use its `?session=` presenter URL; don't create another session on the fixed preview port.

Start `npm run dev`. `.data/local-session.json` contains the active sessionId and previewUrl. Start `node --env-file=.env scripts/meet-demo.mjs`, then tunnel `http://127.0.0.1:4320` with cloudflared. Join using:

```
node --env-file=.env scripts/meet-demo.mjs join https://YOUR.trycloudflare.com https://meet.google.com/YOUR-CALL
```

Admit “Fork — live prototype.” The bot displays `/presenter`, a sample-only preview refreshed when B reports a changed revision. Its signed mixed-audio WebSocket feeds OpenRouter in short in-memory WAV segments (silence boundary or 12-second maximum). Final transcripts become ordinary B observations using the current capture epoch. Audio is not written to disk. B remains private on 8787. The bridge does not expose B's control routes.

`.data/meet-bot.json` stores the created bot ID. Leave that bot through Recall's `POST /api/v1/bot/{id}/leave_call/` before replacing it or stopping the demo. Stopping the bridge alone does not remove the bot.

Manual fallback: `npm run say -- "A concrete change to the prototype"` sends typed input through the same real planner and worker. It is explicitly manual input, not proof of speech capture.

Limitations: this temporary demo bridge is not a production streaming service. Speech segments can split long utterances, processing has a bounded queue, and a new committed revision resets local interaction state. Keep the presenter open for screen context. Secrets remain in `.env`, never in Git.

Speech planning waits for the current C job to finish, then gathers all pending speech against the updated revision. This prevents ordinary follow-up utterances from repeatedly cancelling and rolling back an almost-complete screen. Explicit host cancellation remains available. B also records C's resulting revision for cancelled/failed jobs because rollback advances the source revision. Whole-screen/dashboard requests must preserve their full visible scope in both planner and worker prompts.

C uses low reasoning effort for interactive UI work and a ten-minute maximum job duration. The former three-minute ceiling could abort whole-screen generation before the first edit. Actual latency remains model-dependent; cancellation and rollback stay enabled.
