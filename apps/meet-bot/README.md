# meet-bot — Google Meet join via Recall.ai

Google Meet has no public API for a bot to join as a real media participant. [Recall.ai](https://recall.ai) is a third-party meeting-bot service that handles the join for Zoom/Meet/Teams and can display a webpage — here, `apps/meeting`'s presenter view — as the bot's camera feed. This is a paid third-party service, not something Google or Slack provide directly, and requires your own Recall.ai account.

## What it does

1. You give it a Meet link and a **public** URL for the Fork meeting workspace's presenter view (`/?presenter=1`, full-bleed live prototype, no sidebar/chrome).
2. It calls Recall's API to create a bot that joins the call and renders that webpage as its camera output.
3. It polls bot status and prints it; Ctrl+C makes the bot leave the call.

## Setup

1. Create a [Recall.ai](https://recall.ai) account and get an API key. Set `RECALL_API_KEY` (and `RECALL_REGION` if not `us-east-1`) in the repo root `.env`.
2. Start the meeting workspace: `npm run dev` from the repo root (serves at `http://127.0.0.1:3000`).
3. Expose the presenter route publicly with a tunnel, since Recall's cloud bot cannot reach `127.0.0.1` on your Mac:
   ```sh
   ngrok http 3000
   ```
   Take the printed `https://<random>.ngrok-free.app` URL.
4. Start (or note) a session in the meeting workspace so you have a `?session=<id>`, or omit it to let the bot show whatever session loads by default.
5. Run the bot:
   ```sh
   npm run meetbot -- --url https://meet.google.com/xxx-yyyy-zzz --presenter-url "https://<random>.ngrok-free.app/?presenter=1&session=<id>"
   ```

## Known limits

- **Host admission still applies.** Meet requires the host to admit an unrecognized guest; Recall's bot doesn't bypass that.
- **Paid/rate-limited service.** Recall.ai bills per bot-minute; check current pricing before a long-running demo.
- **Tunnel required.** The presenter URL must be public HTTPS; `--presenter-url` refuses `localhost`/`127.0.0.1`.
- **No audio in.** This wires the camera output only. Fork's own listening/perception (A's capture) still runs locally against the operator's microphone, separately from whatever Recall's bot does or doesn't capture from the call — those are not wired together here.
- **API shape verified against Recall's docs on 2026-09-12** (`stream-media`, `bot_retrieve`, `bot_leave_call_create`). Recall's reference/dashboard is the source of truth if fields drift.
- Not end-to-end tested against a live Meet call in this checkout — no Recall API key was available to verify. Verify with a real account before a demo.
