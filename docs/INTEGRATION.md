# Track D integration handoff

## Ownership and operating modes

D owns `apps/channel`, `apps/meeting`, root development wiring, and this handoff. A provides capture/perception; B provides the authoritative session API, runtime contracts, scheduling, permissions, persistence, and worker control; C provides the real preview and builder. D imports the supplied root `contracts.v2.ts` without creating a competing authoritative contract package. Replace the import with B’s package when the agreed package is available.

`FORK_MODE=fixture` is the default. Its client is in-memory, deterministic, explicitly labeled, and advanced only by a user clicking **Next fixture event**. Fixtures exercise rendering and control wiring; they neither infer intent nor process audio. There is no fixture API server for Slack. `FORK_MODE=live` uses B’s real API and fails visibly if it or A is unavailable. It does not silently fall back to fixtures.

The single root `npm run dev` command loads `.env`, starts the meeting shell, and starts the fixture preview in fixture mode. Live mode optionally starts B/C’s existing npm workspaces named by `FORK_API_WORKSPACE` / `FORK_PREVIEW_WORKSPACE`; unset values mean those services must already be running. `FORK_SLACK_ENABLED=true` additionally starts the managed Channels listener. The launcher runs npm with argument arrays, stops sibling processes when one exits, and preserves a nonzero failure status. Preview children receive only basic path/temp/terminal/locale/runtime environment variables, never inherited API or Slack credentials; C’s preview workspace must bind its own configured development port. Ports must be free; Vite uses strict port selection.

## B: session HTTP and ordered events

The following is **D’s proposed wire interpretation of the supplied TypeScript contract**, not a claim that B has implemented these request bodies. Confirm it against B before enabling live mode. `FORK_API_BASE` is a credential-free loopback origin such as `http://127.0.0.1:8787`; the API paths include `/api`. `FORK_API_TOKEN` remains server-side. Browser requests use D’s same-origin development proxy; the proxy injects authorization and restricts routes, methods, Host, and Origin.

| Request | Expected body / response |
| --- | --- |
| `POST /api/sessions` | `{projectConfigId, mode: "existing_repo" | "blank_template"}` → `SessionSnapshot`; selected by server configuration `FORK_PROJECT_MODE` |
| `GET /api/sessions/:id` | Current `SessionSnapshot` |
| `POST /api/sessions/:id/controls` | A `SessionControl` object → empty success or JSON acknowledgement |
| `POST /api/sessions/:id/capture` | `{action: "start" | "pause" | "resume" | "stop", prototypeAutonomyEnabled: boolean}` → success; authoritative state arrives through events |
| `POST /api/sessions/:id/observations` | `{observations: Observation[]}` → success |
| `GET /api/sessions/:id/events?after=N` | SSE default `message` events with JSON `SessionEvent` payloads |

HTTP success acknowledges the request; it does not prove that a build was cancelled or a capture transition completed. B must emit authoritative state. B must authorize every action and validate observations and control IDs, capture epochs, expected revisions, project configuration references, and operation ordering. D never takes a client-provided filesystem path as project authority.

D validates snapshots/events with Zod, ignores duplicate/old events, and reconnects after malformed payloads or sequence gaps. It fetches a snapshot before resubscribing after recovery. B must retain/replay ordered events after the returned snapshot sequence to close that race. Wrong-session events must not update the active workspace.

**Contract limits to resolve with B:** snapshots currently omit active job state and caption history. After a snapshot reset, D labels job state unknown until B supplies a fresh job event; B should include job state in a future agreed snapshot or replay it. No transcript/caption output event exists, so D cannot reconstruct live captions from the existing contract. Speaker attribution currently permits only `verified: false`; no participant roster, trustworthy speaker identity mapping, Huddle lifecycle, sharing lifecycle, or presentation commands are defined. D must not invent these values. B owns any shared contract extensions.

## A: capture adapter

`FORK_PERCEPTION_MODULE` points to A’s local TypeScript module, which must export `captureAdapter` implementing D’s adapter boundary:

```ts
interface CaptureAdapter {
  source: string;
  available: boolean;
  start(context: {
    sessionId: string;
    captureEpoch: string;
    sink: (observations: Observation[]) => Promise<void>;
  }): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}
```

The default module reports capture unavailable and never accesses a microphone. The real adapter must describe its actual source, acquire local permissions through a user gesture where required, await readiness before resolving, report failures, and release media resources on stop. Observations need the active session ID/epoch, stable IDs, ordering information, and only evidence-backed unverified speaker labels under the current contract. The local host notice and reversible-demo scope must precede capture. A Slack start/open creates a session link; it does not bypass local capture permissions.

The sink forwards observations to B. D stops the local adapter on Pause/Stop and starts it with B’s fresh capture epoch on Resume, so old audio does not enter a new capture epoch. Adapter stop failure does not prevent sending the backend stop request. A remains responsible for audio acquisition, transcription, stream reconciliation, and identifying which participants its actual source can hear. D does not implement transcription or provision OpenAI credentials. Integrate A’s own controls/component when its package becomes available while preserving the same lifecycle and error semantics.

## C: isolated preview bridge

Set `FORK_PREVIEW_ORIGIN` to C’s exact allowed origin. D accepts a snapshot preview URL only on that origin and isolates it in an iframe. No credentials, API capabilities, filesystem access, or arbitrary executable payloads cross the bridge.

Every preview message must come from the current iframe window, the exact expected origin, the current workspace ID, and the expected `{source, config}` revision. D accepts `fork.preview.rendered`, `fork.preview.error` with a bounded `message`, and `fork.preview.context`. Context contains `route`, positive `viewport`, bounded `elements`, nullable `focusId`, `hover`, and `selection` compatible with `PreviewContextObservation`. A rendered acknowledgement means a page rendered; B/C’s compile-and-render verification still determines whether a structural job is ready.

The prepared fixture runs at `http://127.0.0.1:4173`, accepts only parent `http://127.0.0.1:3000`, and additionally accepts `fork.preview.load-config` with `workspaceId`, `revision`, and a fixture-specific `config` containing button size/color and filter visibility. **This fixture config is not C’s production patch API.** Real edits route through B and C; the browser does not command live source changes through the iframe. The fixture has no arbitrary code channel and validates configuration tokens before applying them.

Keep the last good preview visible on build failure. The mock board’s trial/invite actions are local explanatory interactions, and the overdue filter uses fixed sample tasks. None imply account creation, invitations, external services, or a database.

## Slack, Huddles, and presentation

Use the preserved managed CopilotKit Channels setup and native Channels JSX components; do not add Bolt or a second login flow. Slack start/open links one B session to a supported SDK thread ID; status reads B’s latest snapshot. Only configured host Slack identities may create/control sessions, and controls are restricted to the linked host. Mapping storage retains only the thread, session, and host identifiers necessary for those operations. Never retain delivery-scoped SDK objects to pretend delayed posting is supported.

The reliable recap path is a **fresh Slack `recap` or `stop` request**, which reconstructs the recap from B’s snapshot. Browser Stop does not imply that an unsolicited delayed Slack message was delivered. Automatic recap delivery needs a verified supported SDK delivery mechanism before it can be added. The card’s local operator link must explicitly say it opens on the local Mac; attendees cannot use localhost to reach that Mac.

**Product requirement versus implementation:** the user wants Fork to join Slack’s built-in Huddle as an actual participant, hear the discussion, attribute speakers, recognize brainstorming, and present a mock-data demo autonomously when useful. The supplied Track D document instead describes human screen sharing and forbids unsupported media claims. This implementation preserves D’s specified stack and establishes the UI/Slack adapters, but does not satisfy autonomous Huddle joining or screen sharing. No participant is fabricated. Slack messaging/Calls metadata is not evidence of media transport. The team must verify an authorized Huddle media and presentation integration, then agree B’s lifecycle/identity/presentation contracts and A’s media source. A human screen-share may be shown only as an explicitly labeled fallback, not completion of this requirement. Check current Slack plan/participant limits in the actual workspace before any Huddle demo.

Generated demos remain mock-data applications unless real services are explicitly provided and authorized. B’s internal SQLite persistence is separate from databases inside generated demos.

## Acceptance and remaining live verification

- Run root typecheck, tests, and production build. Exercise fixture advance, Undo, Pause/Resume, Stop, clarification, cancellation before Ready, and failure retaining the preview.
- Reject wrong-origin/source/workspace/revision preview messages. Confirm preview context forwarding never carries authority or tokens.
- With B, verify creation, reconnect replay, stale/duplicate events, visible control failures, capture epoch transitions, and cancel acknowledgement versus final cancelled state.
- With A, verify actual local permissions, source labeling, stop cleanup, and exactly whose speech is captured. Check remote Pause/Stop also reconciles the local adapter.
- With C, verify ordinary unaddressed speech → grounded visual change → correction → real compile/render-checked mocked feature → Undo. Fixture events do not meet this live acceptance criterion.
- With a configured managed Channel, verify one real start/open card, the correct same-session status, allowed/denied host controls, and a fresh recap request after Stop. Record actual account/setup failures without logging secrets.
- Record Huddle participant identity, audio coverage, speaker attribution, and agent-controlled sharing as **unverified** until demonstrated through a supported integration. No live connection or latency claim should be inferred from D’s local tests.
