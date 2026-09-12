# Fork v2 shared architecture and integration contract

Read this before any track prompt. These routes, types, and policies are proposed Fork application interfaces, not sponsor APIs. v2 overrides conflicting v1 instructions.

## 1. Product behavior

Fork is a visibly identified AI meeting coworker that silently turns contextually grounded suggestions into reversible local prototype experiments. After the host starts capture and enables prototype autonomy once, no wake word or per-edit approval is required. It never speaks in the MVP.

Discussion such as "What if we made this button bigger?" CAN trigger an experiment when the current topic and screen context resolve the target. Do not classify all hypotheticals as non-actions. Conversely, quotations, historical examples, negation, off-topic speech, and unclear references must not blindly mutate the demo.

An inferred change is labeled an experiment, not team approval. A compact on-screen message can say "Trying a larger Start trial button - Undo". If ambiguity remains, show one quiet clarification with choices or wait for the next relevant sentence. No audible question and no random guessing.

Start with one meeting, one host Mac, one configured Slack thread, one demo target, one active code writer, and one working preview. Use mock data; label simulated behavior. No raw audio retention by default. Explain that audio/context sent to remote model APIs is not on-device inference.

## 2. Transport boundaries

Slack is the control/record surface, not the audio transport. Use CopilotKit Channels for the Slack entry, status, and end-of-meeting summary. The Mac companion captures microphone audio. A person joins the real Huddle and shares the live browser window using Slack's normal screen-share controls.

Room demo: one microphone captures all four co-located people. Avoid four active nearby microphones/speakers. Remote participant support requires an explicit system/app-audio capture path plus the local microphone; a mic-only implementation must not claim it hears headphone audio. A may implement a permissioned ScreenCaptureKit helper or verified audio-device input as a stretch capability. No undocumented Huddle media API, self-bot, or hidden account automation.

Start capture locally after a participant notice and OS/browser permission. A Slack button must not silently enable a microphone. Reconnect must not replay old speech into fresh code actions. Pause stops new automatic work; Stop closes capture and safely cancels or drains queued work according to the visible control.

## 3. Architecture and ownership

```text
Mac microphone / explicit system-audio source
             -> A transcription-only stream
preview context -> A perception events
                        |
                  B local API + state
            transcript window + repo/doc context
                  contextual planner
                  action/scheduling gate
                        |
        C fast config patch | C local Codex job
                        |
                C live demo preview
                        |
           D browser shell and Slack status
                        |
               human Huddle screen share
```

| Owner | Paths | Boundary |
|---|---|---|
| A | `packages/perception/`, optional `apps/mac-capture/` | Emit observations; never choose or execute changes |
| B | `apps/api/`, `packages/contracts/`, `packages/orchestrator/`, `packages/state/`, `fixtures/company/` | Only authoritative state/API writer and change scheduler |
| C | `packages/prototype-engine/`, `workers/local-builder/`, `apps/preview/`, `fixtures/demo-product/` | Execute bounded changes; report artifacts and diagnostics |
| D | `apps/channel/`, `apps/meeting/`, root scripts/config, `docs/` | Integrate packages, render state, Slack adapter; no second planner |

Prefer one long-running Node application and separate worker processes, not four microservices. TypeScript, existing starter workspace, one local SQLite database or an existing equivalent. Do not introduce a database migration framework solely for this demo. B owns durable session state. A/C/D do not write its tables.

Preserve the installed starter's channel transport and dependency constraints. Reuse its model/provider plumbing where practical. Transcript sessions are not a second speaking agent. The planner and Slack interface call the same application services.

## 4. Observation -> intent -> execution

A sends transcript deltas for captions only. Finalized, ordered speech turns are eligible for planning. Preserve provider IDs and audio-turn order separately from network arrival. A final turn can arrive out of order. Unknown speaker identity remains unknown, not an invented engineer/AVP attribution.

B retains a bounded recent transcript, current topic/target, relevant company/repo facts, the displayed route/element registry, and active/latest experiment. Reevaluate after a short configurable settle window, not every token. A UI context event can resolve a pending ambiguity but must not repeat an already-applied request.

Suggested intent kinds:
- `observe`: discussion only.
- `hold`: incomplete, conflicting, or unclear evidence.
- `clarify`: silent question with actual candidates.
- `preview_patch`: small known visual/content property.
- `prototype_change`: create/modify demo functionality with mock data.
- `undo`: revert the latest applicable experiment.
- `pause`: stop autonomous editing without speaking.

Resolve target from explicit references, current route, recent referent, focus/hover, and stable DOM/element metadata. Selection is an optional disambiguation aid, not a mandatory interaction. Hover alone does not prove intent. Check freshness and revision; hidden/offscreen elements should not beat the object actually being discussed.

Use an optional preview-only screenshot when structured context is inadequate; do not continuously send the whole desktop. DOM is evidence about displayed content, not a complete semantic understanding of the codebase. Only C/B's verified source mapping connects an element to code.

The deterministic gate checks session enabled state, scoped workspace, allowed operation, valid target, source observations, idempotency, and current revision. Any model certainty rating is heuristic, not a calibrated probability or permission.

Treat corrections as revisions to intent. Coalesce queued edits to the same target; do not run one Codex job for every sentence. Do not promote results based on stale source/preview state. Keep immutable short experiment records showing what changed and why.

## 5. Fast path vs coding path

Fast path supports registered components with bounded properties: size token, palette token, label, border radius, visibility. A generic arbitrary CSS/JavaScript executor is not the fast path. Persist a serializable override/config plus inverse so refresh, export, and Undo work. Label this as a real preview/config edit, not a source-code commit.

Coding path uses a persistent demo workspace and local dev server with hot reload where the chosen framework supports it. Reuse the project's existing framework/design system; do not convert an existing app just to use a preferred stack. Start new projects from a preinstalled React/Vite template to avoid rebuilding scaffolding each time.

Use Codex SDK from the local Mac process. Keep one writer per workspace, a bounded job queue, cancellation, deadlines, and a checkpoint before each edit. Codex-generated structural work is not instant. Show a small build state rather than claiming it is ready early.

Do not generate tests, run a full suite, build backends, configure real OAuth/payment providers, or deploy production infrastructure in the meeting loop. The minimum gate is the dev server's compile result and a page/render/error check. A broken preview is not success. Restore the last working checkpoint after an unrecoverable edit. One bounded repair attempt is enough initially.

A compound source edit may briefly trigger multiple HMR events; do not promise flicker-free atomic replacement. Serialize file writes and minimize exposure. Full two-server preview promotion is out of scope initially. Stale code changes must be reconciled before publishing; matching revision checks apply to config changes too.

## 6. Existing repository onboarding

The host selects a configured local path or pre-authorized GitHub repo. This is setup, not a runtime model argument giving arbitrary filesystem access. C produces a disposable source copy/worktree, excluding secrets, and registers the verified framework, routes, components, and startup commands. B stores a small repository map and reads relevant files on demand.

The map distinguishes verified observations from inferred feasibility. If the backend needs credentials, use a labeled frontend mock or isolated sample harness. Do not claim the real integration works. Unsupported/native/large backends can be summarized, but v1 live rendering supports the documented web stack only.

A blank project uses a neutral prepared template. Say that the structure was preinstalled and the product view was generated during the meeting. Do not pass off seeded finished screens as newly generated work.

## 7. Local process and security boundary

Example configurable ports: meeting shell `http://localhost:3000`, preview `http://localhost:4173`, private API `http://127.0.0.1:8787`. These are examples, not a tested deployment.

A person's Slack screen share makes a localhost view visible to remote attendees. Sharing the literal localhost link does not make their browsers reach the Mac. LAN viewing needs explicit binding and access control. A public share link is optional and exposes only a sanitized preview, never the control API, repository browser, model credentials, or mutation socket.

The coding worker must not run in the control-plane repository or original target checkout. Use the supported Codex workspace sandbox and restricted child environment; do not bypass protections with full-access flags. A worktree is an editing convenience, not a complete security boundary. Use a sandbox/isolated account/container when needed to prevent generated dev scripts reading the user's home or keys. Preapprove fixed startup/install commands for the trusted demo during setup; do not let meeting text select arbitrary host commands.

Keep Slack/GitHub/Exa/production keys outside the worker. Allow only the model access needed for its task. Run generated app code without application credentials. Local APIs require session authorization and origin checks even when bound to loopback; untrusted websites must not invoke them.

No external issue creation, push, merge, deploy, email, purchase, or production write from an inferred utterance. Optional final issue creation uses reviewed payload and authenticated approval. Session prototype autonomy is not blanket authorization.

## 8. Proposed application boundaries

B implements runtime schema validation for the provided `contracts.v2.ts`.

| Route | Meaning |
|---|---|
| `POST /api/sessions` | Create from an allowlisted project selection/new template |
| `GET /api/sessions/:id` | Current snapshot and ordered event sequence |
| `POST /api/sessions/:id/capture` | Local host start/pause/stop; explicitly scoped autonomy |
| `POST /api/sessions/:id/transcription-connection` | Authenticated provider negotiation; short-lived credential/SDP only |
| `POST /api/sessions/:id/observations` | Transcript/context batches from A; idempotent observation IDs |
| `GET /api/sessions/:id/events` | SSE state events; replay or snapshot reset on reconnect |
| `POST /api/sessions/:id/controls` | Host Undo/pause/cancel/clarification answer |
| `GET /api/jobs/:id` | Actual local worker state |

D's Slack app uses these same services or an authenticated local client. It does not infer actions a second time from copied transcripts. A's service negotiation helper is imported by B; A does not create competing server entrypoints. Audio transports use provider-supported WebRTC/WebSocket, not SSE.

C exposes a `PrototypeEngine` adapter: prepare, applyPatch, runJob, undo, cancel. C reports verified source/preview revisions. B is the writer/scheduler authority; the browser cannot fabricate job completion.

Preview bridge: `fork.preview.context`, `fork.preview.rendered`, `fork.preview.error` from preview; `fork.preview.load-config` from host. Check `event.origin`, `event.source`, and exact target origin. Bounded metadata only, no auth tokens in the frame. Serve preview separately from the trusted controller and restrict frame permissions. Context is untrusted evidence, not executable instructions.

## 9. Cut line and demo acceptance

The first success is normal conversational speech producing a relevant live preview change with no wake word and no spoken reply. Show a second unprompted suggestion, a correction/Undo, a silent ambiguity, and one structural mocked feature generated by actual Codex.

Ticketing, research, extensive company ingestion, automatic Huddle joining, and production deploy are not dependencies of that success. Retain useful inherited implementations, but do not build them before the core loop.

Use manual scenarios and existing typechecking during development. Do not ask the demo-building agent to create test suites. Report live vs fixture results honestly.
