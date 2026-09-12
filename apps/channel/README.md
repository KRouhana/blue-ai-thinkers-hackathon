# Fork Slack integration — Track D

The official Agents, Everywhere managed CopilotKit Channels transport is preserved at Channels **0.9.2**, Runtime **1.70.3**, and the root AG-UI override **0.0.59**. The installed SDK permits handler-only Channels: this app renders native cards and calls B’s services; it does not run another planner or require a separate OpenAI key.

## Run and connect

Use Node.js 22+. From the repository root, install dependencies with `npm ci`, then configure the root `.env` without committing credentials:

```dotenv
CHANNEL_CODE=your-intelligence-channel-code
INTELLIGENCE_API_KEY=your-project-key
FORK_API_BASE=http://127.0.0.1:8787
FORK_API_TOKEN=your-b-server-token
FORK_PROJECT_CONFIG_ID=demo-product
FORK_PROJECT_MODE=existing_repo
FORK_SLACK_HOST_IDS=U0123456789
FORK_MEETING_URL=http://127.0.0.1:3000
FORK_CHANNEL_PORT=3001
```

`FORK_API_BASE` is B’s origin (the adapter adds `/api/sessions`). Its server-to-server Bearer credential must be accepted by B and scoped to the configured demo project. B must enforce authorization itself. `FORK_PROJECT_MODE` selects `existing_repo` (default) or `blank_template` for newly created sessions; `FORK_PROJECT_CONFIG_ID` must select an allowlisted project/template in B. Reopening a linked thread retains its existing session. Nothing in the URL/card grants browser authority; the host workspace still needs its own local authorized connection. Multiple allowed host IDs are comma-separated. The creator becomes that thread’s host; another allowlisted host cannot take over its controls.

Run `npm run channel:setup -- --no-clipboard` and follow its emitted maintained `channels-setup` skill instructions for **Slack**, reusing `apps/channel`. This requires the team’s CopilotKit Intelligence account and Slack installation; running the command alone does not connect Slack. Managed delivery does not need a local Slack token, Socket Mode app token, or public tunnel. Optional Intelligence HTTP/WebSocket base overrides must be configured together.

Start B’s API and the host meeting workspace, then run `npm run dev:slack`. The listener binds only to `127.0.0.1`. Startup requires real configuration and an `online` lifecycle state; it fails visibly on missing credentials or incomplete setup. `online` is a connection check, not proof of successful Slack delivery. Use `npm run channel:status` for provider setup diagnostics; do not paste credentials or full sensitive output into submissions.

## Thread workflow

Invite the configured app to the Slack channel. Mention it in the intended thread using exact commands:

- `@Fork start` or `@Fork open`: create one linked B session if absent, otherwise reopen it. This does not start microphone capture.
- `@Fork status`: fetch the current snapshot and show a fresh card.
- `@Fork pause`: host-only control; show B’s resulting state, including a pending acknowledgment when applicable.
- `@Fork stop`: host-only stop request plus the latest recap. A pending stop is labeled rather than claimed complete.
- `@Fork recap`: reconstruct a concise recap from B’s recorded experiments and mock notes.

Cards provide Open on host Mac, Refresh status, Pause, and Stop / recap controls. Unknown text displays help. Ordinary unmentioned thread conversation and message edits never execute controls. Only participant notice and permission in the local workspace can enable capture. Browser Undo/cancellation/clarification remain in the meeting workspace.

The Open link is deliberately labeled localhost: other attendees cannot use it to reach the host Mac. Only loopback meeting URLs without credentials, query strings, or fragments are accepted. Preview/control API addresses and credentials are not published in recap cards.

## Persistence and honest capability limits

Only the SDK’s public `Thread.conversationKey`, B’s session ID, and the configured creator’s Slack user ID persist in `.fork/slack-bindings.json` (optional `FORK_SLACK_BINDINGS_PATH` override). Writes are serialized and atomically renamed; run **one listener process** against this file. Concurrent starts in one thread reuse the same session. A corrupt binding file fails closed instead of creating a replacement session. A process crash between B session creation and local persistence can leave an orphan session; B must add an agreed idempotent create contract before claiming crash-proof creation.

No delivery-scoped Thread object is retained for later posts. Inline card handlers are process-local, so after restart request `@Fork status` for a fresh card. Session bindings survive restart. Stopping via Slack posts a recap in that delivery; when a meeting ends from the browser, request `@Fork recap`. Unsolicited automatic recaps remain pending a verified provider-supported delayed delivery mechanism. No transcripts or every-pixel-change messages are sent to Slack.

The desired product includes real Slack Huddle participation and autonomous screen sharing. **This managed Slack messaging adapter does not implement either capability**, meeting audio capture, or speaker identity. No Calls metadata API is treated as media transport. No simulated participant or hidden user login is implemented. The original Markdown’s human Huddle share is only a documented fallback and does not satisfy that expanded requirement.

## Verification

Run `npm run typecheck --workspace channel` and `node --import tsx --test apps/channel/src/*.test.tsx` from root. Offline coverage includes rendered native Slack cards, honest pending states/local links, host authorization, concurrent session binding and reload, corrupt persistence, explicit commands, and authenticated API failures/redirection policy.

Live acceptance still requires a configured account: send a real Slack start mention, reopen within the same thread, verify another attendee cannot pause/stop, pause as the host, stop and inspect the recap, restart the listener, and request status to recover the existing binding. Verify the local capture permission flow separately with A/B. No live Slack delivery or Huddle participation is claimed by offline checks.
