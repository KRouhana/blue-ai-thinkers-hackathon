# `@fork/perception`

Track A is a deliberately one-way package: it captures consented meeting audio
and preview evidence, then sends `Observation[]` to an injected `ObservationSink`.
It contains no planner, database, mutation API, autonomous action, wake word, or
text-to-speech path.

Until Track B publishes the workspace contract as an importable package, this
package carries a buildable structural mirror of the relevant `contracts.v2.ts`
types. It is intentionally compatible with the shared v2 `ObservationSink` and
contains no runtime contract copy.

## What it provides

- `CaptureController`: Start, Pause, Resume, Stop, source/status, captions, and
  a clearly-labelled developer typed-transcript fallback.
- `RecallBotClient` / `createRecallRuntime` from `@fork/perception/node`: a
  visible bot named **Fork** joins a host-provided Google Meet link. Recall
  streams mixed 16 kHz PCM through a signed WSS connection; the receiver keeps
  it in memory, up-samples to 24 kHz, and sends it to `gpt-live-transcribe`.
- `PreviewContextCollector`: bounded, visible, annotated preview context only.
  It excludes hidden/password inputs, input values, URL query/hash data, and
  likely secret-looking labels.
- `createPreviewContextBridge`: a versioned, exact-origin `postMessage` bridge
  so audio finals and preview snapshots reach the same host-owned sink.
- `PerceptionControls` from `@fork/perception/react`: compact React controls.

## Required setup for a live demo

Copy `.env.example` to a server-only `.env` and fill in:

- `OPENAI_API_KEY` with access to `gpt-live-transcribe`
- `RECALL_API_KEY`, `RECALL_WORKSPACE_VERIFICATION_SECRET`, and matching
  `RECALL_REGION`
- `PUBLIC_API_BASE_URL` with a stable, public HTTPS ngrok domain (not localhost)

Run a local HTTP server and mount the receiver before pressing Start. The host
must supply its own authenticated `ObservationSink`; Track A never stores
observations.

```ts
import { createServer } from 'node:http';
import { createRecallRuntime } from '@fork/perception/node';

const server = createServer((_request, response) => response.end('Fork receiver'));
const runtime = createRecallRuntime({
  server,
  sink: async (observations) => hostForwardObservations(observations),
  sessionId: 'session-from-host',
  streamId: 'google-meet',
  openAiApiKey: process.env.OPENAI_API_KEY!,
  recallApiKey: process.env.RECALL_API_KEY!,
  recallVerificationSecret: process.env.RECALL_WORKSPACE_VERIFICATION_SECRET!,
  recallRegion: process.env.RECALL_REGION as 'us-east-1',
  publicApiBaseUrl: process.env.PUBLIC_API_BASE_URL!,
});
server.listen(Number(process.env.PERCEPTION_PORT ?? 4318));

// Render <PerceptionControls controller={runtime.controller} /> in the host UI.
```

Point ngrok at that port using the configured static domain. `callbackUrl` must
resolve to `wss://…/recall/audio/`. Create a Recall workspace verification
secret first: the receiver rejects all missing/invalid signed upgrades before
it parses an event. Recall's `recording_config` requests `retention: null`, no
mixed video, and only the live `audio_mixed_raw.data` endpoint. Raw audio is
never written to disk or logged.

The host admits the visible **Fork** bot to the consented Google Meet. A missing
credential, unstable/public tunnel, or denied meeting admission is an explicit
live-demo blocker; it is never replaced by fixture audio.

## Run the package-local live demo

This is a disposable package-scoped host for pre-handoff verification, not the
shared application. It exposes the real receiver, controls, captions, and a
same-origin preview iframe that uses the versioned context bridge.

1. Create a stable ngrok HTTPS domain and tunnel local port `4318` to it.
2. Set `PUBLIC_API_BASE_URL` in `.env` to that HTTPS domain (without a path).
3. Run `pnpm build && pnpm demo` from this package.
4. Open `http://127.0.0.1:4318`, paste a consented Google Meet link, and press
   **Start**. Admit the visible **Fork** bot in Meet.

The server prints only its local page URL and WSS callback address—never a
secret or raw audio. The browser page shows live captions and sends annotated
preview evidence through the same in-memory sink. Use Ctrl-C or **Stop** to
remove the bot; do not terminate the tunnel first.

## Preview context bridge

Preview markup opts in with stable IDs. The collector does not make DOM changes
and only reports elements visible at capture time.

```html
<button data-fork-id="start-trial"
  data-fork-section="Signup"
  data-fork-editable="size,background,label,radius">Start trial</button>
```

In the preview iframe, post snapshots to the exact host origin:

```ts
const collector = new PreviewContextCollector({
  sessionId, workspaceId, revision: getRevision, captureEpoch: getCaptureEpoch,
});
collector.start((snapshot) => postPreviewContext(window.parent, hostOrigin, snapshot));
```

In the host, create one bridge that feeds the exact same sink as the audio
runtime. Pass the iframe's `contentWindow` as `source` when available.

```ts
createPreviewContextBridge({ origin: previewOrigin, source: iframe.contentWindow, sink });
```

For a same-origin local prototype, `emitPreviewContext(collector, sink)` is the
direct alternative.

## Checks and live verification

```sh
pnpm install
pnpm typecheck
pnpm test
```

The focused fixtures cover final-only transcript emission, duplicate
suppression, pause/stop epoch rejection, Recall signature rejection,
zero-retention request construction, bounded context collection, and invalid
bridge origins.

Live verification remains separate: admit Fork, speak normally and observe
captions/final observations, capture an annotated preview snapshot, verify no
spoken reply, pause then verify old speech is absent, and stop then verify Fork
leaves the meeting.
