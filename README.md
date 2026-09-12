# Fork

Fork is a silent prototyping teammate for a brainstorming session. It listens to a meeting, turns
what's being discussed into a small reversible demo change, and shows it — no wake word, no
dashboard, no manual start/pause/undo buttons to click during the conversation.

This repo integrates all four parts of the build at the root:

| Part | Code | What it does |
|---|---|---|
| **A — Perception** | [`packages/perception`](packages/perception) | Captures meeting audio + on-screen preview context, turns it into observations |
| **B — Orchestrator** | [`apps/api`](apps/api), [`packages/orchestrator`](packages/orchestrator), [`packages/state`](packages/state), [`packages/contracts`](packages/contracts) | The control plane: settles on intent, gates it, schedules the one change that's allowed to happen |
| **C — Prototype engine** | [`packages/prototype-engine`](packages/prototype-engine) | Executes the change as a real local Codex edit and serves a verified preview |
| **D — Meeting UI / Slack** | [`apps/meeting`](apps/meeting), [`apps/channel`](apps/channel), [`apps/meet-bot`](apps/meet-bot), [`apps/preview`](apps/preview) | Renders the live prototype, join-a-meeting bot, and the Slack card surface |

```
meeting audio + preview context ──▶ A ──▶ POST /observations ──▶ B
                                                                  │  settle window (1.2s)
                                                                  ▼
                                                        contextual planner
                                                                  │
                                                         deterministic gate
                                                                  │
                                                    single-writer scheduler ──▶ C (real edit + preview)
                                                                  │
                                                     ordered event stream (SSE) ──▶ D (renders it, shows Undo)
```

## Two ways to run this: fixture vs. live

Every part defaults to an explicitly-labeled **fixture** mode: scripted data, no model calls, no
microphone, no Slack, no Codex worker, nothing leaves your machine. This is the safe path to see
the product shape end-to-end in minutes. **Live** mode swaps in the real model, the real Codex
engine, real audio capture, and real Slack/Meet — each part fails loudly (never silently) if its
credentials or upstream service aren't there. Nothing quietly degrades into a fixture.

## Quick start (fixture mode, no credentials needed)

Requires Node.js 22.13+ and npm.

```sh
npm install
cp .env.example .env
npm run dev
```

Open **http://127.0.0.1:3000** on the local machine (use `127.0.0.1`, not `localhost` — the
fixture bridge checks exact origins). This starts the meeting shell on port 3000 and a prepared
preview on port 4173. Ctrl+C stops both.

The page loads straight into a labeled fixture session — no buttons to press to start it. Open the
browser console and call `forkFixture.advanceScenario()` to step through the scripted moments
(small talk, a resized button, a color correction, a build going running → checking → ready,
a clarification question, a failure). Reload to reset it.

To see B's orchestrator run for real (still no model key needed — it replays `scenarios.json`
through the actual pipeline with a scripted planner), run it separately:

```sh
cp .env.example .env      # from repo root
npm run dev:api           # http://127.0.0.1:8787 — GET /healthz shows {"planner":"fixture","engine":"FIXTURE"}
npm run replay            # replays all scenarios through ingest → settle → planner → gate → scheduler → engine
```

## Verify

```sh
npm run typecheck   # all workspaces
npm test            # all workspaces
npm run build       # the meeting app's production build
```

`npm run verify` runs all three. As of this checkout: typecheck is clean across every workspace,
`npm test` passes (contracts, state, orchestrator, api, channel, and the meeting app's integration
suite), and the meeting app's production build succeeds. See
[docs/VERIFICATION.md](docs/VERIFICATION.md) for the specific commands run and their recorded
output, and each part's own README for its own verification section.

## Running it live

Live mode needs real credentials and real services, part by part:

- **B** (`apps/api`): set `FORK_PLANNER=live` and a `MODEL_PROVIDER`/`OPENAI_API_KEY` (or
  `OPENROUTER_API_KEY`) in `.env`. Set `FORK_ENGINE=live` once C's adapter is wired in
  (`apps/api/src/compose.ts`) — requesting `live` without it throws at boot rather than silently
  using the fake engine.
- **A** (`packages/perception`): needs `OPENAI_API_KEY` (for `gpt-live-transcribe`), a Recall.ai
  account (`RECALL_API_KEY`, `RECALL_WORKSPACE_VERIFICATION_SECRET`, `RECALL_REGION`), and a
  stable public HTTPS tunnel — see [packages/perception/README.md](packages/perception/README.md).
- **C** (`packages/prototype-engine`): needs macOS, Node 22.12+, and an authenticated Codex login;
  no model key of its own. Can be exercised standalone via its local driver — see
  [packages/prototype-engine/README.md](packages/prototype-engine/README.md).
- **D meeting/Slack** (`apps/meeting`, `apps/channel`): set `FORK_MODE=live` plus B's origin
  (`FORK_API_BASE`), C's exact preview origin (`FORK_PREVIEW_ORIGIN`), and A's adapter module path
  (`FORK_PERCEPTION_MODULE`). Slack requires a managed CopilotKit Channels account
  (`CHANNEL_CODE`, `INTELLIGENCE_API_KEY`) — see [apps/channel/README.md](apps/channel/README.md).
- **Google Meet join** (`apps/meet-bot`): joins a real Meet call via the third-party
  [Recall.ai](https://recall.ai) bot API — paid service, needs its own account and a public
  tunnel, host still has to admit the bot — see [apps/meet-bot/README.md](apps/meet-bot/README.md).

Every one of these is implemented and typechecked, but the full live loop (a real meeting →
real transcription → real model decision → real Codex edit → shown on a real Google Meet camera)
has **not** been run end-to-end against live accounts in this checkout — see
[docs/VERIFICATION.md](docs/VERIFICATION.md) and [SUBMISSION.md](SUBMISSION.md) for exactly
what was and wasn't verified, and don't take a green fixture run as evidence of the live path.

## Docs

- [docs/INTEGRATION.md](docs/INTEGRATION.md) — how A/B/C/D's boundaries fit together: request
  shapes, event ordering, the preview bridge, and open contract questions.
- [docs/VERIFICATION.md](docs/VERIFICATION.md) — what was actually run and observed, and what
  wasn't.
- [SUBMISSION.md](SUBMISSION.md) — provenance: inherited starter infra vs. new work vs. what's
  mocked.
- [DEMO.md](DEMO.md) — the demo script.
- Each part also has its own README with its own run instructions, env vars, and scope limits.

## Technology and provenance

TypeScript, Node.js, React/Vite, Zod, SQLite, and native CopilotKit Channels cards. The
Channels/runtime dependency pair and `@ag-ui/client` override follow the supplied **Agents,
Everywhere starter** baseline; its source notes and license are preserved under
[docs/starter](docs/starter/README.md). Transcription is OpenAI `gpt-live-transcribe`; the Codex
worker uses the official Codex TypeScript SDK; Google Meet join uses Recall.ai's meeting-bot API.
