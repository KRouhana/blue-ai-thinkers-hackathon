# Track C - local Mac prototype engine

Read `00-shared-contract.md` first. Implement only C on `feat/local-prototyper`.

## Goal

Make a usable local demo appear and evolve while the team talks. Favor existing components, a running dev server, and mock data. Fork is demonstrating ideas, not delivering production-ready software.

Own `packages/prototype-engine/`, `workers/local-builder/`, `apps/preview/`, and `fixtures/demo-product/`. B owns job state/scheduling and D owns the meeting shell/Slack. A owns audio and the generic UI context collector.

Expose the v2 PrototypeEngine adapter. Use injected job/status sinks; do not create another authoritative queue or database.

## Two preparation modes

NEW: start a disposable project from a neutral preinstalled React/Vite template with sensible components. Do not prebuild the finished product and call it generated. Use this prepared environment to generate a first useful screen from B's inferred brief.

EXISTING: receive an allowlisted local source path selected by the host. Prepare a demo copy/worktree, preserve the original files and uncommitted work, exclude credentials, inspect the existing package/scripts/routes, and use the existing frontend framework. Never blindly run arbitrary scripts from an unreviewed repo. Fixed permitted install/start commands are setup configuration, not model freedom.

Return a RepoMap with actual framework, relevant paths, startup command, base commit or content fingerprint, UI routes/components, and gaps. Report unsupported stacks instead of claiming universal compatibility. A frontend harness with labeled mock API results is acceptable when the real backend cannot run.

## Live preview baseline

Keep a dev server running at a configurable loopback port. Use its real hot reload mechanism, not cloud redeploys for every edit. Return the local preview URL, workspace/preview revision, and actual readiness state.

Integrate A's page-context collector in your preview bridge. Stable data-fork IDs and element metadata help for the prepared template. For an existing app, map relevant elements/components during onboarding where feasible; never invent mappings. Context collection must stay within the preview and avoid input secrets.

## Fast patch path

Implement a small allowlisted property system for registered components: size tokens, bounded palette tokens, text labels, radius, and visibility. This can use a persisted demo configuration read by components. Store enough information for refresh and Undo; include it in exports/snapshots.

Do not expose eval, arbitrary JS/CSS, general shell, arbitrary DOM selector mutation, or raw HTML insertion to the planner. A nonregistered complex change goes to the coding path. A fast patch is a preview/config change, not a claim that original source code was committed.

Provide `applyPatch` with expected revision checks and an actual render acknowledgment. Use one coherent revision model with B. Do not race a config mutation against source generation on the same workspace. Coordinate coalescing/cancellation through B.

## Codex path

Use the official TypeScript Codex SDK in a local Mac process. Inspect current installed SDK types and official repository examples before calling methods. Support the team's configured authentication; a local logged-in app is not automatically proof your worker can authenticate.

Maintain one coding thread per appropriate workspace/session where supported, and one writer. For each job supply:
- Current display/repo revision and relevant source paths.
- The narrow desired demo outcome and current constraints.
- Mock data requirements.
- Explicit scope exclusions: tests, real integration setup, production deploy, broad refactor.

Use a prompt along these lines:
"Produce the smallest visible prototype change for this meeting. Reuse existing components. Use clearly labeled mock data and simulated external services. Do not create tests or documentation unless needed to run this view. Do not refactor unrelated code. Do not add dependencies unless necessary and permitted. Keep the existing dev server working."

The worker uses supported workspace sandbox protections with a restricted environment. Never request full host access as a speed optimization. Do not inherit Slack/GitHub/Exa/production credentials, mount the home directory, or edit Fork itself. A worktree is not sufficient isolation for arbitrary generated commands. Use an isolated account/container where needed and preprovision dependencies during setup. If a sandbox refuses access, report it; do not silently bypass it.

## Minimum verification - no generated test suite

After a change, read the dev server's compile diagnostics and load the affected preview page. Check for a fatal render error/blank page. This can be one existing browser check; it is not a request to generate unit/end-to-end tests or run the project's full suite.

Keep a checkpoint before edits, one bounded repair attempt, and rollback to the last working state on failure. Report what was checked accurately: "Preview renders; data mocked" is appropriate. "Production ready", "fully tested", or "integration verified" is not.

Return diff/affected files, source/config checkpoint IDs, local URL, diagnostics, simulated integrations, and actual job state. A failed or superseded result must not be published as the new desired state. Coordinate stale-result handling with B. Cancellation must stop the worker job as supported, not merely change a UI label.

## Independent demonstration

Without Slack/audio, show:
1. Blank template -> real generated product view.
2. A configured existing web repo starts without touching its original checkout.
3. A known button grows through the fast patch path and persists on reload.
4. A structural client-side feature with synthetic data comes from real Codex.
5. Undo/rollback and a visible failed render recover to a usable preview.

Provide D preview URL/readiness and bridge messages. Provide B the adapter, source map, and version/cancellation rules. Do not build another meeting UI.
