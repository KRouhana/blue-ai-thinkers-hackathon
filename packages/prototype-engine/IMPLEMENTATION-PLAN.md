# C implementation plan: real local coding with live feedback

Status: implementation underway, 2026-09-12. The user's subsequent instructions govern delivery: no tests, a lean hackathon implementation, manual verification, and incremental pushes. Acceptance evidence and integration instructions are recorded in this package's handoff documents.

Branch: `feat/local-prototyper`.

## Outcome and scope

C runs on the host Mac. It receives resolved meeting changes from B, uses a real local Codex worker with terminal tools to modify real project files, keeps a localhost preview running, and streams observable execution and verification feedback through B to D. A supplies actual meeting observations and preview context. Final acceptance requires these live integrations; fixture execution does not satisfy it.

The first acceptance example is: "Add a searchable list to this page" produces an actual source diff, a working search interaction in the browser, live job feedback, and an Undo that restores the previous source and working preview.

Initial supported target: one host, one active meeting workspace, one active writer, a neutral React/Vite project and an explicitly configured existing React/Vite repository. This framework restriction is a proposed first release boundary, not a claim of current support. Other frameworks get explicit qualification later; onboarding must never silently convert an existing project.

The worker edits a persistent disposable source copy outside Fork's control repository. Changes are real and retained for inspection/export. The original checkout, including dirty files, remains intact. A source copy is preferred initially over a linked Git worktree because worktrees share Git metadata and do not automatically include uncommitted changes. Neither option alone provides process isolation.

Local execution still uses a remote model service unless the selected provider explicitly establishes otherwise. Localhost is the serving location, not a claim of on-device model inference.

Real Fork integrations are required. Connections made by the generated application must be explicitly configured and verified to be called integrated. Missing credentials or unavailable services are reported; they must not silently become mocks. Synthetic datasets are fine for isolated tests and must be labeled when shown. External mutations, production credentials, deployment, push, and merge remain outside inferred meeting authorization.

## Changes from the supplied assignment

This plan reflects the user's clarified requirement for a reliable local coding engine rather than a fixture-only hackathon demonstration. The existing documents remain unchanged pending coordinated updates:

- Replace mocked execution as an acceptance path with real Codex execution and integrated A/B/D evidence.
- Do not write tests. Verify C's reliability, security boundaries, and recovery manually through the real adapter, local driver, and browser.
- Make structural source editing the first visible milestone; implement the fast configuration path after it.
- Preserve ownership: C owns `packages/prototype-engine/`, `workers/local-builder/`, `apps/preview/`, and `fixtures/demo-product/`. B owns shared contracts, scheduling, and authoritative session/job state. D owns root workspace manifests, lockfile, launch integration, and meeting/Slack UI. A owns perception and its context collector.
- Treat proposed contract additions below as requests to B, not already available APIs. D should align setup notices and acceptance documentation with the agreed scope.

## Architecture

```text
A: finalized speech + preview context
                 |
B: resolve intent, authorize, coalesce, persist job, serialize dispatch
                 |
C: PrototypeEngine -> workspace guard + checkpoint
                 -> local Codex runner -> real file edits / terminal commands
                 -> supervised dev server -> localhost preview
                 -> compiler + browser verification
                 |
B: durable ordered status/events and final result
                 |
D: preview, activity feed, correction, cancel, Undo
```

C does not create a second intent planner, session database, or job queue. It does maintain execution artifacts: workspace metadata, source/config snapshots, a durable operation journal, output summaries, and process ownership records. Those records permit reconciliation with B after a crash; they are not authority to schedule or replay meeting work.

One workspace guard covers preparation, source jobs, config patches, Undo, repair, and restoration. Reject concurrent mutation instead of accepting another C-side queue. The guard spans processes; an in-memory mutex alone is insufficient. Recovery must prove the old writer is stopped before granting a new writer access.

The worker terminal is a supervised execution capability. D renders sanitized command/activity events. An interactive user shell or terminal emulator embedded in D is not necessary for this release. If human file editing is allowed later, it needs explicit ownership transfer; unsynchronized edits are detected as conflicts.

## Proposed contract agreement with B, A, and D

Keep the existing `PrototypeEngine` methods as the starting interface. Resolve these details before integrating implementations:

| Topic | Required agreement |
| --- | --- |
| Identity | Bind project configuration, workspace, session, job, operation, and checkpoint IDs server-side. Reject cross-workspace or cross-session references. |
| Revisions | Preserve monotonic `source` and `config` counters. A restoration creates a new revision even when its contents match an old checkpoint. Record content fingerprints separately. |
| Attempts | Add an execution attempt ID and workspace generation/fencing value to distinguish retries and pre-restart writers. Confirm the desired intent is still current before reporting a successful result. |
| Lifecycle | B retains job states. Add phases such as preparing, editing, verifying, repairing, cancelling, and restoring as shared progress metadata where useful. Do not overload `ready` to mean process started. |
| Cancellation | `accepted` means a request was accepted. A terminal cancellation event means execution has stopped and restoration is complete, or explicitly reports recovery failure and blocks new work. |
| Pause/Stop | Pause prevents new jobs but lets the current job finish. Cancel stops the current job and restores its checkpoint. Stop prevents new jobs, cancels active work, and restores before settling. Coordinate capture behavior with A/B/D. |
| Idempotency | Same operation ID and same payload returns its known state/result; same ID with a different payload is rejected. An uncertain execution is reconciled, never blindly repeated. |
| Feedback | Structured, bounded events: operation/attempt IDs, sequence, timestamp, phase, command start/end, sanitized output, affected paths, diagnostics, and terminal outcome. B assigns its authoritative event sequence. |
| Render evidence | Correlate workspace, source/config revision, operation, route, and preview instance. A stale or forged bridge event cannot establish completion. Include verifier-owned browser evidence. |
| Errors | Stable codes with retryability and recovery state for auth, unsupported project, dependency/setup, conflict, compile, render, cancellation, timeout, disk, and worker failures. |
| Recovery | Define a reconciliation/status hook between B and C for restart, lost responses, and orphan attempts. Shared v2 currently lacks a complete recovery interface. |
| Results | Include verified diff/changed files, checkpoint references, diagnostics, relevant behavior checks, integration status, and the final preview revision. A source diff does not prove requested behavior works. |
| Preview mapping | C supplies verified source mapping; A's collector emits observed elements. Refresh mapping after source edits; invalidate removed or stale targets. |

An SDK conversation/thread ID is scoped to its project/session. After rollback or major reconciliation, start a fresh thread or explicitly rebase its context on the actual filesystem. Old conversational state must not persuade the worker that reverted code is still present.

## Work packages and exit criteria

### C0 — resolve execution and integration assumptions

Deliver a short capability report and proposed shared contract changes to the team.

- D establishes the root starter, package manager/runtime, package imports, and pinned dependency baseline; the current checkout contains documents and contract source only.
- Inspect the actual installed Codex SDK/runtime versions and types. Prove supported authentication, streaming event granularity, cancellation behavior, workspace configuration, and environment handling.
- Prefer the prescribed TypeScript SDK behind a C-owned runner interface. If it cannot supply required control or live event detail, evaluate the local Codex App Server behind the same interface and document the decision before implementation expands. Do not build both transports speculatively.
- Establish the local execution boundary for both Codex commands and the generated dev server. Restrict writes, home/secret access, environment inheritance, and network destinations. Do not assume a write sandbox restricts reads or that a dev server launched outside it inherits protection.
- Use a dedicated local execution account or local container if the selected runtime cannot enforce the required boundary. Choose and demonstrate the mechanism here, before running generated code. A container is still hosted locally, but its networking and file-watching behavior need qualification.
- Verify allowed project scripts and setup commands, the supported browser, and a configured real target repository.

Exit: one real authenticated bounded worker operation, observable events, and a cancellation/isolation probe succeed. Unsupported capability is an explicit blocker, not a silent fallback.

### C1 — workspace and preview preparation

Implement preparation and process supervision under C's owned paths.

- Copy configured source with dirty tracked and permitted untracked content preserved. Exclude secrets, repository credentials/history, dependency caches, and external symlink targets. Use explicit exclusions plus inspection; `.gitignore` alone is not a secrets policy.
- Fingerprint the source before/after copying; fail or retry if the original changes during capture. Record which files were intentionally excluded.
- Inspect manifests, lockfiles, routes, and entry points without executing unreviewed lifecycle scripts. Use pinned, reviewed setup commands and provision dependencies before the meeting.
- Start the configured server on an available loopback port; report the actual URL. Distinguish process spawn, HTTP response, and browser-ready state.
- Track owned process identities and descendants. Never kill unrelated processes to free a port.
- Integrate the preview bridge on a separate origin from the controller. Verify origin/source, bound metadata, and preserve the application's rendering behavior.

Exit: the blank template and a configured existing project render; the original checkout's content and Git state are unchanged; restart and shutdown leave no owned orphan processes.

### C2 — first real structural change with live feedback

- Accept a valid B-shaped job through the engine. A manual development driver can call the same interface until B is connected; it cannot fake worker results.
- Acquire the workspace guard, validate revisions and source fingerprints, create a durable checkpoint, and record the attempt before execution.
- Give Codex the narrow change, source context, current revision, permitted commands/dependencies, and explicit project constraints.
- Stream actual execution activity through an injected B sink. Track event time separately from receipt time; do not invent progress percentages or live stdout if the runtime only emits completed-command output.
- Keep the preview server supervised. Let its actual HMR behavior show progress, with an unverified/editing status until verification finishes.
- Verify compile diagnostics and the affected page, then exercise the requested interaction. For the first searchable-list change, enter a query, check matching results, check an empty result, and clear it.
- Return source diff, checkpoint, actual URL, and evidence. Preserve the real resulting workspace for inspection and later export.

Exit: actual Codex adds a working searchable list; D/B can observe real phase events; a provider or verification failure cannot return `ready`.

### C3 — corrections, cancellation, Undo, and recovery

- Wire cancellation to supported runtime interruption and a supervised termination deadline. Confirm descendant termination before restoring or releasing the workspace guard.
- Permit one repair attempt for compile/render defects within the overall deadline. Do not repair an intentionally cancelled or superseded request.
- Restore all changed source/config content, including created/deleted files and lockfile changes. If dependencies changed, reconcile installed dependencies or block readiness until they match the restored lockfile.
- Make latest-applicable Undo the initial supported behavior. Arbitrary older Undo must detect dependent later work and require reconciliation rather than clobber it.
- If B invalidates a job while it is running, stop and restore the attempt before executing the correction. Show that recovery explicitly because intermediate HMR may already have exposed part of the obsolete change.
- After a crash, compare B's intent/state with C's journal, process identities, and filesystem fingerprints. Persist known results for replay; quarantine uncertain workspaces until reconciled. Never rerun meeting speech automatically on restart.
- Detect manual workspace edits; stop with a conflict and preserve both sets of artifacts instead of resetting over them.

Exit: cancellation during file edits and command execution, mid-write crash, lost completion response, and correction during verification all recover without concurrent writers or false success. If recovery fails, the workspace is visibly unavailable and new mutations are blocked.

### C4 — bounded fast patches and durable change export

- Add registered size/palette/label/radius/visibility config patches using the same guard, revision model, operation dedupe, checkpoints, and browser checks as source jobs.
- Persist configuration and inverse changes; ensure refresh and export include them. Explain whether an operation modified config or source.
- Reconcile overrides after structural edits so old config cannot invisibly override new source behavior.
- Retain a reviewable local source copy and diff/export artifact. Export handles permitted new files and deletions without leaking credentials. Applying changes back to the original repository is a separate explicit operation with conflict detection.

Exit: source job → patch → reload → Undo behaves consistently, and exported source/config reproduces the result with the recorded dependency setup.

### C5 — integrated qualification and release readiness

- Connect A's real observations/context, B's live scheduling, C's authenticated worker, and D's actual browser/Slack controls and status.
- Run the complete speech → change → live feedback → browser interaction → correction → Undo path. No fixture substitution qualifies an integration as live.
- Exercise negative/ambiguous utterances through A/B: C must only receive authorized resolved actions. C still validates workspace/revision boundaries independently.
- Verify each claimed external integration using a suitable real test account/environment and a meaningful operation. Rendering the UI is not proof of authentication, delivery, or backend behavior.
- Run manual integration fault scenarios and a sustained session on the actual host. Observe event backlog, process cleanup, and latency without adding a test suite.
- Deliver setup, supported stack/version matrix, configured limits, sanitized evidence, troubleshooting/recovery instructions, and known limitations for D's runbook.

Exit: all required acceptance scenarios below pass with live evidence on the chosen host. Completion of a local driver run alone does not mean A–D is ready.

## Anticipated problems and responses

| Problem | Detection and response | Owner |
| --- | --- | --- |
| Meeting corrections arrive faster than code generation | B coalesces pending intent; C cancels/restores obsolete active work before accepting a replacement. Measure queue delay separately from execution latency. | B/C |
| SDK streams less detail than expected | C0 probes exact event granularity; use truthful phases and completed-command output, or choose a verified transport that meets the live feedback requirement. | C |
| Auth works in the app but fails in the worker | Run the preflight from the actual restricted worker environment. Expose an actionable auth/setup state; no credential copying into the project. | C/D |
| Auth expires, network drops, rate limit or quota hits | Preserve checkpoint; classify failure; use bounded backoff only when execution is known not to have started or after reconciliation. Keep working preview available. | C/B |
| Wrong target despite valid code | Fresh source mapping and B evidence checks; verify the requested behavior on the affected route. Report what was actually checked. | A/B/C |
| HMR shows partial or broken edits | Mark preview as updating/unverified, capture errors, repair or restore. A single-server design cannot promise atomic visual promotion. If uninterrupted working display becomes required, plan isolated candidate/stable servers separately. | C/D |
| Browser reports an old revision as rendered | Match operation, workspace, revision, route, and preview instance; use verifier-owned checks. Timeout instead of claiming completion. | C/A |
| Preview never acknowledges or bridge is removed | Report render-unverified; browser verifier checks route/error state and restores or repairs bridge. Generated content cannot self-certify correctness. | C |
| Slow UI consumes unlimited terminal output | Bound event payloads and local log retention, redact before persistence/transmission, coalesce output; preserve lifecycle/final events and provide snapshot recovery. | C/B/D |
| Terminal output contains secrets or control sequences | Restrict environment, scrub known sensitive values/paths, strip terminal control sequences, render output as text, and cap payloads. Redaction is defense in depth, not the isolation mechanism. | C/D |
| Worker starts child processes that survive cancellation | Track descendants, confirm termination, and quarantine the workspace if termination cannot be proven. Never restore under a live writer. | C |
| Port collision, stale dev server, or Mac sleep/wake | Track process identity, allocate a configured free port, publish updated preview identity, recheck health on wake, and avoid automatic replay of uncertain jobs. | C/D |
| Install prompt, missing package, incompatible Node version | Preflight and preprovision locked dependencies. Disable interactive command hangs; report missing setup. Dependency changes require configured permission and renewed verification. | C/D |
| A trusted script is changed by generated code | Treat changed scripts and dependency hooks as untrusted; revalidate before executing. Enforce isolation independently of command names. | C |
| Source includes secrets, symlinks, submodules, or monorepo links | Canonicalize paths, reject escapes, inspect copy contents, and qualify these layouts explicitly. Unsupported topology fails preparation with useful diagnostics. | C |
| Human or second worker edits concurrently | Cross-process guard plus content fingerprints and writer generation; block and preserve conflicts. Do not automatically reset foreign changes. | C/B |
| B loses connection after C succeeds | Reconcile the durable operation result by ID, with the same resulting fingerprint; do not execute it twice. | B/C |
| Rollback restores source but not database/API effects | Scope Undo to recorded local source/config. Isolate mutable local test data and snapshot it when supported; external side effects are not reversible by Git. No general rollback guarantee for external integrations. | B/C/D |
| Rollback fails or disk fills | Preflight free space, bound snapshots/logs, keep last known working checkpoint, verify restoration, and block new work with a recovery path if unavailable. | C |
| Prompt injection in speech, repository files, or DOM | Treat content as evidence, not permission. Enforce project and process boundaries outside model prompts; B authorizes operations and C validates scope. | A/B/C |
| A web page attacks localhost or the controller | Separate origins, authenticated control requests, strict origin/host checks, narrow bridge, and restricted generated-app access to control endpoints. Loopback binding alone is insufficient. | B/C/D |
| Cost or latency makes the meeting unusable | One writer, bounded queue upstream, deadlines and usage limits, short relevant context, honest progress. Collect baseline measurements before promising coding completion times. | B/C/D |

## Verification and evidence

Manually verify operation dedupe, revisions, checkpoint coverage, path boundaries, process cleanup, cancellation, and interrupted-operation reconciliation. Use actual SDK runs for execution qualification. Do not create test files or suites. An injected failure during a manual check is recorded as such and never substitutes for live execution.

Required evidence set:

1. Prepare blank and configured existing projects; compare original files/Git state before and after.
2. Real Codex source edit and a browser behavior check, with correlated job/event IDs and sanitized logs.
3. Follow-up correction and a latest-change Undo, with monotonic revisions and matching restored content.
4. Duplicate request, stale revision, and mismatched payload rejection without extra edits.
5. Cancellation during a long command and during edits; no surviving writer, verified restore.
6. Deliberately broken compile/render, bounded repair, and failed-repair rollback.
7. Worker restart, B disconnect, lost completion response, browser reconnect, and sleep/wake reconciliation.
8. Missing auth/network, occupied port, disk pressure, and dependency failure surfaced as failures rather than ready states.
9. Boundary probes for out-of-workspace files, symlink escape, sensitive environment access, controller access, and forged/stale preview messages.
10. Fully live A–D session: speech causes source changes, visible feedback is accurate, and correction/Undo reaches the same workspace.

For each scenario record expected/observed behavior, source/config revisions, checkpoints, verification results, SDK/runtime versions, and live versus fixture status. Avoid credentials, raw private transcripts, and proprietary source dumps in shared evidence.

Suggested initial targets to validate, not measured promises: local status delivery within one second after C receives an event; a cancel acknowledgement within one second; ten seconds for graceful worker interruption before supervised escalation. Set render/startup/job deadlines and maximum log/checkpoint budgets from C0/C1 measurements. Record dispatch-to-first-event, edit-to-render, total job time, and cancel-to-quiescence separately.

## Immediate next implementation step

Start C0: agree on the shared contract deltas with B and D, inspect the installed SDK after D's root bootstrap, and prove one real worker edit with event streaming and interruption in the selected local isolation environment. Then build C1/C2 into the first real searchable-list milestone. Do not postpone A–D integration until all hardening work is finished.

Remaining setup inputs are the team's chosen target repository, actual model/auth configuration, supported browser/runtime, and whether the target app needs real external service credentials. These are setup facts to establish, not reasons to replace live behavior with simulated success.

## Official implementation references

The official Codex SDK documentation describes programmatic local coding and continuing/resuming threads. It distinguishes SDK automation from App Server clients that need authentication, approvals, history, and streamed events. This motivates the bounded transport capability check in C0; exact streaming/cancellation semantics remain to be verified against the installed runtime.

- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)
- [Codex sandbox documentation](https://learn.chatgpt.com/docs/sandboxing)

All lifecycle, recovery, revision, and acceptance requirements above are proposed Fork application design, not claims that the SDK supplies those features automatically.
