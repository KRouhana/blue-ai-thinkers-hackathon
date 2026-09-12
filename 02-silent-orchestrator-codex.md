# Track B - context, intent, state, and scheduling

Read `00-shared-contract.md` first. Implement only B on `feat/silent-orchestrator`.

## Goal

Turn ordinary meeting discussion plus current screen/repository context into useful, reversible prototype changes. Fork is not waiting to be addressed, and is not speaking. Your output is a validated action or quiet status, not a chat monologue.

Own `apps/api/`, `packages/contracts/`, `packages/orchestrator/`, `packages/state/`, and `fixtures/company/`. You own shared route/type definitions; D owns root workspace integration, Slack, and UI. A produces observations. C performs changes. Avoid rebuilding their components.

## Begin with the shared boundary

Install the supplied v2 TypeScript interfaces in the application and add runtime Zod validation. Preserve the existing project's working stack. Use one local authoritative state store, preferably the existing SQLite support if present. Implement the routes in the contract and injected adapters for A/C/D.

Persist sessions, capture epochs, observation dedupe IDs, recent transcript/context, repository map, experiments, checkpoints, jobs, and ordered output events. Keep the schema small. No distributed queue, vector index, or separate planner per interface.

Derive identity/project authorization from server configuration and trusted sessions, not model parameters. Register A's transcription connection helper behind the same auth. D's Slack actions use the same services; do not replan every copied transcript twice.

## Contextual planner

Consume stable finalized turns after a short configurable settle window. Deltas are captions only. Retain a bounded rolling transcript and compact topic/referent state. Attach the UI snapshot that was valid when the speech occurred, not merely whatever is newest when an API response returns.

Use relevant repository files and a small map: framework, routes, likely components, configured startup commands, available mock data, and known limitations. Ask C for the verified map of its prepared demo copy. Retrieve a few Markdown company constraints when useful; do not load the entire repo on every sentence.

Use the existing starter provider/model infrastructure where practical, with one structured planner service. The Slack handler and transcript stream invoke that same service. No persona swarm and no separate autonomous voice planner.

Your proposed planner output must include source observation IDs, target evidence, intended result, bounded affected area, and action kind: observe, hold, clarify, preview_patch, prototype_change, undo, or pause.

## Behavior that differs from v1

During enabled prototype autonomy:
- "What if this button were bigger?" plus a resolved current button -> try a larger size.
- "Could we show only overdue items?" while reviewing the task table -> prototype a client-side overdue filter with mock dates.
- "No, keep the original size" -> undo the latest applicable size experiment.
- "Don't make that button larger" -> no enlargement.
- "The customer said 'make it bigger', but I disagree" -> do not execute the quotation.
- "Another idea would be..." -> wait for a complete idea.
- "Make it bigger" when two buttons remain plausible -> quiet clarification or hold.
- "This must work without signing in" -> update constraints, inspect relevant code, and adapt the demo rather than pretending real auth changed.

Do not require the literal name Fork, a command verb, a selection click, or per-edit approval. Do not use a keyword-only "make" detector. Do not treat every speculative sentence as a definitive product decision.

## Action gate and scheduler

Implement deterministic checks after model inference: session capture/autonomy enabled, finalized unsuperseded source turns, valid target/current context, permitted demo operation, allowed paths, size bounds, dedupe key, and revision match.

Prefer cheap no-op filtering and bounded structured outputs, but do not build an elaborate two-model chain. Use cache/retrieval wisely. Exa is optional evidence for a research question, never a dependency of making a button bigger and never a destination for private code/transcripts.

Coalesce pending edits to the same target. Schedule one active C code writer. A newer correction invalidates older pending intent; cancel safely where possible. Apply only worker results compatible with the current desired state. Serializing actions does not justify replaying a stale request after its contrary correction.

Revision checks apply to fast patches as well as code jobs. A DOM-based temporary override must not overwrite a code job's newer layout. Delegate reconciliation to a fresh job when needed. Do not silently discard changes that participants already saw.

A silent clarification contains actual candidate IDs and expires when route/referent state changes. Do not freeze unrelated conversation while waiting. A later contextual answer can resolve it, with the same origin dedupe key. Store reasoning summaries as brief evidence explanations, not hidden chain-of-thought logs.

## Demo-only permissions

A one-time local host action enables reversible changes in a specific disposable workspace. This is sufficient for in-scope preview exploration, not external writes. Never authorize GitHub writes, deploys, purchases, or real customer changes from inferred meeting intent or claimed job title.

Use mock integrations and explicit "demonstrated vs actually integrated" notes. No requirement for two competing alternatives on every edit; the decision recap is an end-of-meeting output. No full test generation, production backend, or exact performance/feasibility claims unsupported by inspected evidence.

## Independent proof and hand-off

Start with C's fake adapter clearly labeled. Replay the supplied scenarios and emit the expected action kinds and target evidence. Integrate the actual adapter later. Provide D one snapshot getter, ordered event stream, and host controls; give A a single observation ingestion path.

Manually verify duplicate-turn handling, pause, correction, ambiguity, negative/quoted statements, stale worker results, and Undo. Use existing typechecks; do not spend the meeting loop generating/running tests for prototype features.

Report actual commands/checks and whether model/Codex/Slack connections were live or mocked. Implement the working vertical slice, not just a design document.
