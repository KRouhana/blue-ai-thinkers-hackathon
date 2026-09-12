# Fork — Track D integration

Fork is a silent prototyping teammate for a brainstorming session. It listens, builds a live demo of what's being discussed, and shows it — no dashboard, no manual start/pause/undo buttons to click. This checkout implements **D: the browser meeting workspace (now just the live prototype view) and adapters for A/B/C**. Slack cards exist (`apps/channel`) but are optional/off by default; the primary path is Google Meet via `apps/meet-bot`. It does not implement A’s audio capture, B’s orchestration/API, or C’s Codex prototype engine.

The requested product includes Fork participating in a video call and automatically presenting a prototype. CopilotKit Channels supplies the Slack messaging surface only; it does not establish Huddle media access, and that path remains a human screen-share. For **Google Meet**, `apps/meet-bot` joins via the third-party [Recall.ai](https://recall.ai) meeting-bot API and shows the presenter view as the bot's camera — see [apps/meet-bot/README.md](apps/meet-bot/README.md) for setup and limits (paid service, requires a public tunnel, host admission still applies, not end-to-end verified in this checkout without a live Recall account).

## Run the local fixture workspace

Requires Node.js 22.13+ and npm. From this directory:

```sh
npm install
cp .env.example .env
npm run dev
```

Open **http://127.0.0.1:3000** on the local Mac. Keep `127.0.0.1` rather than substituting `localhost`: the fixture bridge uses exact origins. The launcher starts the meeting shell on port 3000 and a separate prepared preview on port 4173. Press Ctrl+C to stop both — that's the only stop control; there is no in-page button.

Fixture mode is the default and is visibly labeled. The page has no buttons: it creates a session and shows the fixture preview on load. To step through fixture events (small talk, a larger button, a color correction, simulated build/check/ready, clarification, failure) during development, open the browser console and call `forkFixture.advanceScenario()`. Reload to reset the in-memory fixture. The task board uses prepared mock data; no microphone, model, Codex worker, Google Meet, database, or deployment is involved.

## Connect the teammates’ work

Set `FORK_MODE=live` in `.env`, configure B’s authenticated loopback API, A’s capture adapter module, and C’s exact preview origin. The launcher can also start existing teammate npm workspaces via `FORK_API_WORKSPACE` and `FORK_PREVIEW_WORKSPACE`. Otherwise start those services separately. The same `npm run dev` command starts D.

For Slack, follow [the channel setup](apps/channel/README.md). Only enable `FORK_SLACK_ENABLED=true` after managed Channels setup and B’s API are available. The default fixture session exists in one browser and is **not** a server-backed Slack session.

See [integration contracts and limits](docs/INTEGRATION.md) for the proposed request bodies, event recovery, capture lifecycle, preview bridge, and unresolved Huddle requirements. A local-host link reaches the machine opening it; it is not a shared remote meeting URL. The Vite servers are local development services, not public deployment endpoints.

## Verify

```sh
npm run typecheck
npm test
npm run build
```

These checks validate D’s code and isolated integration behavior. They do not establish a real Slack reply, microphone capture, Codex run, or Huddle participation. Run the live checks in the integration guide with the teammates’ services and configured accounts before claiming a complete demo.

See [the verification record](docs/VERIFICATION.md) for checks actually executed and remaining limitations.

## Technology and provenance

D uses TypeScript, Node.js, React/Vite, Zod, and native CopilotKit Channels cards. The Channels/runtime dependency pair and `@ag-ui/client` override follow the supplied **Agents, Everywhere starter** baseline; its source notes and license are preserved under [docs/starter](docs/starter/README.md). OpenAI transcription and the local Codex TypeScript SDK remain A/C responsibilities. Fork’s internal persistence belongs to B; generated demonstrations use mock data by default.

The supplied track documents and `contracts.v2.ts` remain the team’s reference; this implementation does not rewrite colleagues’ responsibilities. [SUBMISSION.md](SUBMISSION.md) separates inherited infrastructure, prepared fixtures, new D work, and live capabilities awaiting verification.
