# Fork

Fork is a silent prototyping teammate for a brainstorming session. It listens to a meeting, turns
what's being discussed into a small reversible demo change, and shows it — no wake word, no
dashboard, no manual start/pause/undo buttons to click during the conversation.

It's built from four pieces that talk to each other:

- **Perception** (`packages/perception`) captures meeting audio and on-screen context.
- **Orchestrator** (`apps/api`, `packages/orchestrator`, `packages/state`, `packages/contracts`) is
  the control plane — it decides what should change and is the only thing allowed to schedule it.
- **Prototype engine** (`packages/prototype-engine`) makes the change as a real local code edit and
  serves a verified preview.
- **Meeting UI / Slack** (`apps/meeting`, `apps/channel`, `apps/meet-bot`, `apps/preview`) shows the
  live prototype and posts updates to Slack.

```
meeting audio + on-screen context ──▶ perception ──▶ orchestrator ──▶ prototype engine
                                                            │                  │
                                                            └────── live preview + Undo ──▶ meeting UI / Slack
```

## Run it (no accounts or API keys needed)

Requires Node.js 22.13+ and npm.

```sh
npm install
cp .env.example .env
npm run dev
```

Open **http://127.0.0.1:3000** (use `127.0.0.1`, not `localhost`). This starts the meeting view on
port 3000 and a prepared preview on port 4173. Ctrl+C stops both.

This is **fixture mode**, the default: a scripted, clearly-labeled demo with no microphone, model
calls, or external services involved, so anyone can see the product shape immediately. The page
loads straight into a demo session — open the browser console and call
`forkFixture.advanceScenario()` to step through the scripted moments (small talk, a resized button,
a color correction, a build going running → checking → ready, a clarification question, a
failure). Reload to reset it.

To see the orchestrator run for real against the same kind of scripted input (still no model key
needed), run it separately:

```sh
npm run dev:api    # http://127.0.0.1:8787
npm run replay      # replays scripted scenarios through the real ingest → plan → gate → build pipeline
```

## Verify it works

```sh
npm run verify   # typecheck, then tests, then a production build
```

## Running it for real

Fixture mode never touches a microphone, a model, or the internet. To run the real thing you'd
plug in, per piece: a model API key for the orchestrator's planner, an OpenAI + Recall.ai key pair
for live meeting audio, and a Codex login for the prototype engine.

Joining an actual Google Meet call works like this: you give the bot the real meeting URL on the
command line —

```sh
npm run meetbot -- --url https://meet.google.com/xxx-yyyy-zzz --presenter-url "https://<tunnel>/?session=<id>"
```

— and it joins that specific call as a guest named **Fork**, showing the live prototype as its
camera feed (via [Recall.ai](https://recall.ai)'s meeting-bot API, since Google Meet has no public
API for a bot to join as a real participant). **The host still has to manually admit it**, exactly
like any unrecognized guest — there's no SSO, invite link, or bypass that lets it in
automatically. It also needs a public HTTPS tunnel in front of the local meeting view, since
Recall's cloud bot can't reach `127.0.0.1` directly. Optionally it can also stream the meeting's
audio back into the transcription pipeline, with more credentials.

Each piece's own README covers exactly what to set and how to check it's working:
[`packages/perception`](packages/perception/README.md), [`apps/api`](apps/api/README.md),
[`packages/prototype-engine`](packages/prototype-engine/README.md),
[`apps/channel`](apps/channel/README.md), [`apps/meet-bot`](apps/meet-bot/README.md). None of these
fall back to a fixture silently — a missing credential fails loudly instead of faking success, and
none of this has been run end-to-end against a real Meet call or Slack workspace in this checkout.

## Tech

TypeScript, Node.js, React/Vite, Zod, SQLite, and CopilotKit Channels for the Slack surface.
Transcription uses OpenAI's realtime speech-to-text; the code-editing worker uses the Codex SDK;
joining a Google Meet call as a bot uses Recall.ai.
