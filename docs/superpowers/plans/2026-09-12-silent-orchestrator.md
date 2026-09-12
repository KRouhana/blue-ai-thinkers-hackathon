# Track B — Silent Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Fork's Track B: the local authoritative API + state + contextual planner + deterministic gate + single-writer scheduler that turns finalized meeting speech plus preview context into reversible prototype experiments, proven end-to-end against `scenarios.json` with a labeled fake engine.

**Architecture:** One long-running Node process (`apps/api`, Hono on `127.0.0.1:8787`) wraps an `Orchestrator` (`packages/orchestrator`) that owns the pipeline: ingest observations → settle window → planner (LLM via Vercel AI SDK, or labeled fixture) → deterministic gate → per-session single-writer scheduler → `PrototypeEngine` adapter (C's, or labeled fake) → ordered `SessionEvent` stream (SSE). All durable state lives in one `node:sqlite` database behind a `StateStore` repository interface (`packages/state`). Shared route/type definitions plus runtime Zod validation live in `packages/contracts`.

**Tech Stack:** TypeScript 5.7 (ESM, `moduleResolution: bundler`), npm workspaces (mirrors CopilotKit starter), `tsx`, `node:test` + `node:assert/strict`, `zod@4`, `hono@4` + `@hono/node-server@2`, `ai@6` + `@ai-sdk/openai@3` (same major the starter's `agent-core` uses), `node:sqlite` (Node ≥ 22.13).

**Spec:** `02-silent-orchestrator-codex.md` (Track B), `00-shared-contract.md` (shared contract), `contracts.v2.ts` (types), `contract-examples.v2.ts`, `scenarios.json`, `START-HERE.md`, `DEMO.md`. All at repo root.

## Context

The repo is currently docs-only (`410f0c8 initial commit`): a v2 hackathon pack for "Fork", a silent AI meeting coworker. Four teammates each own a track; this branch (`vivek/silent-orchestrator`) implements **Track B** only. B owns `apps/api/`, `packages/contracts/`, `packages/orchestrator/`, `packages/state/`, `fixtures/company/` and is the only authoritative state/API writer and change scheduler. A (perception) sends observations; C (prototype engine) executes changes; D (Slack/meeting shell) renders state and owns root workspace files.

No app scaffold exists yet. D will eventually install the CopilotKit `agents-everywhere-starter-kit` (npm workspaces, ESM, Node ≥ 22, per-package `tsc --noEmit` + `node --import tsx --test`). To stay mergeable, B creates a **minimal root mirroring the starter's conventions** (decision confirmed by user) and keeps everything else inside B-owned directories.

Verified facts that shaped this plan (checked 2026-09-12):
- Starter model plumbing = Vercel AI SDK (`@ai-sdk/openai@^3`, env `MODEL_PROVIDER`, `MODEL`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`). B's planner mirrors that env contract with its own tiny resolver (no dependency on `agent-core`, which pulls in `@copilotkit/runtime` + Express).
- Starter test convention = `node --import tsx --test 'src/**/*.test.ts'`. No vitest. B follows it.
- Starter has no SQLite. `node:sqlite` is unflagged from Node 22.13 / 23.4, release candidate in 25.7. This Mac runs Node 25.6.1 (prints `ExperimentalWarning`, silenced with `--disable-warning=ExperimentalWarning`). Startup guard errors clearly on older Node. Decision confirmed by user.
- `hono` is already a transitive dep of the starter; `streamSSE` from `hono/streaming` supports `id`/`event`/`data` + `onAbort`.
- `ai@6` structured output: `generateText({ model, system, prompt, output: Output.object({ schema }) })` → `result.output`; OpenAI structured output requires `.nullable()` instead of `.optional()` in schemas.
- `codex` CLI is not installed locally and no model keys are in the environment → the live planner path must be built but will be reported as "not verified live" unless a key is provided at execution time. Fixture planner + fake engine prove the pipeline.

## Global Constraints

Copied from the spec; every task implicitly includes these.

- Only B writes durable session state; A/C/D never write B's tables. (`00-shared-contract.md §3`)
- "No wake word, no command verb, no selection click, no per-edit approval." Hypotheticals CAN act when target resolves. Negation, quotation, incomplete ideas, off-topic, ambiguity must NOT mutate. (`02 §Behavior`)
- Deltas (`phase: 'partial'`) are captions only — never planned. Only finalized, unsuperseded turns are eligible. (`00 §4`)
- Reevaluate after a short **configurable settle window**, not every token. (`00 §4`)
- Attach the UI snapshot valid **when the speech occurred**. (`02 §Contextual planner`)
- Deterministic gate after model inference checks: session capture/autonomy enabled, finalized unsuperseded source turns, valid target/current context, permitted demo operation, allowed paths, size bounds, dedupe key, revision match. (`02 §Action gate`)
- Coalesce pending edits to the same target; one active C code writer; newer correction invalidates older pending intent; cancel safely; never apply stale worker results; never replay a stale request after its contrary correction. (`02 §Action gate`)
- Revision checks apply to fast patches and code jobs alike. (`02 §Action gate`)
- Silent clarification contains actual candidate IDs, expires on route/referent change, resolvable by later context with the same origin dedupe key. (`02 §Action gate`)
- Store reasoning summaries as brief evidence explanations, not hidden chain-of-thought. (`02 §Action gate`)
- Reconnect/Pause/Resume must not replay old speech into fresh actions. Pause stops new automatic work; Stop closes capture and cancels/drains queued work. (`00 §2`)
- Never authorize GitHub writes, deploys, purchases, external writes from inferred intent. (`02 §Demo-only permissions`)
- Local APIs require session authorization and origin checks even on loopback. (`00 §7`)
- Fakes are explicitly labeled and never silently replace a failed live integration. (`START-HERE.md`)
- Example ports: API `http://127.0.0.1:8787`, meeting shell `http://localhost:3000`, preview `http://localhost:4173`. (`00 §7`)
- Use existing typechecks; report live vs fixture honestly. (`02 §Independent proof`)
- User's global rules (override spec where they conflict): TDD with `node:test`, ≥ 80 % coverage on B's own packages, immutable data (return new objects, never mutate in place), files 200–400 lines (800 max), functions < 50 lines, no hardcoded secrets, explicit error handling, schema validation at every boundary.

---

## File Structure

```
package.json                     # root: npm workspaces ["packages/*", "apps/*"]; scripts typecheck/test/dev:api/replay
tsconfig.base.json               # shared compilerOptions (ES2022, bundler, strict, noUncheckedIndexedAccess, noEmit)
.nvmrc                           # 22
.gitignore                       # node_modules, .env, .data/, *.sqlite*
.env.example                     # MODEL_PROVIDER/MODEL/OPENAI_API_KEY/OPENROUTER_API_KEY + FORK_* vars (documented)
fork.projects.json               # allowlisted project configs (server-side; NOT client-supplied paths)
docs/superpowers/plans/2026-09-12-silent-orchestrator.md   # copy of this plan

fixtures/company/                # 3 small synthetic Markdown constraint docs (labeled synthetic)
  brand-guidelines.md
  signup-flow-notes.md
  task-board-constraints.md

packages/contracts/              # @fork/contracts — types + zod runtime validation (B owns shared route/type defs)
  package.json  tsconfig.json
  src/types.ts                   # verbatim copy of contracts.v2.ts
  src/schemas/primitives.ts      # ids, iso time, tokens, Revision, SourceRef, workspace-relative path
  src/schemas/observations.ts    # PreviewElement, Transcript/PreviewContext observation, Observation
  src/schemas/planner.ts         # PreviewPatch, TargetEvidence, PlannerProposal
  src/schemas/engine.ts          # RepoMap, PrototypeJob, WorkerProgress, RenderCheck, PrototypeResult, Prepare*/Patch*
  src/schemas/session.ts         # ExperimentRecord, SessionSnapshot, SessionControl, OutputPayload, SessionEvent
  src/schemas/api.ts             # request bodies + response envelope for every route
  src/schemas/index.ts  src/index.ts
  src/schemas/*.test.ts

packages/state/                  # @fork/state — StateStore repository interface + node:sqlite implementation
  package.json  tsconfig.json
  src/records.ts                 # SessionRecord, StoredObservation, StoredIntent, StoredExperiment, StoredJob, PlanStatus
  src/store.ts                   # StateStore interface
  src/sqlite/ddl.ts              # CREATE TABLE statements
  src/sqlite/rows.ts             # row <-> record mappers (pure)
  src/sqlite/sqlite-store.ts     # SqliteStateStore implements StateStore
  src/sqlite/require-sqlite.ts   # Node version guard + import
  src/index.ts
  src/sqlite/*.test.ts

packages/orchestrator/           # @fork/orchestrator — pipeline
  package.json  tsconfig.json
  src/config.ts                  # OrchestratorConfig + DEFAULT_CONFIG
  src/clock.ts  src/ids.ts  src/errors.ts
  src/events/event-bus.ts        # append to store + fan-out to SSE subscribers
  src/observations/ingest.ts     # epoch/dedupe/partial/supersede handling → IngestReport
  src/observations/transcript-window.ts   # ordering + bounded window (pure)
  src/observations/context-at.ts # pick context snapshot valid at speech time (pure)
  src/observations/settle-window.ts       # per-session debounce
  src/planner/planner.ts         # Planner interface, PlanningContext, PlannerOutput (flat, nullable)
  src/planner/output-schema.ts   # zod schema for model output
  src/planner/to-proposal.ts     # PlannerOutput → PlannerProposal (pure, validated)
  src/planner/context-builder.ts # assemble PlanningContext (pure given inputs)
  src/planner/prompt.ts          # SYSTEM_PROMPT + renderUserPrompt
  src/planner/model.ts           # resolvePlannerModel() mirroring starter env
  src/planner/llm-planner.ts     # LlmPlanner (ai generateText + Output.object), injectable generate fn
  src/retrieval/company-docs.ts  # keyword retrieval over fixtures/company/*.md (no vector index)
  src/retrieval/repo-files.ts    # bounded, allowlisted reads within workspace root
  src/gate/dedupe-key.ts
  src/gate/gate.ts               # runGate(): applies rules in order → GateResult
  src/gate/rules/*.ts            # one rule per file
  src/scheduler/target-key.ts    # pure: targetKey for coalescing
  src/scheduler/describe.ts      # pure: user-facing experiment summaries
  src/scheduler/scheduler.ts     # queue/coalesce/single-writer/cancel/stale results
  src/scheduler/run-patch.ts  src/scheduler/run-job.ts  src/scheduler/run-undo.ts
  src/session/snapshot.ts        # SessionRecord → SessionSnapshot (pure)
  src/session/session-service.ts # create/capture/controls
  src/orchestrator.ts            # createOrchestrator(deps): wires everything; public API
  src/testing/fake-engine.ts     # FIXTURE PrototypeEngine (labeled)
  src/testing/fixture-planner.ts # FIXTURE Planner: replay table keyed by observation id (labeled)
  src/testing/scenario-fixtures.ts        # scenarios.json → observations/preconditions/expectations
  src/index.ts
  src/**/*.test.ts

apps/api/                        # api — Hono HTTP surface for D/A/C
  package.json  tsconfig.json  README.md
  src/env.ts                     # zod-validated env → ApiEnv
  src/projects.ts                # load + validate fork.projects.json
  src/auth.ts                    # bearer token + origin allowlist middleware
  src/errors.ts                  # envelope helpers + error → HTTP mapping
  src/app.ts                     # createApp(deps): Hono with routes mounted
  src/routes/sessions.ts  capture.ts  observations.ts  events.ts  controls.ts  jobs.ts  transcription.ts
  src/transcription/connector.ts # TranscriptionConnector interface + UnconfiguredTranscriptionConnector (503)
  src/server.ts                  # boot: env → store → engine → planner → orchestrator → serve
  src/*.test.ts
  scripts/replay-scenarios.ts    # in-process replay of scenarios.json; --planner=fixture|live
```

## Cross-task Interfaces (canonical names — later tasks must use exactly these)

```ts
// @fork/contracts (Task 1) — all types from contracts.v2.ts re-exported verbatim, plus:
export const observationSchema, plannerProposalSchema, previewPatchSchema, sessionControlSchema,
  sessionEventSchema, outputPayloadSchema, repoMapSchema, prototypeResultSchema, preparedWorkspaceSchema,
  patchResultSchema, workerProgressSchema, experimentRecordSchema, sessionSnapshotSchema;
export const createSessionRequestSchema;        // { projectConfigId: string }
export const captureRequestSchema;              // { action: 'start'|'pause'|'stop'; prototypeAutonomyEnabled?: boolean }
export const observationsBatchSchema;           // { observations: Observation[] } (1..100)
export const transcriptionConnectionRequestSchema; // { sdp?: string }
export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; issues?: Array<{path:string;message:string}> } };
export type IngestReport = { accepted: number; duplicates: string[]; staleEpoch: string[]; ignoredPartials: number };

// @fork/state (Task 2)
export interface StateStore { ... }             // full signature in Task 2
export class SqliteStateStore implements StateStore { constructor(path: string) }
export function openSqliteStore(path: string): SqliteStateStore

// @fork/orchestrator (Tasks 3–10)
export interface Orchestrator {
  createSession(input: { projectConfigId: string }): Promise<{ snapshot: SessionSnapshot; repoMap: RepoMap }>;
  getSnapshot(sessionId: string): SessionSnapshot | null;
  listEvents(sessionId: string, afterSequence: number, limit: number): SessionEvent[];
  subscribe(sessionId: string, listener: (event: SessionEvent) => void): () => void;
  setCapture(sessionId: string, input: CaptureRequest): Promise<SessionSnapshot>;
  ingestObservations(sessionId: string, observations: Observation[]): Promise<IngestReport>;
  applyControl(sessionId: string, control: SessionControl): Promise<SessionSnapshot>;
  getJob(jobId: string): StoredJob | null;
  listIntents(sessionId: string, limit: number): StoredIntent[];   // replay/report only
  flush(sessionId: string): Promise<void>;      // force the settle window + drain scheduler (tests/replay)
  dispose(): void;
  readonly plannerLabel: 'live' | 'fixture';
  readonly engineLabel: 'live' | 'FIXTURE';
}
export function createOrchestrator(deps: OrchestratorDeps): Orchestrator;
export interface OrchestratorDeps { store: StateStore; engine: PrototypeEngine; planner: Planner;
  projects: ProjectConfig[]; config?: Partial<OrchestratorConfig>; clock?: Clock; logger?: Logger; companyDocsDir?: string }
export interface ProjectConfig { id: string; label: string; mode: 'blank_template' | 'existing_repo'; workspaceRoot: string | null }
export interface Planner { readonly label: 'live' | 'fixture'; plan(context: PlanningContext): Promise<PlannerOutput> }
export class OrchestratorError extends Error { code: string; status: number }
export class FakePrototypeEngine implements PrototypeEngine  // label 'FIXTURE'
export class FixturePlanner implements Planner               // label 'fixture'
export class LlmPlanner implements Planner                   // label 'live'
```

---

### Task 0: Workspace scaffold (root mirrors the CopilotKit starter)

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.nvmrc`, `.gitignore`, `.env.example`, `fork.projects.json`
- Create: `docs/superpowers/plans/2026-09-12-silent-orchestrator.md` (copy of this plan)

**Interfaces:**
- Produces: workspace globs `packages/*`, `apps/*`; root scripts `typecheck`, `test`, `test:coverage`, `dev:api`, `replay`.

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "fork-v2",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Fork v2 — silent meeting coworker. Track B (API, contracts, orchestrator, state) lives here; D owns final root integration.",
  "engines": { "node": ">=22.13" },
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "test:coverage": "npm run test:coverage --workspaces --if-present",
    "dev:api": "npm run dev --workspace api",
    "replay": "npm run replay --workspace api --",
    "verify": "npm run typecheck && npm test"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.23.1",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"],
    "allowImportingTsExtensions": false
  }
}
```

- [ ] **Step 3: Create `.nvmrc`, `.gitignore`, `.env.example`, `fork.projects.json`**

`.nvmrc`:
```
22
```

`.gitignore`:
```
node_modules/
.env
.data/
*.sqlite
*.sqlite-journal
*.sqlite-wal
*.sqlite-shm
coverage/
.DS_Store
```

`.env.example` (no real values; mirrors starter names, adds `FORK_*`):
```dotenv
# ── MODEL PROVIDER (same names as the CopilotKit starter) ──────────────────
MODEL_PROVIDER=openai
OPENAI_API_KEY=stub-replace-me
MODEL=gpt-5.6-sol
# OPENROUTER_API_KEY=
# MODEL=openai/gpt-5.6-sol

# ── FORK TRACK B: local control API ────────────────────────────────────────
FORK_API_HOST=127.0.0.1
FORK_API_PORT=8787
# Shared secret for D/A/C local clients. If unset, a random token is generated and printed once at boot.
FORK_API_TOKEN=
# Browser origins allowed to call the API (meeting shell). Comma separated.
FORK_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
# SQLite path (":memory:" for ephemeral). Directory is created if missing.
FORK_DB_PATH=./.data/fork.sqlite
# fixture = labeled replay planner (no model calls). live = real model via MODEL_PROVIDER.
FORK_PLANNER=fixture
# fake = labeled in-memory engine. live = C's adapter (wired by D once available).
FORK_ENGINE=fake
FORK_SETTLE_MS=1200
FORK_PROJECTS_FILE=./fork.projects.json
FORK_COMPANY_DOCS_DIR=./fixtures/company
```

`fork.projects.json` (server-side allowlist; a client may only reference an `id`):
```json
{
  "projects": [
    { "id": "demo-product", "label": "Fixture demo product (synthetic)", "mode": "existing_repo", "workspaceRoot": null },
    { "id": "blank-template", "label": "Blank prepared React/Vite template", "mode": "blank_template", "workspaceRoot": null }
  ]
}
```

- [ ] **Step 4: Copy this plan into the repo**

```bash
mkdir -p docs/superpowers/plans
cp ~/.claude/plans/mighty-riding-hopper.md docs/superpowers/plans/2026-09-12-silent-orchestrator.md
```

- [ ] **Step 5: Verify Node + install**

Run: `node -v && npm install && npm run typecheck && npm test`
Expected: Node ≥ 22.13; `npm install` succeeds; typecheck/test print nothing (no workspaces yet) and exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.base.json .nvmrc .gitignore .env.example fork.projects.json docs/superpowers/plans/2026-09-12-silent-orchestrator.md
git commit -m "chore: scaffold npm workspace for Track B (mirrors starter conventions)"
```

---

### Task 1: `@fork/contracts` — types + runtime Zod validation

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/types.ts` (verbatim copy of `contracts.v2.ts`)
- Create: `packages/contracts/src/schemas/{primitives,observations,planner,engine,session,api,index}.ts`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/schemas/observations.test.ts`, `planner.test.ts`, `api.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: every schema named in "Cross-task Interfaces"; `z.infer` types equal the `types.ts` types (asserted in tests with `satisfies`).

- [ ] **Step 1: Package manifests**

`packages/contracts/package.json`:
```json
{
  "name": "@fork/contracts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Fork v2 shared application interfaces (types + runtime Zod validation). Owned by Track B.",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test 'src/**/*.test.ts'",
    "test:coverage": "node --import tsx --experimental-test-coverage --test-coverage-lines=80 --test 'src/**/*.test.ts'"
  },
  "dependencies": { "zod": "^4.1.0" }
}
```

`packages/contracts/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 2: Copy types verbatim**

```bash
cp contracts.v2.ts packages/contracts/src/types.ts
```
Do not edit `types.ts`; it is the shared contract. All zod schemas below are written so that `z.infer<typeof schema>` is assignable to the matching type (checked with `satisfies` in tests).

- [ ] **Step 3: Write failing schema tests (observations)**

`packages/contracts/src/schemas/observations.test.ts`:
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observationSchema, previewContextObservationSchema, transcriptObservationSchema } from './observations';
import type { PreviewContextObservation, TranscriptObservation } from '../types';

const page: PreviewContextObservation = {
  id: 'ctx-1', sessionId: 'meeting-1', captureEpoch: 'capture-1', version: 1,
  capturedAt: '2026-09-12T15:00:00Z', kind: 'preview_context', workspaceId: 'demo-1',
  revision: { source: 1, config: 0 }, route: '/signup', viewport: { width: 1280, height: 800 },
  focusId: null, hover: null, selection: null,
  elements: [{ id: 'start-trial', role: 'button', label: 'Start trial', section: 'Signup', visible: true,
    box: { x: 440, y: 500, width: 150, height: 40 }, editable: ['size', 'background', 'label', 'radius'] }],
};
const speech: TranscriptObservation = {
  id: 'speech-1', sessionId: 'meeting-1', captureEpoch: 'capture-1', version: 1,
  capturedAt: '2026-09-12T15:00:01Z', kind: 'transcript', phase: 'final',
  providerItemId: 'synthetic-audio-item-1', audioTurnSequence: 1, orderReliable: true,
  streamId: 'room-microphone', speaker: { label: null, verified: false },
  text: 'The Start trial button is too small. What if it were bigger?',
};

test('accepts the contract example page context', () => {
  const parsed = previewContextObservationSchema.parse(page);
  assert.deepEqual(parsed, page);
});

test('accepts the contract example speech turn and discriminates by kind', () => {
  const parsed = observationSchema.parse(speech);
  assert.equal(parsed.kind, 'transcript');
  assert.deepEqual(transcriptObservationSchema.parse(speech), speech);
});

test('rejects a verified speaker flag (contract says verified: false only)', () => {
  const bad = { ...speech, speaker: { label: 'Alice', verified: true } };
  assert.equal(transcriptObservationSchema.safeParse(bad).success, false);
});

test('rejects an element whose source path escapes the workspace', () => {
  const bad = { ...page, elements: [{ ...page.elements[0]!, source: { kind: 'repo', path: '../secrets.env', fingerprint: 'abc' } }] };
  assert.equal(previewContextObservationSchema.safeParse(bad).success, false);
});

test('rejects unknown top-level keys (strict objects)', () => {
  const bad = { ...speech, extra: 'nope' };
  assert.equal(transcriptObservationSchema.safeParse(bad).success, false);
});

test('rejects non-ISO capturedAt', () => {
  const bad = { ...speech, capturedAt: 'yesterday' };
  assert.equal(transcriptObservationSchema.safeParse(bad).success, false);
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npm test --workspace @fork/contracts`
Expected: FAIL — `Cannot find module './observations'`.

- [ ] **Step 5: Implement primitives + observations schemas**

`packages/contracts/src/schemas/primitives.ts`:
```ts
import { z } from 'zod';

export const idSchema = z.string().min(1).max(200);
export const isoTimeSchema = z.iso.datetime({ offset: true });
export const sizeTokenSchema = z.enum(['sm', 'md', 'lg', 'xl']);
export const colorTokenSchema = z.enum(['neutral', 'blue', 'red', 'green', 'amber']);
export const radiusTokenSchema = z.enum(['none', 'sm', 'md', 'pill']);
export const editablePropertySchema = z.enum(['size', 'background', 'label', 'radius', 'visible']);

export const revisionSchema = z.strictObject({
  source: z.number().int().min(0),
  config: z.number().int().min(0),
});

const WINDOWS_DRIVE = /^[a-zA-Z]:/;
export function isWorkspaceRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || WINDOWS_DRIVE.test(path)) return false;
  return !path.split('/').some((segment) => segment === '..');
}

export const workspacePathSchema = z.string().min(1).max(512)
  .refine(isWorkspaceRelativePath, { message: 'path must be workspace-relative with no traversal' });

export const sourceRefSchema = z.strictObject({
  kind: z.enum(['repo', 'document']),
  path: workspacePathSchema,
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  fingerprint: z.string().min(1).max(200),
  excerpt: z.string().max(2000).optional(),
});
```

`packages/contracts/src/schemas/observations.ts`:
```ts
import { z } from 'zod';
import { editablePropertySchema, idSchema, isoTimeSchema, revisionSchema, sourceRefSchema } from './primitives';

export const previewElementSchema = z.strictObject({
  id: idSchema,
  role: z.string().min(1).max(64),
  label: z.string().max(200),
  section: z.string().max(200).optional(),
  visible: z.boolean(),
  box: z.strictObject({ x: z.number(), y: z.number(), width: z.number().min(0), height: z.number().min(0) }),
  editable: z.array(editablePropertySchema).max(5),
  source: sourceRefSchema.optional(),
});

const observationBase = {
  id: idSchema,
  sessionId: idSchema,
  captureEpoch: idSchema,
  capturedAt: isoTimeSchema,
  version: z.number().int().min(1),
};

const pointerSchema = z.strictObject({ elementId: idSchema, at: isoTimeSchema });

export const transcriptObservationSchema = z.strictObject({
  ...observationBase,
  kind: z.literal('transcript'),
  phase: z.enum(['partial', 'final']),
  providerItemId: z.string().min(1).max(200),
  audioTurnSequence: z.number().int().min(0).nullable(),
  orderReliable: z.boolean(),
  streamId: idSchema,
  text: z.string().max(4000),
  supersedesObservationId: idSchema.optional(),
  speaker: z.strictObject({ label: z.string().max(100).nullable(), verified: z.literal(false) }),
});

export const previewContextObservationSchema = z.strictObject({
  ...observationBase,
  kind: z.literal('preview_context'),
  workspaceId: idSchema,
  revision: revisionSchema,
  route: z.string().min(1).max(500),
  viewport: z.strictObject({ width: z.number().min(0), height: z.number().min(0) }),
  elements: z.array(previewElementSchema).max(200),
  focusId: idSchema.nullable(),
  hover: pointerSchema.nullable(),
  selection: pointerSchema.nullable(),
});

export const observationSchema = z.discriminatedUnion('kind', [
  transcriptObservationSchema,
  previewContextObservationSchema,
]);
```

- [ ] **Step 6: Run tests → pass**

Run: `npm test --workspace @fork/contracts`
Expected: 6 passing.

- [ ] **Step 7: Write failing planner/engine/session/api schema tests**

`packages/contracts/src/schemas/planner.test.ts`:
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plannerProposalSchema, previewPatchSchema } from './planner';
import type { PlannerProposal } from '../types';

const base = { id: 'intent-1', sessionId: 'meeting-1', captureEpoch: 'capture-1',
  sourceObservationIds: ['speech-1', 'ctx-1'], expectedRevision: { source: 1, config: 0 } };

test('accepts the contract example preview_patch proposal', () => {
  const proposal: PlannerProposal = { ...base, summary: 'Try a larger Start trial button', kind: 'preview_patch',
    patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' },
    targetEvidence: { contextObservationId: 'ctx-1', elementId: 'start-trial',
      basis: ['explicit_label', 'recent_referent'], explanation: 'The current discussion names the visible Start trial button.' } };
  assert.deepEqual(plannerProposalSchema.parse(proposal), proposal);
});

test('rejects a size value outside the token set', () => {
  assert.equal(previewPatchSchema.safeParse({ kind: 'set_size', elementId: 'x', value: 'huge' }).success, false);
});

test('rejects a clarify proposal with fewer than two candidates', () => {
  const bad = { ...base, summary: 'Which button?', kind: 'clarify', question: 'Which button?', candidates: [{ id: 'a', label: 'A' }] };
  assert.equal(plannerProposalSchema.safeParse(bad).success, false);
});

test('rejects a prototype_change brief over 600 chars', () => {
  const bad = { ...base, summary: 'x', kind: 'prototype_change', brief: 'x'.repeat(601), relevantSources: [], constraints: [], mockedIntegrations: [] };
  assert.equal(plannerProposalSchema.safeParse(bad).success, false);
});

test('accepts observe/hold/undo/pause shapes', () => {
  assert.equal(plannerProposalSchema.safeParse({ ...base, summary: 'x', kind: 'observe', reason: 'off-topic' }).success, true);
  assert.equal(plannerProposalSchema.safeParse({ ...base, summary: 'x', kind: 'hold', reason: 'incomplete' }).success, true);
  assert.equal(plannerProposalSchema.safeParse({ ...base, summary: 'x', kind: 'undo', experimentId: 'exp-1' }).success, true);
  assert.equal(plannerProposalSchema.safeParse({ ...base, summary: 'x', kind: 'pause' }).success, true);
});
```

`packages/contracts/src/schemas/api.test.ts`:
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureRequestSchema, createSessionRequestSchema, observationsBatchSchema, sessionControlSchema } from './api';

test('create session requires projectConfigId only (no client paths)', () => {
  assert.equal(createSessionRequestSchema.safeParse({ projectConfigId: 'demo-product' }).success, true);
  assert.equal(createSessionRequestSchema.safeParse({ projectConfigId: 'demo', workspaceRoot: '/Users/x' }).success, false);
});

test('capture request validates action and optional autonomy flag', () => {
  assert.equal(captureRequestSchema.safeParse({ action: 'start', prototypeAutonomyEnabled: true }).success, true);
  assert.equal(captureRequestSchema.safeParse({ action: 'resume' }).success, false);
});

test('observations batch is bounded 1..100', () => {
  assert.equal(observationsBatchSchema.safeParse({ observations: [] }).success, false);
});

test('session control discriminates by kind', () => {
  assert.equal(sessionControlSchema.safeParse({ kind: 'undo', experimentId: 'exp-1' }).success, true);
  assert.equal(sessionControlSchema.safeParse({ kind: 'clarification_answer', intentId: 'i', candidateId: 'c' }).success, true);
  assert.equal(sessionControlSchema.safeParse({ kind: 'deploy' }).success, false);
});
```

- [ ] **Step 8: Run → fail (modules missing)**

Run: `npm test --workspace @fork/contracts`
Expected: FAIL — `Cannot find module './planner'` / `'./api'`.

- [ ] **Step 9: Implement planner, engine, session, api schemas + index**

`packages/contracts/src/schemas/planner.ts`:
```ts
import { z } from 'zod';
import { colorTokenSchema, idSchema, radiusTokenSchema, revisionSchema, sizeTokenSchema, sourceRefSchema } from './primitives';

export const previewPatchSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('set_size'), elementId: idSchema, value: sizeTokenSchema }),
  z.strictObject({ kind: z.literal('set_background'), elementId: idSchema, value: colorTokenSchema }),
  z.strictObject({ kind: z.literal('set_label'), elementId: idSchema, value: z.string().min(1).max(60) }),
  z.strictObject({ kind: z.literal('set_radius'), elementId: idSchema, value: radiusTokenSchema }),
  z.strictObject({ kind: z.literal('set_visibility'), elementId: idSchema, value: z.boolean() }),
]);

export const targetBasisSchema = z.enum(['explicit_label', 'recent_referent', 'route', 'focus', 'hover', 'selection']);

export const targetEvidenceSchema = z.strictObject({
  contextObservationId: idSchema,
  elementId: idSchema,
  basis: z.array(targetBasisSchema).min(1).max(6),
  explanation: z.string().min(1).max(300),
});

export const candidateSchema = z.strictObject({ id: idSchema, label: z.string().max(200) });

const intentBase = {
  id: idSchema,
  sessionId: idSchema,
  captureEpoch: idSchema,
  sourceObservationIds: z.array(idSchema).min(1).max(20),
  expectedRevision: revisionSchema,
  summary: z.string().min(1).max(200),
};

export const plannerProposalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...intentBase, kind: z.literal('observe'), reason: z.string().max(300) }),
  z.strictObject({ ...intentBase, kind: z.literal('hold'), reason: z.string().max(300) }),
  z.strictObject({ ...intentBase, kind: z.literal('clarify'), question: z.string().min(1).max(200),
    candidates: z.array(candidateSchema).min(2).max(4) }),
  z.strictObject({ ...intentBase, kind: z.literal('preview_patch'), patch: previewPatchSchema, targetEvidence: targetEvidenceSchema }),
  z.strictObject({ ...intentBase, kind: z.literal('prototype_change'), brief: z.string().min(1).max(600),
    relevantSources: z.array(sourceRefSchema).max(8), constraints: z.array(z.string().max(200)).max(8),
    mockedIntegrations: z.array(z.string().max(200)).max(8) }),
  z.strictObject({ ...intentBase, kind: z.literal('undo'), experimentId: idSchema }),
  z.strictObject({ ...intentBase, kind: z.literal('pause') }),
]);
```

`packages/contracts/src/schemas/engine.ts`:
```ts
import { z } from 'zod';
import { idSchema, revisionSchema, sourceRefSchema } from './primitives';
import { previewPatchSchema } from './planner';

export const jobStateSchema = z.enum(['queued', 'running', 'checking', 'ready', 'failed', 'cancelled', 'superseded']);

export const repoMapSchema = z.strictObject({
  workspaceId: idSchema,
  origin: z.enum(['blank_template', 'existing_repo']),
  fingerprint: z.string().min(1).max(200),
  framework: z.strictObject({ name: z.string().max(100), verified: z.boolean() }),
  routes: z.array(z.strictObject({ route: z.string().max(500), sources: z.array(sourceRefSchema).max(20) })).max(100),
  relevantSources: z.array(sourceRefSchema).max(50),
  mockCapabilities: z.array(z.string().max(200)).max(50),
  limitations: z.array(z.string().max(300)).max(50),
});

export const prototypeJobSchema = z.strictObject({
  id: idSchema, experimentId: idSchema, sessionId: idSchema, workspaceId: idSchema, intentId: idSchema,
  expectedRevision: revisionSchema, brief: z.string().min(1).max(600),
  relevantSources: z.array(sourceRefSchema).max(8), constraints: z.array(z.string().max(200)).max(8),
  mockedIntegrations: z.array(z.string().max(200)).max(8),
  mode: z.literal('demo_only'), verification: z.literal('compile_and_render'),
});

export const workerProgressSchema = z.strictObject({ jobId: idSchema, state: jobStateSchema, message: z.string().max(500) });

export const renderCheckSchema = z.strictObject({
  compile: z.enum(['passed', 'failed', 'not_checked']),
  page: z.enum(['rendered', 'failed', 'not_checked']),
  diagnostics: z.array(z.string().max(1000)).max(50),
});

export const prototypeResultSchema = z.strictObject({
  jobId: idSchema, workspaceId: idSchema,
  state: z.enum(['ready', 'failed', 'cancelled', 'superseded']),
  basedOn: revisionSchema, resultingRevision: revisionSchema,
  checkpointId: idSchema.nullable(), previewUrl: z.string().max(500).nullable(),
  changedFiles: z.array(z.string().max(500)).max(200), mockNotes: z.array(z.string().max(300)).max(20),
  check: renderCheckSchema,
});

export const prepareRequestSchema = z.strictObject({ sessionId: idSchema, projectConfigId: idSchema, mode: z.enum(['blank_template', 'existing_repo']) });
export const preparedWorkspaceSchema = z.strictObject({
  workspaceId: idSchema, revision: revisionSchema, repoMap: repoMapSchema,
  previewUrl: z.string().max(500), renderState: z.enum(['starting', 'rendered', 'failed']),
});
export const patchRequestSchema = z.strictObject({ operationId: idSchema, sessionId: idSchema, workspaceId: idSchema, expectedRevision: revisionSchema, patch: previewPatchSchema });
export const patchResultSchema = z.strictObject({ operationId: idSchema, applied: z.boolean(), revision: revisionSchema, checkpointId: idSchema.nullable(), diagnostic: z.string().max(1000).optional() });
```

`packages/contracts/src/schemas/session.ts`:
```ts
import { z } from 'zod';
import { idSchema, isoTimeSchema, revisionSchema } from './primitives';
import { candidateSchema } from './planner';
import { workerProgressSchema } from './engine';

export const experimentRecordSchema = z.strictObject({
  id: idSchema, intentId: idSchema,
  status: z.enum(['proposed', 'applying', 'visible', 'reverted', 'failed', 'superseded']),
  summary: z.string().max(200), origin: z.enum(['inferred_experiment', 'host_control']),
  sourceObservationIds: z.array(idSchema).max(20), revision: revisionSchema,
  checkpointId: idSchema.nullable(), mockNotes: z.array(z.string().max(300)).max(20),
});

export const clarificationSchema = z.strictObject({ intentId: idSchema, question: z.string().max(200), candidates: z.array(candidateSchema).min(2).max(4) });

export const sessionSnapshotSchema = z.strictObject({
  id: idSchema, captureEpoch: idSchema, capture: z.enum(['stopped', 'listening', 'paused']),
  prototypeAutonomyEnabled: z.boolean(), workspaceId: idSchema.nullable(), revision: revisionSchema,
  previewUrl: z.string().max(500).nullable(), currentTopic: z.string().max(200).nullable(),
  lastEventSequence: z.number().int().min(0), experiments: z.array(experimentRecordSchema).max(100),
  clarification: clarificationSchema.nullable(),
});

export const sessionControlSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('pause') }),
  z.strictObject({ kind: z.literal('resume') }),
  z.strictObject({ kind: z.literal('stop') }),
  z.strictObject({ kind: z.literal('undo'), experimentId: idSchema }),
  z.strictObject({ kind: z.literal('cancel_job'), jobId: idSchema }),
  z.strictObject({ kind: z.literal('clarification_answer'), intentId: idSchema, candidateId: idSchema }),
]);

export const outputPayloadSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('snapshot'), snapshot: sessionSnapshotSchema }),
  z.strictObject({ kind: z.literal('experiment'), experiment: experimentRecordSchema }),
  z.strictObject({ kind: z.literal('job'), progress: workerProgressSchema }),
  z.strictObject({ kind: z.literal('status'), message: z.string().max(500) }),
  z.strictObject({ kind: z.literal('clarification'), intentId: idSchema, question: z.string().max(200), candidates: z.array(candidateSchema).min(2).max(4) }),
  z.strictObject({ kind: z.literal('error'), code: z.string().max(100), message: z.string().max(500) }),
]);

export const sessionEventSchema = z.strictObject({ id: idSchema, sessionId: idSchema, sequence: z.number().int().min(1), at: isoTimeSchema, payload: outputPayloadSchema });
```

`packages/contracts/src/schemas/api.ts`:
```ts
import { z } from 'zod';
import { idSchema } from './primitives';
import { observationSchema } from './observations';
// sessionControlSchema lives in ./session (do not re-export it here: two `export *` of the same name is a TS2308 ambiguity error).

export const createSessionRequestSchema = z.strictObject({ projectConfigId: idSchema });
export const captureRequestSchema = z.strictObject({ action: z.enum(['start', 'pause', 'stop']), prototypeAutonomyEnabled: z.boolean().optional() });
export const observationsBatchSchema = z.strictObject({ observations: z.array(observationSchema).min(1).max(100) });
export const transcriptionConnectionRequestSchema = z.strictObject({ sdp: z.string().max(20000).optional() });

export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
export type CaptureRequest = z.infer<typeof captureRequestSchema>;
export type ObservationsBatch = z.infer<typeof observationsBatchSchema>;
export type TranscriptionConnectionRequest = z.infer<typeof transcriptionConnectionRequestSchema>;

export interface ApiIssue { path: string; message: string }
export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; issues?: ApiIssue[] } };
export interface IngestReport { accepted: number; duplicates: string[]; staleEpoch: string[]; ignoredPartials: number }
```

`packages/contracts/src/schemas/index.ts`: `export * from './primitives'; export * from './observations'; export * from './planner'; export * from './engine'; export * from './session'; export * from './api';`

`packages/contracts/src/index.ts`: `export * from './types'; export * from './schemas';`

- [ ] **Step 10: Run tests + typecheck → pass**

Run: `npm test --workspace @fork/contracts && npm run typecheck --workspace @fork/contracts`
Expected: all passing; typecheck clean.

- [ ] **Step 11: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): install v2 interfaces with runtime Zod validation"
```

---

### Task 2: `@fork/state` — StateStore interface + `node:sqlite` implementation

**Files:**
- Create: `packages/state/package.json`, `tsconfig.json`
- Create: `packages/state/src/records.ts`, `src/store.ts`, `src/sqlite/require-sqlite.ts`, `src/sqlite/ddl.ts`, `src/sqlite/rows.ts`, `src/sqlite/sqlite-store.ts`, `src/index.ts`
- Test: `packages/state/src/sqlite/sqlite-store.test.ts`

**Interfaces:**
- Consumes: `@fork/contracts` types.
- Produces: `StateStore`, `SqliteStateStore`, `openSqliteStore(path)`, record types below. Every `update*` returns a **new** record (immutability); nothing returned is a live reference to internal state.

- [ ] **Step 1: Manifests**

`packages/state/package.json`:
```json
{
  "name": "@fork/state",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Fork v2 authoritative session state (node:sqlite). Owned by Track B; A/C/D never write these tables.",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "node --disable-warning=ExperimentalWarning --import tsx --test 'src/**/*.test.ts'",
    "test:coverage": "node --disable-warning=ExperimentalWarning --import tsx --experimental-test-coverage --test-coverage-lines=80 --test 'src/**/*.test.ts'"
  },
  "dependencies": { "@fork/contracts": "*" }
}
```
`tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`

- [ ] **Step 2: Records + interface**

`packages/state/src/records.ts`:
```ts
import type { ExperimentRecord, JobState, Observation, PlannerProposal, PrototypeJob, PrototypeResult, Revision, SessionSnapshot } from '@fork/contracts';

export type CaptureState = SessionSnapshot['capture'];
export type PlanStatus = 'pending' | 'planned' | 'skipped' | 'failed';
export type GateStatus = 'allowed' | 'rejected' | 'superseded';

export interface StoredClarification {
  intentId: string; question: string; candidates: Array<{ id: string; label: string }>;
  route: string; contextObservationId: string; createdAt: string;
}

export interface SessionRecord {
  id: string; projectConfigId: string; captureEpoch: string; capture: CaptureState;
  prototypeAutonomyEnabled: boolean; workspaceId: string | null; revision: Revision;
  previewUrl: string | null; currentTopic: string | null; clarification: StoredClarification | null;
  resumedAt: string | null; createdAt: string; updatedAt: string;
}

export interface StoredObservation {
  observation: Observation; planStatus: PlanStatus; supersededBy: string | null;
  intentId: string | null; receivedSeq: number;
}

export interface StoredIntent {
  proposal: PlannerProposal; gateStatus: GateStatus; gateReason: string | null; dedupeKey: string | null;
  /** For clarify intents: what to apply once a candidate is chosen. */
  pendingPatch: { kind: 'set_size' | 'set_background' | 'set_label' | 'set_radius' | 'set_visibility'; value: string | boolean } | null;
  createdAt: string;
}

export interface StoredExperiment extends ExperimentRecord { sessionId: string; targetKey: string; createdAt: string; updatedAt: string }

export interface StoredJob { job: PrototypeJob; state: JobState; message: string; result: PrototypeResult | null; createdAt: string; updatedAt: string }
```

`packages/state/src/store.ts`:
```ts
import type { Observation, OutputPayload, PreviewContextObservation, RepoMap, SessionEvent, TranscriptObservation } from '@fork/contracts';
import type { PlanStatus, SessionRecord, StoredExperiment, StoredIntent, StoredJob, StoredObservation } from './records';

export interface StateStore {
  // sessions + epochs
  createSession(record: SessionRecord): SessionRecord;
  getSession(id: string): SessionRecord | null;
  updateSession(id: string, patch: Partial<Omit<SessionRecord, 'id' | 'createdAt'>>, updatedAt: string): SessionRecord;
  recordCaptureEpoch(input: { id: string; sessionId: string; startedAt: string }): void;
  endCaptureEpoch(id: string, endedAt: string): void;

  // observations (idempotent by id)
  insertObservation(observation: Observation, receivedAt: string): boolean; // false = duplicate id
  getObservation(id: string): StoredObservation | null;
  markSuperseded(id: string, supersededBy: string): void;
  setPlanStatus(ids: readonly string[], status: PlanStatus, intentId: string | null): void;
  listFinalTranscript(sessionId: string, captureEpoch: string, limit: number): StoredObservation[]; // newest last, by received order
  listPendingTranscript(sessionId: string, captureEpoch: string): StoredObservation[];
  listContext(sessionId: string, captureEpoch: string, limit: number): StoredObservation[];   // newest last

  // repo map
  saveRepoMap(sessionId: string, repoMap: RepoMap): void;
  getRepoMap(sessionId: string): RepoMap | null;

  // intents + dedupe
  insertIntent(sessionId: string, intent: StoredIntent): StoredIntent;
  getIntent(id: string): StoredIntent | null;
  listIntents(sessionId: string, limit: number): StoredIntent[]; // newest last
  updateIntent(id: string, patch: Partial<Pick<StoredIntent, 'gateStatus' | 'gateReason'>>): StoredIntent;
  hasDedupeKey(sessionId: string, key: string): boolean;
  putDedupeKey(sessionId: string, key: string, intentId: string): void;

  // experiments
  insertExperiment(experiment: StoredExperiment): StoredExperiment;
  getExperiment(id: string): StoredExperiment | null;
  updateExperiment(id: string, patch: Partial<Pick<StoredExperiment, 'status' | 'checkpointId' | 'revision' | 'mockNotes' | 'summary'>>, updatedAt: string): StoredExperiment;
  listExperiments(sessionId: string, limit: number): StoredExperiment[]; // newest last

  // jobs
  insertJob(sessionId: string, job: StoredJob): StoredJob;
  getJob(id: string): StoredJob | null;
  updateJob(id: string, patch: Partial<Pick<StoredJob, 'state' | 'message' | 'result'>>, updatedAt: string): StoredJob;

  // ordered events
  appendEvent(sessionId: string, payload: OutputPayload, at: string, id: string): SessionEvent;
  listEventsAfter(sessionId: string, afterSequence: number, limit: number): SessionEvent[];
  lastEventSequence(sessionId: string): number;

  transaction<T>(fn: () => T): T;
  close(): void;
}

export type { TranscriptObservation, PreviewContextObservation };
```

- [ ] **Step 3: Write failing store tests**

`packages/state/src/sqlite/sqlite-store.test.ts`:
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TranscriptObservation } from '@fork/contracts';
import { openSqliteStore } from './sqlite-store';
import type { SessionRecord } from '../records';

const T0 = '2026-09-12T15:00:00.000Z';
const session: SessionRecord = {
  id: 'ses-1', projectConfigId: 'demo-product', captureEpoch: 'cap-1', capture: 'stopped',
  prototypeAutonomyEnabled: false, workspaceId: null, revision: { source: 0, config: 0 },
  previewUrl: null, currentTopic: null, clarification: null, resumedAt: null, createdAt: T0, updatedAt: T0,
};
const turn = (id: string, seq: number, extra: Partial<TranscriptObservation> = {}): TranscriptObservation => ({
  id, sessionId: 'ses-1', captureEpoch: 'cap-1', capturedAt: T0, version: 1, kind: 'transcript', phase: 'final',
  providerItemId: `p-${id}`, audioTurnSequence: seq, orderReliable: true, streamId: 'mic', text: `turn ${id}`,
  speaker: { label: null, verified: false }, ...extra,
});

test('session round-trip and immutable update', () => {
  const store = openSqliteStore(':memory:');
  const created = store.createSession(session);
  const updated = store.updateSession('ses-1', { capture: 'listening', revision: { source: 1, config: 0 } }, '2026-09-12T15:00:01.000Z');
  assert.equal(created.capture, 'stopped');          // original object untouched
  assert.equal(updated.capture, 'listening');
  assert.deepEqual(store.getSession('ses-1')?.revision, { source: 1, config: 0 });
  assert.notEqual(created, updated);
  store.close();
});

test('observation ids are idempotent', () => {
  const store = openSqliteStore(':memory:');
  store.createSession(session);
  assert.equal(store.insertObservation(turn('t1', 1), T0), true);
  assert.equal(store.insertObservation(turn('t1', 1), T0), false);
  assert.equal(store.listFinalTranscript('ses-1', 'cap-1', 10).length, 1);
  store.close();
});

test('supersede + plan status bookkeeping', () => {
  const store = openSqliteStore(':memory:');
  store.createSession(session);
  store.insertObservation(turn('t1', 1), T0);
  store.insertObservation(turn('t2', 1, { supersedesObservationId: 't1', version: 2 }), T0);
  store.markSuperseded('t1', 't2');
  assert.equal(store.getObservation('t1')?.supersededBy, 't2');
  assert.deepEqual(store.listPendingTranscript('ses-1', 'cap-1').map((o) => o.observation.id), ['t2']);
  store.setPlanStatus(['t2'], 'planned', 'int-1');
  assert.equal(store.listPendingTranscript('ses-1', 'cap-1').length, 0);
  assert.equal(store.getObservation('t2')?.intentId, 'int-1');
  store.close();
});

test('epoch scoping: observations from another epoch are not listed', () => {
  const store = openSqliteStore(':memory:');
  store.createSession(session);
  store.insertObservation(turn('old', 1, { captureEpoch: 'cap-0' }), T0);
  store.insertObservation(turn('new', 1), T0);
  assert.deepEqual(store.listPendingTranscript('ses-1', 'cap-1').map((o) => o.observation.id), ['new']);
  store.close();
});

test('events get a monotonic per-session sequence and replay after a cursor', () => {
  const store = openSqliteStore(':memory:');
  store.createSession(session);
  const e1 = store.appendEvent('ses-1', { kind: 'status', message: 'a' }, T0, 'evt-1');
  const e2 = store.appendEvent('ses-1', { kind: 'status', message: 'b' }, T0, 'evt-2');
  assert.equal(e1.sequence, 1); assert.equal(e2.sequence, 2);
  assert.deepEqual(store.listEventsAfter('ses-1', 1, 10).map((e) => e.id), ['evt-2']);
  assert.equal(store.lastEventSequence('ses-1'), 2);
  store.close();
});

test('dedupe keys are per session', () => {
  const store = openSqliteStore(':memory:');
  store.createSession(session);
  store.putDedupeKey('ses-1', 'k', 'int-1');
  assert.equal(store.hasDedupeKey('ses-1', 'k'), true);
  assert.equal(store.hasDedupeKey('ses-2', 'k'), false);
  store.close();
});

test('transaction rolls back on throw', () => {
  const store = openSqliteStore(':memory:');
  assert.throws(() => store.transaction(() => { store.createSession(session); throw new Error('boom'); }), /boom/);
  assert.equal(store.getSession('ses-1'), null);
  store.close();
});
```

- [ ] **Step 4: Run → fail**

Run: `npm test --workspace @fork/state`
Expected: FAIL — `Cannot find module './sqlite-store'`.

- [ ] **Step 5: Implement**

`packages/state/src/sqlite/require-sqlite.ts`:
```ts
import { DatabaseSync } from 'node:sqlite';

const MIN = { major: 22, minor: 13 };

export function assertSqliteSupported(version: string = process.version): void {
  const [major = 0, minor = 0] = version.replace(/^v/, '').split('.').map(Number);
  const ok = major > MIN.major || (major === MIN.major && minor >= MIN.minor);
  if (!ok) throw new Error(`node:sqlite requires Node >= ${MIN.major}.${MIN.minor}; running ${version}. Use nvm/fnm to switch.`);
}

export function openDatabase(path: string): DatabaseSync {
  assertSqliteSupported();
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return db;
}
```

`packages/state/src/sqlite/ddl.ts`:
```ts
export const DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, project_config_id TEXT NOT NULL, capture_epoch TEXT NOT NULL, capture TEXT NOT NULL,
  autonomy INTEGER NOT NULL, workspace_id TEXT, revision_source INTEGER NOT NULL, revision_config INTEGER NOT NULL,
  preview_url TEXT, current_topic TEXT, clarification_json TEXT, resumed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS capture_epochs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT);
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, capture_epoch TEXT NOT NULL, kind TEXT NOT NULL, phase TEXT,
  captured_at TEXT NOT NULL, received_at TEXT NOT NULL, received_seq INTEGER NOT NULL,
  plan_status TEXT NOT NULL DEFAULT 'pending', superseded_by TEXT, intent_id TEXT, payload_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS observations_session_idx ON observations(session_id, capture_epoch, kind, received_seq);
CREATE TABLE IF NOT EXISTS repo_maps (session_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS intents (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, kind TEXT NOT NULL, gate_status TEXT NOT NULL,
  gate_reason TEXT, dedupe_key TEXT, pending_patch_json TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dedupe_keys (session_id TEXT NOT NULL, key TEXT NOT NULL, intent_id TEXT NOT NULL, PRIMARY KEY (session_id, key));
CREATE TABLE IF NOT EXISTS experiments (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, intent_id TEXT NOT NULL, status TEXT NOT NULL,
  summary TEXT NOT NULL, origin TEXT NOT NULL, source_ids_json TEXT NOT NULL, revision_source INTEGER NOT NULL, revision_config INTEGER NOT NULL,
  checkpoint_id TEXT, mock_notes_json TEXT NOT NULL, target_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS experiments_session_idx ON experiments(session_id, created_at);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, state TEXT NOT NULL, message TEXT NOT NULL,
  payload_json TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, sequence INTEGER NOT NULL, at TEXT NOT NULL,
  payload_json TEXT NOT NULL, UNIQUE (session_id, sequence));
`;
```

`packages/state/src/sqlite/rows.ts` (pure mappers; keep each < 30 lines):
```ts
import type { SessionRecord, StoredExperiment, StoredIntent, StoredJob, StoredObservation } from '../records';
import type { Observation, SessionEvent } from '@fork/contracts';

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const json = <T>(v: unknown): T | null => (typeof v === 'string' ? (JSON.parse(v) as T) : null);

export function rowToSession(row: Row): SessionRecord {
  return {
    id: String(row.id), projectConfigId: String(row.project_config_id), captureEpoch: String(row.capture_epoch),
    capture: String(row.capture) as SessionRecord['capture'], prototypeAutonomyEnabled: num(row.autonomy) === 1,
    workspaceId: str(row.workspace_id), revision: { source: num(row.revision_source), config: num(row.revision_config) },
    previewUrl: str(row.preview_url), currentTopic: str(row.current_topic),
    clarification: json<SessionRecord['clarification']>(row.clarification_json), resumedAt: str(row.resumed_at),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function sessionToParams(s: SessionRecord): Record<string, string | number | null> {
  return {
    id: s.id, project_config_id: s.projectConfigId, capture_epoch: s.captureEpoch, capture: s.capture,
    autonomy: s.prototypeAutonomyEnabled ? 1 : 0, workspace_id: s.workspaceId,
    revision_source: s.revision.source, revision_config: s.revision.config, preview_url: s.previewUrl,
    current_topic: s.currentTopic, clarification_json: s.clarification ? JSON.stringify(s.clarification) : null,
    resumed_at: s.resumedAt, created_at: s.createdAt, updated_at: s.updatedAt,
  };
}

export function rowToObservation(row: Row): StoredObservation {
  return {
    observation: json<Observation>(row.payload_json) as Observation,
    planStatus: String(row.plan_status) as StoredObservation['planStatus'],
    supersededBy: str(row.superseded_by), intentId: str(row.intent_id), receivedSeq: num(row.received_seq),
  };
}

export function rowToIntent(row: Row): StoredIntent {
  return {
    proposal: json(row.payload_json) as StoredIntent['proposal'], gateStatus: String(row.gate_status) as StoredIntent['gateStatus'],
    gateReason: str(row.gate_reason), dedupeKey: str(row.dedupe_key),
    pendingPatch: json<StoredIntent['pendingPatch']>(row.pending_patch_json), createdAt: String(row.created_at),
  };
}

export function rowToExperiment(row: Row): StoredExperiment {
  return {
    id: String(row.id), sessionId: String(row.session_id), intentId: String(row.intent_id),
    status: String(row.status) as StoredExperiment['status'], summary: String(row.summary),
    origin: String(row.origin) as StoredExperiment['origin'], sourceObservationIds: json<string[]>(row.source_ids_json) ?? [],
    revision: { source: num(row.revision_source), config: num(row.revision_config) }, checkpointId: str(row.checkpoint_id),
    mockNotes: json<string[]>(row.mock_notes_json) ?? [], targetKey: String(row.target_key),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function rowToJob(row: Row): StoredJob {
  return {
    job: json(row.payload_json) as StoredJob['job'], state: String(row.state) as StoredJob['state'], message: String(row.message),
    result: json<StoredJob['result']>(row.result_json), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function rowToEvent(row: Row): SessionEvent {
  return { id: String(row.id), sessionId: String(row.session_id), sequence: num(row.sequence), at: String(row.at),
    payload: json(row.payload_json) as SessionEvent['payload'] };
}
```

`packages/state/src/sqlite/sqlite-store.ts` — implement `StateStore` with prepared statements. Key implementation rules:
- `node:sqlite` binding rules: use `@name` placeholders in SQL and pass a plain object with bare keys (bare named parameters are enabled by default); never pass `undefined` (it cannot be bound — use `null`); booleans are stored as 0/1.
- `createSession`: INSERT via `sessionToParams` with named params (`@id`, …); return `rowToSession(select)`.
- `updateSession`: read current → build `next = { ...current, ...patch, updatedAt }` → UPDATE all columns from `sessionToParams(next)` → return `next`. (No in-place mutation; caller's objects untouched.)
- `insertObservation`: `INSERT OR IGNORE`; `received_seq` = `(SELECT COALESCE(MAX(received_seq),0)+1 FROM observations WHERE session_id=@sid)`; `phase` = transcript phase or null; return `changes === 1`.
- `listFinalTranscript`: `WHERE session_id=? AND capture_epoch=? AND kind='transcript' AND phase='final' AND superseded_by IS NULL ORDER BY received_seq DESC LIMIT ?` then reverse (newest last).
- `listPendingTranscript`: same filter plus `plan_status='pending'`, `ORDER BY received_seq ASC`.
- `listContext`: `kind='preview_context'`, newest last, limit.
- `setPlanStatus`: one UPDATE per id inside `transaction`.
- `appendEvent`: inside `transaction`: `sequence = lastEventSequence + 1`, INSERT, return event.
- `transaction`: `exec('BEGIN')` → fn → `COMMIT`; on throw `ROLLBACK` then rethrow. Nested calls: track `depth`; only outermost issues BEGIN/COMMIT.
- `updateIntent` / `updateExperiment` / `updateJob`: read → merge → write → return merged.
- `close()`: `db.close()`.
Export `export function openSqliteStore(path: string): SqliteStateStore { const store = new SqliteStateStore(openDatabase(path)); store.migrate(); return store; }` where `migrate()` runs `DDL`. Ensure the directory for a file path exists (`mkdirSync(dirname(path), { recursive: true })` when `path !== ':memory:'`).

`packages/state/src/index.ts`: `export * from './records'; export * from './store'; export { SqliteStateStore, openSqliteStore } from './sqlite/sqlite-store';`

- [ ] **Step 6: Run → pass; typecheck**

Run: `npm test --workspace @fork/state && npm run typecheck --workspace @fork/state`
Expected: 7 passing, typecheck clean. If `@types/node` lacks `node:sqlite` typings, bump `@types/node` to `^22.13.0` at root.

- [ ] **Step 7: Commit**

```bash
git add packages/state
git commit -m "feat(state): add StateStore repository with node:sqlite implementation"
```

---

### Task 3: Orchestrator core — config, clock, ids, errors, event bus

**Files:**
- Create: `packages/orchestrator/package.json`, `tsconfig.json`
- Create: `packages/orchestrator/src/config.ts`, `src/clock.ts`, `src/ids.ts`, `src/errors.ts`, `src/logger.ts`, `src/events/event-bus.ts`
- Test: `packages/orchestrator/src/events/event-bus.test.ts`, `src/config.test.ts`

**Interfaces:**
- Produces: `OrchestratorConfig`, `DEFAULT_CONFIG`, `resolveConfig(partial)`, `Clock`, `systemClock`, `newId(prefix)`, `OrchestratorError`, `Logger`, `EventBus` (`publish(sessionId, payload): SessionEvent`, `subscribe(sessionId, fn): () => void`).

- [ ] **Step 1: Manifest**

`packages/orchestrator/package.json`:
```json
{
  "name": "@fork/orchestrator",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Fork v2 contextual planner, deterministic gate, and single-writer scheduler. Owned by Track B.",
  "exports": { ".": "./src/index.ts", "./testing": "./src/testing/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "node --disable-warning=ExperimentalWarning --import tsx --test 'src/**/*.test.ts'",
    "test:coverage": "node --disable-warning=ExperimentalWarning --import tsx --experimental-test-coverage --test-coverage-lines=80 --test 'src/**/*.test.ts'"
  },
  "dependencies": {
    "@fork/contracts": "*",
    "@fork/state": "*",
    "@ai-sdk/openai": "^3.0.36",
    "ai": "^6.0.0",
    "zod": "^4.1.0"
  }
}
```
`tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`

- [ ] **Step 2: Failing tests**

`packages/orchestrator/src/config.test.ts`:
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG, resolveConfig } from './config';

test('resolveConfig merges partial over defaults and rejects nonsense', () => {
  assert.equal(resolveConfig({ settleMs: 50 }).settleMs, 50);
  assert.equal(resolveConfig({}).transcriptWindowTurns, DEFAULT_CONFIG.transcriptWindowTurns);
  assert.throws(() => resolveConfig({ settleMs: -1 }), /settleMs/);
});
```

`packages/orchestrator/src/events/event-bus.test.ts`:
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openSqliteStore } from '@fork/state';
import { EventBus } from './event-bus';
import { fixedClock } from '../clock';

test('publish persists with sequence and fans out to session subscribers only', () => {
  const store = openSqliteStore(':memory:');
  const bus = new EventBus(store, fixedClock('2026-09-12T15:00:00.000Z'));
  const seen: number[] = [];
  const off = bus.subscribe('s1', (e) => { seen.push(e.sequence); });
  bus.subscribe('s2', () => { throw new Error('wrong session'); });
  const e = bus.publish('s1', { kind: 'status', message: 'hi' });
  assert.equal(e.sequence, 1);
  assert.deepEqual(seen, [1]);
  off();
  bus.publish('s1', { kind: 'status', message: 'again' });
  assert.deepEqual(seen, [1]);
  assert.equal(store.lastEventSequence('s1'), 2);
  store.close();
});

test('a throwing subscriber does not break other subscribers', () => {
  const store = openSqliteStore(':memory:');
  const bus = new EventBus(store, fixedClock('2026-09-12T15:00:00.000Z'));
  let ok = 0;
  bus.subscribe('s1', () => { throw new Error('bad listener'); });
  bus.subscribe('s1', () => { ok += 1; });
  bus.publish('s1', { kind: 'status', message: 'x' });
  assert.equal(ok, 1);
  store.close();
});
```

- [ ] **Step 3: Run → fail**

Run: `npm test --workspace @fork/orchestrator`
Expected: FAIL — modules missing.

- [ ] **Step 4: Implement**

`src/config.ts`:
```ts
import { z } from 'zod';

export const configSchema = z.strictObject({
  settleMs: z.number().int().min(0).max(10000),
  transcriptWindowTurns: z.number().int().min(1).max(50),
  contextLookbackMs: z.number().int().min(0).max(60000),
  maxBriefChars: z.number().int().min(1).max(600),
  maxLabelChars: z.number().int().min(1).max(60),
  maxRelevantSources: z.number().int().min(0).max(8),
  maxCompanyExcerpts: z.number().int().min(0).max(5),
  maxRepoFileLines: z.number().int().min(1).max(400),
  snapshotExperiments: z.number().int().min(1).max(100),
  allowedOperations: z.array(z.enum(['preview_patch', 'prototype_change', 'undo', 'pause', 'clarify'])),
  stopBehavior: z.enum(['cancel', 'drain']),
});
export type OrchestratorConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: OrchestratorConfig = {
  settleMs: 1200, transcriptWindowTurns: 12, contextLookbackMs: 15000, maxBriefChars: 600, maxLabelChars: 60,
  maxRelevantSources: 8, maxCompanyExcerpts: 2, maxRepoFileLines: 120, snapshotExperiments: 20,
  allowedOperations: ['preview_patch', 'prototype_change', 'undo', 'pause', 'clarify'], stopBehavior: 'cancel',
};

export function resolveConfig(partial: Partial<OrchestratorConfig>): OrchestratorConfig {
  const result = configSchema.safeParse({ ...DEFAULT_CONFIG, ...partial });
  if (!result.success) throw new Error(`Invalid orchestrator config: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return result.data;
}
```

`src/clock.ts`:
```ts
export interface Clock { now(): Date; nowIso(): string }
export const systemClock: Clock = { now: () => new Date(), nowIso: () => new Date().toISOString() };
export function fixedClock(iso: string): Clock { return { now: () => new Date(iso), nowIso: () => iso }; }
/** Test helper: a clock that advances by `stepMs` on each call. */
export function steppingClock(startIso: string, stepMs = 1000): Clock {
  let t = new Date(startIso).getTime();
  return { now: () => new Date((t += stepMs)), nowIso: () => new Date((t += stepMs)).toISOString() };
}
```

`src/ids.ts`:
```ts
import { randomUUID } from 'node:crypto';
export type IdPrefix = 'ses' | 'cap' | 'int' | 'exp' | 'job' | 'evt' | 'op' | 'ws';
export const newId = (prefix: IdPrefix): string => `${prefix}_${randomUUID()}`;
```

`src/errors.ts`:
```ts
export type OrchestratorErrorCode = 'session_not_found' | 'project_not_allowed' | 'invalid_state' | 'clarification_mismatch'
  | 'experiment_not_found' | 'job_not_found' | 'engine_failed' | 'planner_failed' | 'validation_failed';
const STATUS: Record<OrchestratorErrorCode, number> = { session_not_found: 404, project_not_allowed: 403, invalid_state: 409,
  clarification_mismatch: 409, experiment_not_found: 404, job_not_found: 404, engine_failed: 502, planner_failed: 502, validation_failed: 400 };
export class OrchestratorError extends Error {
  readonly status: number;
  constructor(readonly code: OrchestratorErrorCode, message: string) { super(message); this.name = 'OrchestratorError'; this.status = STATUS[code]; }
}
```

`src/logger.ts`:
```ts
export interface Logger { info(msg: string, meta?: Record<string, unknown>): void; warn(msg: string, meta?: Record<string, unknown>): void; error(msg: string, meta?: Record<string, unknown>): void }
export const consoleLogger: Logger = {
  info: (m, meta) => console.log(JSON.stringify({ level: 'info', m, ...meta })),
  warn: (m, meta) => console.warn(JSON.stringify({ level: 'warn', m, ...meta })),
  error: (m, meta) => console.error(JSON.stringify({ level: 'error', m, ...meta })),
};
export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
```

`src/events/event-bus.ts`:
```ts
import type { OutputPayload, SessionEvent } from '@fork/contracts';
import type { StateStore } from '@fork/state';
import type { Clock } from '../clock';
import { newId } from '../ids';
import type { Logger } from '../logger';
import { silentLogger } from '../logger';

type Listener = (event: SessionEvent) => void;

export class EventBus {
  private listeners: ReadonlyMap<string, ReadonlySet<Listener>> = new Map();
  constructor(private readonly store: StateStore, private readonly clock: Clock, private readonly logger: Logger = silentLogger) {}

  publish(sessionId: string, payload: OutputPayload): SessionEvent {
    const event = this.store.appendEvent(sessionId, payload, this.clock.nowIso(), newId('evt'));
    for (const listener of this.listeners.get(sessionId) ?? []) {
      try { listener(event); } catch (error) { this.logger.warn('event listener failed', { sessionId, error: String(error) }); }
    }
    return event;
  }

  subscribe(sessionId: string, listener: Listener): () => void {
    const current = this.listeners.get(sessionId) ?? new Set<Listener>();
    this.listeners = new Map(this.listeners).set(sessionId, new Set([...current, listener]));
    return () => {
      const remaining = new Set([...(this.listeners.get(sessionId) ?? [])].filter((l) => l !== listener));
      this.listeners = new Map(this.listeners).set(sessionId, remaining);
    };
  }
}
```

- [ ] **Step 5: Run → pass; typecheck; commit**

Run: `npm test --workspace @fork/orchestrator && npm run typecheck --workspace @fork/orchestrator`
Expected: 3 passing.

```bash
git add packages/orchestrator
git commit -m "feat(orchestrator): add config, clock, ids, errors, and persisted event bus"
```

---

### Task 4: Observation pipeline — ordering, context-at, settle window, ingest

**Files:**
- Create: `packages/orchestrator/src/observations/transcript-window.ts`, `context-at.ts`, `settle-window.ts`, `ingest.ts`
- Test: one `*.test.ts` beside each

**Interfaces:**
- Consumes: `StateStore`, `SessionRecord`, `Clock`, `OrchestratorConfig`.
- Produces:
  - `orderTurns(turns: StoredObservation[]): StoredObservation[]` (pure; by `audioTurnSequence` when all `orderReliable`, else by `receivedSeq`)
  - `selectContextAt(contexts: StoredObservation[], speechAt: string, lookbackMs: number): StoredObservation | null` (pure)
  - `class SettleWindow { touch(sessionId): void; flush(sessionId): Promise<void>; cancel(sessionId): void; dispose(): void }`
  - `ingestBatch(deps, session, observations): IngestReport` (sync, store-only; caller triggers settle)

- [ ] **Step 1: Failing tests**

`transcript-window.test.ts`:
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orderTurns } from './transcript-window';
import type { StoredObservation } from '@fork/state';
import type { TranscriptObservation } from '@fork/contracts';

const t = (id: string, seq: number | null, receivedSeq: number, orderReliable = true): StoredObservation => ({
  observation: { id, sessionId: 's', captureEpoch: 'c', capturedAt: '2026-09-12T15:00:00.000Z', version: 1, kind: 'transcript',
    phase: 'final', providerItemId: id, audioTurnSequence: seq, orderReliable, streamId: 'mic', text: id,
    speaker: { label: null, verified: false } } satisfies TranscriptObservation,
  planStatus: 'pending', supersededBy: null, intentId: null, receivedSeq,
});

test('orders by audio turn sequence when every turn is reliable, regardless of arrival', () => {
  assert.deepEqual(orderTurns([t('b', 2, 1), t('a', 1, 2)]).map((o) => o.observation.id), ['a', 'b']);
});

test('falls back to arrival order when any turn is unreliable', () => {
  assert.deepEqual(orderTurns([t('b', 2, 1), t('a', 1, 2, false)]).map((o) => o.observation.id), ['b', 'a']);
});
```

`context-at.test.ts`:
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectContextAt } from './context-at';
import type { StoredObservation } from '@fork/state';

const ctx = (id: string, capturedAt: string, receivedSeq: number): StoredObservation => ({
  observation: { id, sessionId: 's', captureEpoch: 'c', capturedAt, version: 1, kind: 'preview_context', workspaceId: 'w',
    revision: { source: 1, config: 0 }, route: '/signup', viewport: { width: 1, height: 1 }, elements: [], focusId: null, hover: null, selection: null },
  planStatus: 'planned', supersededBy: null, intentId: null, receivedSeq,
});

test('picks the newest context captured at or before the speech', () => {
  const picked = selectContextAt([ctx('c1', '2026-09-12T15:00:00.000Z', 1), ctx('c2', '2026-09-12T15:00:05.000Z', 2), ctx('c3', '2026-09-12T15:00:09.000Z', 3)], '2026-09-12T15:00:06.000Z', 15000);
  assert.equal(picked?.observation.id, 'c2');
});

test('falls back to the first context after the speech within lookback, else null', () => {
  assert.equal(selectContextAt([ctx('c3', '2026-09-12T15:00:09.000Z', 1)], '2026-09-12T15:00:06.000Z', 15000)?.observation.id, 'c3');
  assert.equal(selectContextAt([ctx('c3', '2026-09-12T15:01:09.000Z', 1)], '2026-09-12T15:00:06.000Z', 15000), null);
});
```

`settle-window.test.ts`:
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SettleWindow } from './settle-window';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('coalesces touches into one settle call after the window', async () => {
  const calls: string[] = [];
  const w = new SettleWindow(10, async (id) => { calls.push(id); });
  w.touch('s1'); w.touch('s1'); w.touch('s1');
  await tick(30);
  assert.deepEqual(calls, ['s1']);
  w.dispose();
});

test('flush runs immediately and cancels the pending timer', async () => {
  const calls: string[] = [];
  const w = new SettleWindow(50, async (id) => { calls.push(id); });
  w.touch('s1');
  await w.flush('s1');
  await tick(70);
  assert.deepEqual(calls, ['s1']);
  w.dispose();
});

test('settle errors are reported, not thrown from the timer', async () => {
  const errors: string[] = [];
  const w = new SettleWindow(5, async () => { throw new Error('boom'); }, (e) => errors.push(String(e)));
  w.touch('s1');
  await tick(20);
  assert.match(errors[0] ?? '', /boom/);
  w.dispose();
});
```

`ingest.test.ts`:
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openSqliteStore } from '@fork/state';
import type { SessionRecord } from '@fork/state';
import type { TranscriptObservation } from '@fork/contracts';
import { fixedClock } from '../clock';
import { ingestBatch } from './ingest';

const T0 = '2026-09-12T15:00:00.000Z';
const session: SessionRecord = { id: 's', projectConfigId: 'p', captureEpoch: 'cap-2', capture: 'listening', prototypeAutonomyEnabled: true,
  workspaceId: 'w', revision: { source: 1, config: 0 }, previewUrl: null, currentTopic: null, clarification: null, resumedAt: null, createdAt: T0, updatedAt: T0 };
const turn = (id: string, extra: Partial<TranscriptObservation> = {}): TranscriptObservation => ({ id, sessionId: 's', captureEpoch: 'cap-2', capturedAt: T0,
  version: 1, kind: 'transcript', phase: 'final', providerItemId: id, audioTurnSequence: 1, orderReliable: true, streamId: 'mic', text: 'hi', speaker: { label: null, verified: false }, ...extra });

test('reports duplicates, stale epochs, and ignored partials; stores finals', () => {
  const store = openSqliteStore(':memory:');
  store.createSession(session);
  const report = ingestBatch({ store, clock: fixedClock(T0) }, session, [
    turn('a'), turn('a'), turn('old', { captureEpoch: 'cap-1' }), turn('p', { phase: 'partial' }),
  ]);
  assert.deepEqual(report, { accepted: 1, duplicates: ['a'], staleEpoch: ['old'], ignoredPartials: 1 });
  assert.equal(store.listPendingTranscript('s', 'cap-2').length, 1);
  store.close();
});

test('a corrected final supersedes its prior segment', () => {
  const store = openSqliteStore(':memory:');
  store.createSession(session);
  ingestBatch({ store, clock: fixedClock(T0) }, session, [turn('a')]);
  ingestBatch({ store, clock: fixedClock(T0) }, session, [turn('a2', { supersedesObservationId: 'a', version: 2 })]);
  assert.deepEqual(store.listPendingTranscript('s', 'cap-2').map((o) => o.observation.id), ['a2']);
  store.close();
});

test('turns captured before resumedAt are skipped, not planned (no replay after Pause/Resume)', () => {
  const store = openSqliteStore(':memory:');
  const resumed = { ...session, resumedAt: '2026-09-12T15:00:10.000Z' };
  store.createSession(resumed);
  ingestBatch({ store, clock: fixedClock(T0) }, resumed, [turn('stale', { capturedAt: '2026-09-12T15:00:05.000Z' }), turn('fresh', { capturedAt: '2026-09-12T15:00:12.000Z' })]);
  assert.deepEqual(store.listPendingTranscript('s', 'cap-2').map((o) => o.observation.id), ['fresh']);
  assert.equal(store.getObservation('stale')?.planStatus, 'skipped');
  store.close();
});

test('while paused, finals are stored but immediately skipped', () => {
  const store = openSqliteStore(':memory:');
  const paused = { ...session, capture: 'paused' as const };
  store.createSession(paused);
  ingestBatch({ store, clock: fixedClock(T0) }, paused, [turn('a')]);
  assert.equal(store.getObservation('a')?.planStatus, 'skipped');
  store.close();
});
```

- [ ] **Step 2: Run → fail**

Run: `npm test --workspace @fork/orchestrator`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`transcript-window.ts`:
```ts
import type { StoredObservation } from '@fork/state';

const seqOf = (o: StoredObservation): number =>
  o.observation.kind === 'transcript' && o.observation.audioTurnSequence !== null ? o.observation.audioTurnSequence : Number.MAX_SAFE_INTEGER;

const reliable = (o: StoredObservation): boolean =>
  o.observation.kind === 'transcript' && o.observation.orderReliable && o.observation.audioTurnSequence !== null;

/** Audio order when every turn is reliable; otherwise network arrival order. Never invents a sequence. */
export function orderTurns(turns: readonly StoredObservation[]): StoredObservation[] {
  const byAudio = turns.length > 0 && turns.every(reliable);
  return [...turns].sort((a, b) => (byAudio ? seqOf(a) - seqOf(b) : a.receivedSeq - b.receivedSeq));
}

export function lastTurns(turns: readonly StoredObservation[], limit: number): StoredObservation[] {
  return turns.slice(Math.max(0, turns.length - limit));
}
```

`context-at.ts`:
```ts
import type { StoredObservation } from '@fork/state';

const ms = (iso: string): number => new Date(iso).getTime();

/** The preview snapshot that was valid when the speech occurred — not whatever is newest now. */
export function selectContextAt(contexts: readonly StoredObservation[], speechAt: string, lookbackMs: number): StoredObservation | null {
  const at = ms(speechAt);
  const before = contexts.filter((c) => ms(c.observation.capturedAt) <= at);
  if (before.length > 0) return before.reduce((latest, c) => (ms(c.observation.capturedAt) >= ms(latest.observation.capturedAt) ? c : latest));
  const soonAfter = contexts.filter((c) => ms(c.observation.capturedAt) - at <= lookbackMs);
  return soonAfter.length > 0 ? soonAfter.reduce((earliest, c) => (ms(c.observation.capturedAt) < ms(earliest.observation.capturedAt) ? c : earliest)) : null;
}
```

`settle-window.ts`:
```ts
type Settle = (sessionId: string) => Promise<void>;
type OnError = (error: unknown, sessionId: string) => void;

export class SettleWindow {
  private timers: ReadonlyMap<string, NodeJS.Timeout> = new Map();
  constructor(private readonly settleMs: number, private readonly settle: Settle, private readonly onError: OnError = () => {}) {}

  touch(sessionId: string): void {
    this.cancel(sessionId);
    const timer = setTimeout(() => { this.timers = without(this.timers, sessionId); void this.run(sessionId); }, this.settleMs);
    timer.unref?.();
    this.timers = new Map(this.timers).set(sessionId, timer);
  }

  async flush(sessionId: string): Promise<void> { this.cancel(sessionId); await this.run(sessionId); }

  cancel(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer) { clearTimeout(timer); this.timers = without(this.timers, sessionId); }
  }

  dispose(): void { for (const id of this.timers.keys()) this.cancel(id); }

  private async run(sessionId: string): Promise<void> {
    try { await this.settle(sessionId); } catch (error) { this.onError(error, sessionId); }
  }
}

function without<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  const next = new Map(map); next.delete(key); return next;
}
```

`ingest.ts`:
```ts
import type { IngestReport, Observation } from '@fork/contracts';
import type { SessionRecord, StateStore } from '@fork/state';
import type { Clock } from '../clock';

export interface IngestDeps { store: StateStore; clock: Clock }

const isStaleForResume = (session: SessionRecord, o: Observation): boolean =>
  o.kind === 'transcript' && session.resumedAt !== null && new Date(o.capturedAt).getTime() < new Date(session.resumedAt).getTime();

/** Store-only ingestion. Idempotent by observation id. Caller decides whether to touch the settle window. */
export function ingestBatch(deps: IngestDeps, session: SessionRecord, observations: readonly Observation[]): IngestReport {
  const empty: IngestReport = { accepted: 0, duplicates: [], staleEpoch: [], ignoredPartials: 0 };
  return deps.store.transaction(() => observations.reduce((report, o) => ingestOne(deps, session, o, report), empty));
}

function ingestOne(deps: IngestDeps, session: SessionRecord, o: Observation, report: IngestReport): IngestReport {
  if (o.captureEpoch !== session.captureEpoch) return { ...report, staleEpoch: [...report.staleEpoch, o.id] };
  if (o.kind === 'transcript' && o.phase === 'partial') return { ...report, ignoredPartials: report.ignoredPartials + 1 };
  if (!deps.store.insertObservation(o, deps.clock.nowIso())) return { ...report, duplicates: [...report.duplicates, o.id] };
  if (o.kind === 'transcript' && o.supersedesObservationId) deps.store.markSuperseded(o.supersedesObservationId, o.id);
  if (o.kind === 'transcript' && (session.capture !== 'listening' || isStaleForResume(session, o))) deps.store.setPlanStatus([o.id], 'skipped', null);
  if (o.kind === 'preview_context') deps.store.setPlanStatus([o.id], 'planned', null); // context is evidence, never planned on its own
  return { ...report, accepted: report.accepted + 1 };
}
```

- [ ] **Step 4: Run → pass; commit**

Run: `npm test --workspace @fork/orchestrator`
Expected: all passing.

```bash
git add packages/orchestrator/src/observations
git commit -m "feat(orchestrator): observation ingest, audio ordering, context-at, settle window"
```

---

### Task 5: Deterministic gate

**Files:**
- Create: `packages/orchestrator/src/gate/dedupe-key.ts`, `gate.ts`, `rules/session-enabled.ts`, `rules/sources-finalized.ts`, `rules/target-valid.ts`, `rules/operation-permitted.ts`, `rules/paths-allowed.ts`, `rules/size-bounds.ts`, `rules/dedupe.ts`, `rules/revision-match.ts`, `rules/undo-applicable.ts`, `rules/index.ts`
- Test: `packages/orchestrator/src/gate/gate.test.ts`, `dedupe-key.test.ts`

**Interfaces:**
- Consumes: `PlannerProposal`, `SessionRecord`, `StoredObservation`, `StoredExperiment`, `OrchestratorConfig`.
- Produces:
```ts
export interface GateInput {
  proposal: PlannerProposal; session: SessionRecord; config: OrchestratorConfig;
  observations: ReadonlyMap<string, StoredObservation>;   // every source id → stored observation (missing = not found)
  experiments: readonly StoredExperiment[];
  hasDedupeKey: (key: string) => boolean;
  dedupeKey: string;
}
export type GateResult = { allowed: true; dedupeKey: string } | { allowed: false; code: GateCode; reason: string };
export type GateCode = 'session_disabled' | 'source_not_final' | 'source_superseded' | 'source_wrong_epoch' | 'source_missing'
  | 'target_missing' | 'target_hidden' | 'target_not_editable' | 'target_mismatch' | 'operation_not_permitted' | 'no_workspace'
  | 'path_not_allowed' | 'size_bounds' | 'duplicate' | 'revision_mismatch' | 'stale_context' | 'undo_not_applicable' | 'candidates_invalid';
export function runGate(input: GateInput): GateResult;   // rules run in the order listed above; first violation wins
export function dedupeKeyFor(sessionId: string, proposal: PlannerProposal): string;
export function resolvedClarificationKey(clarifyIntentId: string): string;   // `clarify:${id}:resolved`
```
- Rule signature: `type Rule = (input: GateInput) => GateViolation | null` where `GateViolation = { code: GateCode; reason: string }`.

- [ ] **Step 1: Failing tests**

`dedupe-key.test.ts`:
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dedupeKeyFor, resolvedClarificationKey } from './dedupe-key';
import type { PlannerProposal } from '@fork/contracts';

const p = (over: Partial<PlannerProposal> = {}): PlannerProposal => ({ id: 'i1', sessionId: 's', captureEpoch: 'c', sourceObservationIds: ['t1', 'c1'],
  expectedRevision: { source: 1, config: 0 }, summary: 'x', kind: 'preview_patch', patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' },
  targetEvidence: { contextObservationId: 'c1', elementId: 'start-trial', basis: ['explicit_label'], explanation: 'e' }, ...over } as PlannerProposal);

test('same sources + same action → same key; intent id and source order do not matter', () => {
  assert.equal(dedupeKeyFor('s', p()), dedupeKeyFor('s', p({ id: 'i2', sourceObservationIds: ['c1', 't1'] })));
});
test('different value or session → different key', () => {
  assert.notEqual(dedupeKeyFor('s', p()), dedupeKeyFor('s', p({ patch: { kind: 'set_size', elementId: 'start-trial', value: 'md' } })));
  assert.notEqual(dedupeKeyFor('s', p()), dedupeKeyFor('s2', p()));
});
test('resolved clarification key is stable', () => { assert.equal(resolvedClarificationKey('int-9'), 'clarify:int-9:resolved'); });
```

`gate.test.ts` — one test per rule using a `baseInput()` builder. Include exactly these cases:
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlannerProposal, PreviewContextObservation, TranscriptObservation } from '@fork/contracts';
import type { SessionRecord, StoredExperiment, StoredObservation } from '@fork/state';
import { DEFAULT_CONFIG } from '../config';
import { runGate, type GateInput } from './gate';
import { dedupeKeyFor } from './dedupe-key';

const T0 = '2026-09-12T15:00:00.000Z';
const session: SessionRecord = { id: 's', projectConfigId: 'p', captureEpoch: 'cap', capture: 'listening', prototypeAutonomyEnabled: true, workspaceId: 'w',
  revision: { source: 1, config: 0 }, previewUrl: null, currentTopic: null, clarification: null, resumedAt: null, createdAt: T0, updatedAt: T0 };
const speech: TranscriptObservation = { id: 't1', sessionId: 's', captureEpoch: 'cap', capturedAt: T0, version: 1, kind: 'transcript', phase: 'final', providerItemId: 't1',
  audioTurnSequence: 1, orderReliable: true, streamId: 'mic', text: 'What if this button were bigger?', speaker: { label: null, verified: false } };
const context: PreviewContextObservation = { id: 'c1', sessionId: 's', captureEpoch: 'cap', capturedAt: T0, version: 1, kind: 'preview_context', workspaceId: 'w',
  revision: { source: 1, config: 0 }, route: '/signup', viewport: { width: 1280, height: 800 }, focusId: null, hover: null, selection: null,
  elements: [
    { id: 'start-trial', role: 'button', label: 'Start trial', visible: true, box: { x: 0, y: 0, width: 1, height: 1 }, editable: ['size', 'background', 'label', 'radius'] },
    { id: 'hidden-btn', role: 'button', label: 'Hidden', visible: false, box: { x: 0, y: 0, width: 1, height: 1 }, editable: ['size'] },
    { id: 'task-table', role: 'table', label: 'Tasks', visible: true, box: { x: 0, y: 0, width: 1, height: 1 }, editable: [] },
  ] };
const stored = (o: TranscriptObservation | PreviewContextObservation, extra: Partial<StoredObservation> = {}): StoredObservation =>
  ({ observation: o, planStatus: 'pending', supersededBy: null, intentId: null, receivedSeq: 1, ...extra });
const patch = (over: Record<string, unknown> = {}): PlannerProposal => ({ id: 'i1', sessionId: 's', captureEpoch: 'cap', sourceObservationIds: ['t1', 'c1'],
  expectedRevision: { source: 1, config: 0 }, summary: 'Try a larger Start trial button', kind: 'preview_patch',
  patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' },
  targetEvidence: { contextObservationId: 'c1', elementId: 'start-trial', basis: ['explicit_label'], explanation: 'Names the button.' }, ...over } as PlannerProposal);
const baseInput = (proposal: PlannerProposal, over: Partial<GateInput> = {}): GateInput => ({ proposal, session, config: DEFAULT_CONFIG,
  observations: new Map([['t1', stored(speech)], ['c1', stored(context)]]), experiments: [], hasDedupeKey: () => false, dedupeKey: dedupeKeyFor('s', proposal), ...over });

test('allows the canonical grounded preview patch', () => { assert.deepEqual(runGate(baseInput(patch())), { allowed: true, dedupeKey: dedupeKeyFor('s', patch()) }); });
test('rejects mutation while paused / stopped / autonomy off', () => {
  for (const s of [{ capture: 'paused' as const }, { capture: 'stopped' as const }, { prototypeAutonomyEnabled: false }]) {
    const r = runGate(baseInput(patch(), { session: { ...session, ...s } }));
    assert.equal(r.allowed, false); assert.equal(!r.allowed && r.code, 'session_disabled');
  }
});
test('observe/hold pass even when paused', () => {
  const r = runGate(baseInput(patch({ kind: 'observe', reason: 'x', patch: undefined, targetEvidence: undefined }), { session: { ...session, capture: 'paused' } }));
  assert.equal(r.allowed, true);
});
test('rejects superseded, partial, wrong-epoch, and missing sources', () => {
  const cases: Array<[Partial<StoredObservation> | null, string]> = [[{ supersededBy: 't2' }, 'source_superseded'], [{ observation: { ...speech, phase: 'partial' } }, 'source_not_final'],
    [{ observation: { ...speech, captureEpoch: 'old' } }, 'source_wrong_epoch'], [null, 'source_missing']];
  for (const [extra, code] of cases) {
    const observations = new Map([['c1', stored(context)]]); if (extra) observations.set('t1', stored(speech, extra));
    const r = runGate(baseInput(patch(), { observations })); assert.equal(!r.allowed && r.code, code);
  }
});
test('rejects hidden, non-editable, unknown, and mismatched targets', () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ patch: { kind: 'set_size', elementId: 'hidden-btn', value: 'lg' }, targetEvidence: { contextObservationId: 'c1', elementId: 'hidden-btn', basis: ['explicit_label'], explanation: 'e' } }, 'target_hidden'],
    [{ patch: { kind: 'set_size', elementId: 'task-table', value: 'lg' }, targetEvidence: { contextObservationId: 'c1', elementId: 'task-table', basis: ['route'], explanation: 'e' } }, 'target_not_editable'],
    [{ patch: { kind: 'set_size', elementId: 'nope', value: 'lg' }, targetEvidence: { contextObservationId: 'c1', elementId: 'nope', basis: ['route'], explanation: 'e' } }, 'target_missing'],
    [{ targetEvidence: { contextObservationId: 'c1', elementId: 'task-table', basis: ['route'], explanation: 'e' } }, 'target_mismatch'],
  ];
  for (const [over, code] of cases) { const r = runGate(baseInput(patch(over))); assert.equal(!r.allowed && r.code, code); }
});
test('rejects operations not in config.allowedOperations and jobs without a workspace', () => {
  const r1 = runGate(baseInput(patch(), { config: { ...DEFAULT_CONFIG, allowedOperations: ['undo'] } })); assert.equal(!r1.allowed && r1.code, 'operation_not_permitted');
  const job = patch({ kind: 'prototype_change', brief: 'Add filter', relevantSources: [], constraints: [], mockedIntegrations: [], patch: undefined, targetEvidence: undefined });
  const r2 = runGate(baseInput(job, { session: { ...session, workspaceId: null } })); assert.equal(!r2.allowed && r2.code, 'no_workspace');
});
test('rejects traversal / absolute source paths in prototype_change', () => {
  // contracts schema already forbids these; the gate re-checks because proposals can be constructed server-side (clarification answers, fixtures).
  const forged = patch({ kind: 'prototype_change', brief: 'x', relevantSources: [{ kind: 'repo', path: '/etc/passwd', fingerprint: 'f' }], constraints: [], mockedIntegrations: [], patch: undefined, targetEvidence: undefined });
  const r = runGate(baseInput(forged)); assert.equal(!r.allowed && r.code, 'path_not_allowed');
});
test('rejects oversize brief and label', () => {
  const r1 = runGate(baseInput(patch({ patch: { kind: 'set_label', elementId: 'start-trial', value: 'x'.repeat(61) } }))); assert.equal(!r1.allowed && r1.code, 'size_bounds');
});
test('rejects duplicates', () => { const r = runGate(baseInput(patch(), { hasDedupeKey: () => true })); assert.equal(!r.allowed && r.code, 'duplicate'); });
test('rejects revision mismatch and stale context', () => {
  const r1 = runGate(baseInput(patch({ expectedRevision: { source: 0, config: 0 } }))); assert.equal(!r1.allowed && r1.code, 'revision_mismatch');
  const staleCtx = stored({ ...context, revision: { source: 0, config: 0 } });
  const r2 = runGate(baseInput(patch(), { observations: new Map([['t1', stored(speech)], ['c1', staleCtx]]) })); assert.equal(!r2.allowed && r2.code, 'stale_context');
});
test('undo requires a visible experiment with a checkpoint', () => {
  const undo = patch({ kind: 'undo', experimentId: 'e1', patch: undefined, targetEvidence: undefined });
  const exp = (status: StoredExperiment['status'], checkpointId: string | null): StoredExperiment => ({ id: 'e1', sessionId: 's', intentId: 'i0', status, summary: 's', origin: 'inferred_experiment',
    sourceObservationIds: [], revision: { source: 1, config: 1 }, checkpointId, mockNotes: [], targetKey: 'element:start-trial', createdAt: T0, updatedAt: T0 });
  assert.equal(runGate(baseInput(undo, { experiments: [exp('visible', 'chk-1')] })).allowed, true);
  assert.equal(!runGate(baseInput(undo, { experiments: [exp('reverted', 'chk-1')] })).allowed, true);
  assert.equal(!runGate(baseInput(undo, { experiments: [exp('visible', null)] })).allowed, true);
});
test('clarify candidates must be visible elements of the cited context', () => {
  const ok = patch({ kind: 'clarify', question: 'Which button?', candidates: [{ id: 'start-trial', label: 'Start trial' }, { id: 'task-table', label: 'Tasks' }], patch: undefined, targetEvidence: undefined });
  assert.equal(runGate(baseInput(ok)).allowed, true);
  const bad = patch({ kind: 'clarify', question: 'Which?', candidates: [{ id: 'start-trial', label: 'Start trial' }, { id: 'ghost', label: 'Ghost' }], patch: undefined, targetEvidence: undefined });
  const r = runGate(baseInput(bad)); assert.equal(!r.allowed && r.code, 'candidates_invalid');
});
```
(The `patch()` helper spreads `undefined` for fields the kind does not use; the gate never runs zod on the proposal, so this is fine in tests. Do not enable `exactOptionalPropertyTypes` — zod's `.optional()` infers `T | undefined`, which would break assignability to `types.ts`.)

- [ ] **Step 2: Run → fail**

Run: `npm test --workspace @fork/orchestrator`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`dedupe-key.ts`:
```ts
import { createHash } from 'node:crypto';
import type { PlannerProposal } from '@fork/contracts';

function actionFingerprint(p: PlannerProposal): unknown {
  switch (p.kind) {
    case 'preview_patch': return ['patch', p.patch];
    case 'prototype_change': return ['job', p.brief];
    case 'undo': return ['undo', p.experimentId];
    case 'clarify': return ['clarify', p.candidates.map((c) => c.id).sort()];
    default: return [p.kind];
  }
}

export function dedupeKeyFor(sessionId: string, proposal: PlannerProposal): string {
  const material = JSON.stringify([sessionId, [...proposal.sourceObservationIds].sort(), actionFingerprint(proposal)]);
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

export const resolvedClarificationKey = (clarifyIntentId: string): string => `clarify:${clarifyIntentId}:resolved`;
```

`gate.ts`:
```ts
import type { PlannerProposal } from '@fork/contracts';
import type { SessionRecord, StoredExperiment, StoredObservation } from '@fork/state';
import type { OrchestratorConfig } from '../config';
import { RULES } from './rules';

export type GateCode = 'session_disabled' | 'source_not_final' | 'source_superseded' | 'source_wrong_epoch' | 'source_missing'
  | 'target_missing' | 'target_hidden' | 'target_not_editable' | 'target_mismatch' | 'operation_not_permitted' | 'no_workspace'
  | 'path_not_allowed' | 'size_bounds' | 'duplicate' | 'revision_mismatch' | 'stale_context' | 'undo_not_applicable' | 'candidates_invalid';
export interface GateViolation { code: GateCode; reason: string }
export interface GateInput {
  proposal: PlannerProposal; session: SessionRecord; config: OrchestratorConfig;
  observations: ReadonlyMap<string, StoredObservation>; experiments: readonly StoredExperiment[];
  hasDedupeKey: (key: string) => boolean; dedupeKey: string;
}
export type GateResult = { allowed: true; dedupeKey: string } | ({ allowed: false } & GateViolation);
export type Rule = (input: GateInput) => GateViolation | null;

export const MUTATING_KINDS = new Set<PlannerProposal['kind']>(['preview_patch', 'prototype_change', 'undo', 'clarify', 'pause']);

/** Deterministic post-inference checks. Model certainty is never an input. First violation wins. */
export function runGate(input: GateInput): GateResult {
  for (const rule of RULES) {
    const violation = rule(input);
    if (violation) return { allowed: false, ...violation };
  }
  return { allowed: true, dedupeKey: input.dedupeKey };
}
```

`rules/index.ts`: `export const RULES: Rule[] = [sessionEnabled, sourcesFinalized, targetValid, operationPermitted, pathsAllowed, sizeBounds, dedupe, revisionMatch, undoApplicable, candidatesValid];`

Rule implementations (each its own file, each < 40 lines):

`rules/session-enabled.ts`:
```ts
import type { Rule } from '../gate';
import { MUTATING_KINDS } from '../gate';
export const sessionEnabled: Rule = ({ proposal, session }) => {
  if (!MUTATING_KINDS.has(proposal.kind)) return null;
  if (session.capture !== 'listening') return { code: 'session_disabled', reason: `capture is ${session.capture}` };
  if (!session.prototypeAutonomyEnabled) return { code: 'session_disabled', reason: 'prototype autonomy not enabled by host' };
  return null;
};
```

`rules/sources-finalized.ts`:
```ts
import type { Rule } from '../gate';
export const sourcesFinalized: Rule = ({ proposal, session, observations }) => {
  for (const id of proposal.sourceObservationIds) {
    const stored = observations.get(id);
    if (!stored) return { code: 'source_missing', reason: `observation ${id} not found` };
    if (stored.observation.captureEpoch !== session.captureEpoch) return { code: 'source_wrong_epoch', reason: `observation ${id} belongs to an older capture` };
    if (stored.supersededBy) return { code: 'source_superseded', reason: `observation ${id} was corrected by ${stored.supersededBy}` };
    if (stored.observation.kind === 'transcript' && stored.observation.phase !== 'final') return { code: 'source_not_final', reason: `observation ${id} is a caption delta` };
  }
  return null;
};
```

`rules/target-valid.ts`:
```ts
import type { EditableProperty, PreviewPatch } from '@fork/contracts';
import type { Rule } from '../gate';
const PROPERTY_FOR: Record<PreviewPatch['kind'], EditableProperty> = { set_size: 'size', set_background: 'background', set_label: 'label', set_radius: 'radius', set_visibility: 'visible' };
export const targetValid: Rule = ({ proposal, observations }) => {
  if (proposal.kind !== 'preview_patch') return null;
  const { patch, targetEvidence } = proposal;
  if (patch.elementId !== targetEvidence.elementId) return { code: 'target_mismatch', reason: 'patch target differs from cited evidence' };
  const ctx = observations.get(targetEvidence.contextObservationId)?.observation;
  if (!ctx || ctx.kind !== 'preview_context') return { code: 'target_missing', reason: 'cited context observation not found' };
  const element = ctx.elements.find((e) => e.id === patch.elementId);
  if (!element) return { code: 'target_missing', reason: `element ${patch.elementId} not in cited context` };
  if (!element.visible) return { code: 'target_hidden', reason: `element ${element.label} is not visible` };
  if (!element.editable.includes(PROPERTY_FOR[patch.kind])) return { code: 'target_not_editable', reason: `${element.label} does not allow ${PROPERTY_FOR[patch.kind]}` };
  return null;
};
```

`rules/operation-permitted.ts`:
```ts
import type { Rule } from '../gate';
export const operationPermitted: Rule = ({ proposal, session, config }) => {
  if (proposal.kind === 'observe' || proposal.kind === 'hold') return null;
  if (!config.allowedOperations.includes(proposal.kind)) return { code: 'operation_not_permitted', reason: `${proposal.kind} is disabled by configuration` };
  if ((proposal.kind === 'prototype_change' || proposal.kind === 'preview_patch') && !session.workspaceId) return { code: 'no_workspace', reason: 'session has no prepared workspace' };
  return null;
};
```

`rules/paths-allowed.ts`:
```ts
import { isWorkspaceRelativePath } from '@fork/contracts';
import type { Rule } from '../gate';
export const pathsAllowed: Rule = ({ proposal }) => {
  if (proposal.kind !== 'prototype_change') return null;
  const bad = proposal.relevantSources.find((s) => !isWorkspaceRelativePath(s.path));
  return bad ? { code: 'path_not_allowed', reason: `source path ${bad.path} is outside the workspace` } : null;
};
```

`rules/size-bounds.ts`:
```ts
import type { Rule } from '../gate';
export const sizeBounds: Rule = ({ proposal, config }) => {
  if (proposal.kind === 'preview_patch' && proposal.patch.kind === 'set_label' && proposal.patch.value.length > config.maxLabelChars)
    return { code: 'size_bounds', reason: `label longer than ${config.maxLabelChars} characters` };
  if (proposal.kind === 'prototype_change') {
    if (proposal.brief.length > config.maxBriefChars) return { code: 'size_bounds', reason: `brief longer than ${config.maxBriefChars} characters` };
    if (proposal.relevantSources.length > config.maxRelevantSources) return { code: 'size_bounds', reason: 'too many relevant sources' };
  }
  return null;
};
```

`rules/dedupe.ts`:
```ts
import type { Rule } from '../gate';
export const dedupe: Rule = ({ proposal, hasDedupeKey, dedupeKey }) => {
  if (proposal.kind === 'observe' || proposal.kind === 'hold') return null;
  return hasDedupeKey(dedupeKey) ? { code: 'duplicate', reason: 'same request already handled for these observations' } : null;
};
```

`rules/revision-match.ts`:
```ts
import type { Revision } from '@fork/contracts';
import type { Rule } from '../gate';
const same = (a: Revision, b: Revision): boolean => a.source === b.source && a.config === b.config;
export const revisionMatch: Rule = ({ proposal, session, observations }) => {
  if (proposal.kind === 'observe' || proposal.kind === 'hold') return null;
  if (!same(proposal.expectedRevision, session.revision)) return { code: 'revision_mismatch', reason: 'preview changed since this suggestion was planned' };
  if (proposal.kind === 'preview_patch') {
    const ctx = observations.get(proposal.targetEvidence.contextObservationId)?.observation;
    if (ctx?.kind === 'preview_context' && !same(ctx.revision, session.revision)) return { code: 'stale_context', reason: 'cited screen context predates the current preview revision' };
  }
  return null;
};
```

`rules/undo-applicable.ts`:
```ts
import type { Rule } from '../gate';
export const undoApplicable: Rule = ({ proposal, experiments }) => {
  if (proposal.kind !== 'undo') return null;
  const target = experiments.find((e) => e.id === proposal.experimentId);
  if (!target || target.status !== 'visible' || !target.checkpointId) return { code: 'undo_not_applicable', reason: 'no visible experiment with a checkpoint to revert' };
  return null;
};
```

`rules/candidates-valid.ts`:
```ts
import type { Rule } from '../gate';
export const candidatesValid: Rule = ({ proposal, observations }) => {
  if (proposal.kind !== 'clarify') return null;
  const contexts = [...observations.values()].map((o) => o.observation).filter((o) => o.kind === 'preview_context');
  const visible = new Set(contexts.flatMap((c) => (c.kind === 'preview_context' ? c.elements.filter((e) => e.visible).map((e) => e.id) : [])));
  const ghost = proposal.candidates.find((c) => !visible.has(c.id));
  return ghost ? { code: 'candidates_invalid', reason: `candidate ${ghost.id} is not a visible element` } : null;
};
```

- [ ] **Step 4: Run → pass; commit**

Run: `npm test --workspace @fork/orchestrator && npm run typecheck --workspace @fork/orchestrator`

```bash
git add packages/orchestrator/src/gate
git commit -m "feat(orchestrator): deterministic action gate with per-rule modules"
```

---

### Task 6: `FakePrototypeEngine` (labeled fixture) + scenario fixtures

**Files:**
- Create: `packages/orchestrator/src/testing/fake-engine.ts`, `src/testing/demo-workspace.ts`, `src/testing/index.ts`
- Test: `packages/orchestrator/src/testing/fake-engine.test.ts`

**Interfaces:**
- Consumes: `PrototypeEngine` and friends from `@fork/contracts`.
- Produces:
```ts
export class FakePrototypeEngine implements PrototypeEngine {
  readonly label: 'FIXTURE';
  constructor(options?: { workspaceId?: string; previewUrl?: string; jobDelayMs?: number });
  prepare/applyPatch/runJob/undo/cancel per contract;
  // test hooks (never used by production code):
  failNextJob(diagnostic: string): void;
  currentRevision(): Revision;
  elementsFor(route: string): PreviewElement[];      // static demo elements; used to synthesize preview_context observations
  appliedPatches(): readonly PreviewPatch[];
}
export const DEMO_WORKSPACE: { workspaceId: string; previewUrl: string; routes: Record<string, PreviewElement[]>; repoMap: RepoMap };
```

- [ ] **Step 1: Failing tests**

`fake-engine.test.ts`:
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakePrototypeEngine } from './fake-engine';
import type { PrototypeJob } from '@fork/contracts';

const job = (id: string, expectedRevision = { source: 1, config: 0 }): PrototypeJob => ({ id, experimentId: 'e', sessionId: 's', workspaceId: 'demo-1', intentId: 'i',
  expectedRevision, brief: 'Add an overdue-only toggle', relevantSources: [], constraints: [], mockedIntegrations: ['dates are synthetic'], mode: 'demo_only', verification: 'compile_and_render' });

test('prepare returns a rendered workspace at revision {1,0} with a repo map that says FIXTURE', async () => {
  const engine = new FakePrototypeEngine();
  const prepared = await engine.prepare({ sessionId: 's', projectConfigId: 'demo-product', mode: 'existing_repo' });
  assert.deepEqual(prepared.revision, { source: 1, config: 0 });
  assert.equal(prepared.renderState, 'rendered');
  assert.match(prepared.repoMap.limitations.join(' '), /FIXTURE/);
});

test('applyPatch enforces expected revision and bumps config; undo restores via checkpoint', async () => {
  const engine = new FakePrototypeEngine();
  await engine.prepare({ sessionId: 's', projectConfigId: 'demo-product', mode: 'existing_repo' });
  const stale = await engine.applyPatch({ operationId: 'op1', sessionId: 's', workspaceId: 'demo-1', expectedRevision: { source: 0, config: 0 }, patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' } });
  assert.equal(stale.applied, false);
  const ok = await engine.applyPatch({ operationId: 'op2', sessionId: 's', workspaceId: 'demo-1', expectedRevision: { source: 1, config: 0 }, patch: { kind: 'set_size', elementId: 'start-trial', value: 'lg' } });
  assert.equal(ok.applied, true); assert.deepEqual(ok.revision, { source: 1, config: 1 }); assert.ok(ok.checkpointId);
  const undone = await engine.undo({ operationId: 'op3', workspaceId: 'demo-1', expectedRevision: { source: 1, config: 1 }, checkpointId: ok.checkpointId! });
  assert.equal(undone.applied, true); assert.deepEqual(undone.revision, { source: 1, config: 2 });
  assert.equal(engine.appliedPatches().length, 1);
});

test('runJob reports progress, honours abort, and can be told to fail', async () => {
  const engine = new FakePrototypeEngine({ jobDelayMs: 5 });
  await engine.prepare({ sessionId: 's', projectConfigId: 'demo-product', mode: 'existing_repo' });
  const states: string[] = [];
  const ready = await engine.runJob(job('j1'), (p) => { states.push(p.state); });
  assert.equal(ready.state, 'ready'); assert.deepEqual(ready.resultingRevision, { source: 2, config: 0 }); assert.deepEqual(states, ['queued', 'running', 'checking', 'ready']);
  const controller = new AbortController();
  const pending = engine.runJob(job('j2', { source: 2, config: 0 }), () => {}, controller.signal);
  controller.abort();
  assert.equal((await pending).state, 'cancelled');
  engine.failNextJob('TypeError: overdue is not defined');
  const failed = await engine.runJob(job('j3', { source: 2, config: 0 }), () => {});
  assert.equal(failed.state, 'failed'); assert.equal(failed.check.compile, 'failed'); assert.deepEqual(engine.currentRevision(), { source: 2, config: 0 });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement**

`demo-workspace.ts` (synthetic; every string labeled):
```ts
import type { PreviewElement, RepoMap } from '@fork/contracts';
const btn = (id: string, label: string, x: number): PreviewElement => ({ id, role: 'button', label, section: 'Signup', visible: true, box: { x, y: 500, width: 150, height: 40 }, editable: ['size', 'background', 'label', 'radius'] });
export const DEMO_WORKSPACE = {
  workspaceId: 'demo-1',
  previewUrl: 'http://localhost:4173',
  routes: {
    '/signup': [btn('start-trial', 'Start trial', 440), btn('explore-sample', 'Explore sample', 620)],
    '/tasks': [{ id: 'task-table', role: 'table', label: 'Sample tasks', section: 'Workspace', visible: true, box: { x: 40, y: 120, width: 1200, height: 500 }, editable: [] } satisfies PreviewElement,
               btn('add-task', 'Add task', 40)],
  } as Record<string, PreviewElement[]>,
  repoMap: {
    workspaceId: 'demo-1', origin: 'existing_repo', fingerprint: 'fixture-sha-0000', framework: { name: 'react-vite (FIXTURE)', verified: false },
    routes: [{ route: '/signup', sources: [{ kind: 'repo', path: 'src/pages/Signup.tsx', fingerprint: 'fixture' }] }, { route: '/tasks', sources: [{ kind: 'repo', path: 'src/pages/Tasks.tsx', fingerprint: 'fixture' }] }],
    relevantSources: [], mockCapabilities: ['synthetic task records with due dates', 'client-side filters'],
    limitations: ['FIXTURE engine: no real files are edited; results are simulated for pipeline verification'],
  } satisfies RepoMap,
};
```

`fake-engine.ts` — in-memory: `revision`, `checkpoints: ReadonlyMap<string, Revision>`, `patches: readonly PreviewPatch[]`, `nextFailure: string | null`, `running: Map<jobId, AbortController>`. Behaviour:
- `prepare`: reset revision `{1,0}`; return `{ workspaceId, revision, repoMap: DEMO_WORKSPACE.repoMap, previewUrl, renderState: 'rendered' }`.
- `applyPatch`: if revision mismatch → `{ applied: false, revision: current, checkpointId: null, diagnostic: 'revision mismatch (FIXTURE)' }`; else checkpoint id `chk_<n>` storing pre-revision, `revision = { ...revision, config: revision.config + 1 }`, append patch, return applied.
- `runJob(job, progress, signal)`: emit `queued`; `await delay`; if aborted → `cancelled` result; emit `running`; `await delay`; emit `checking`; if `nextFailure` → clear it, emit `failed`, return `{ state: 'failed', basedOn: job.expectedRevision, resultingRevision: current, checkpointId, previewUrl, changedFiles: [], mockNotes: ['FIXTURE'], check: { compile: 'failed', page: 'not_checked', diagnostics: [failure] } }` (revision unchanged = "restored checkpoint"); if revision mismatch with `job.expectedRevision` → `superseded`; else `revision = { source: +1, config }`, emit `ready`, return ready with `changedFiles: ['src/pages/Tasks.tsx (FIXTURE)']`, `check: { compile: 'passed', page: 'rendered', diagnostics: [] }`.
- `undo`: revision must match; checkpoint must exist; `revision = { ...revision, config: config + 1 }` (undo is a new config revision); return applied with a fresh checkpoint id. `appliedPatches()` is an append-only history of applied patches (undo does not remove entries).
- `cancel(jobId)`: abort the controller if running → `{ accepted: true }` else `{ accepted: false }`. Use an internal `AbortController` linked to the caller's `signal` so both paths cancel.
- Delay helper resolves early on abort: `new Promise<void>((resolve) => { const t = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true }); })`.

`testing/index.ts`: `export { FakePrototypeEngine } from './fake-engine'; export { DEMO_WORKSPACE } from './demo-workspace'; export { FixturePlanner } from './fixture-planner'; export * from './scenario-fixtures';` (the last two are created in Task 8 — add the exports then).

- [ ] **Step 4: Run → pass; commit**

```bash
git add packages/orchestrator/src/testing
git commit -m "feat(orchestrator): labeled fake prototype engine for pipeline verification"
```

---

### Task 7: Scheduler — coalescing, single writer, cancellation, stale results, undo

**Files:**
- Create: `packages/orchestrator/src/scheduler/target-key.ts`, `describe.ts`, `scheduler.ts`, `run-patch.ts`, `run-job.ts`, `run-undo.ts`, `types.ts`
- Test: `packages/orchestrator/src/scheduler/scheduler.test.ts`, `describe.test.ts`

**Interfaces:**
- Consumes: `StateStore`, `EventBus`, `PrototypeEngine`, `Clock`, `OrchestratorConfig`, `newId`.
- Produces:
```ts
export type WorkItem =
  | { kind: 'patch'; sessionId: string; intentId: string; experimentId: string; targetKey: string; patch: PreviewPatch; expectedRevision: Revision }
  | { kind: 'job'; sessionId: string; intentId: string; experimentId: string; targetKey: string; job: PrototypeJob }
  | { kind: 'undo'; sessionId: string; intentId: string | null; experimentId: string; targetKey: string; origin: 'inferred_experiment' | 'host_control' };
export interface SchedulerDeps { store: StateStore; bus: EventBus; engine: PrototypeEngine; clock: Clock; config: OrchestratorConfig; logger: Logger;
  snapshotOf: (sessionId: string) => SessionSnapshot }   // injected to avoid a circular import with session/snapshot.ts
export class Scheduler {
  constructor(deps: SchedulerDeps);
  enqueue(item: WorkItem): void;              // coalesces by targetKey, supersedes older pending, cancels running job on same target
  cancelJob(sessionId: string, jobId: string): Promise<boolean>;
  cancelAll(sessionId: string): Promise<void>; // Stop: abort active job, supersede queue
  idle(sessionId: string): Promise<void>;     // resolves when queue + active drained (tests)
}
export function targetKeyFor(proposal: PlannerProposal, workspaceId: string | null, experiments: readonly StoredExperiment[]): string;  // 'element:<id>' | 'job:<workspaceId>' | experiment's own key for undo
export function describeProposal(proposal: PlannerProposal, elementLabel: string | null): string;         // "Trying a larger Start trial button"
```
- Experiment status transitions this task owns: `proposed → applying → visible | failed | superseded`; `visible → reverted`.
- Events emitted: `experiment` on every status change; `job` on each progress; `status` messages exactly: `"${summary} — Undo"` (visible), `"Could not apply: ${diagnostic}"` (failed), `"Discarded a late result; a newer direction replaced it"` (superseded on return), `"Reverted: ${summary}"` (undo), `"Cancelled: ${summary}"`; `snapshot` after every revision change (snapshot built via `buildSnapshot` from Task 9 — inject as `snapshotOf: (sessionId) => SessionSnapshot` dependency to avoid a circular import).

- [ ] **Step 1: Failing tests**

`describe.test.ts`:
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describePatch } from './describe';
test('describes size/background/label/radius/visibility patches in plain words', () => {
  assert.equal(describePatch({ kind: 'set_size', elementId: 'x', value: 'lg' }, 'Start trial'), 'Trying a larger Start trial button');
  assert.equal(describePatch({ kind: 'set_size', elementId: 'x', value: 'sm' }, 'Start trial'), 'Trying a smaller Start trial button');
  assert.equal(describePatch({ kind: 'set_background', elementId: 'x', value: 'red' }, 'Explore sample'), 'Trying a red Explore sample button');
  assert.equal(describePatch({ kind: 'set_label', elementId: 'x', value: 'Get started' }, 'Start trial'), 'Trying the label "Get started" on Start trial');
  assert.equal(describePatch({ kind: 'set_visibility', elementId: 'x', value: false }, 'Banner'), 'Trying Banner hidden');
  assert.equal(describePatch({ kind: 'set_radius', elementId: 'x', value: 'pill' }, 'Start trial'), 'Trying a pill-shaped Start trial button');
});
```

`scheduler.test.ts` — uses `openSqliteStore(':memory:')`, `FakePrototypeEngine({ jobDelayMs: 10 })`, a session at revision `{1,0}` with `workspaceId: 'demo-1'`, and a stub `snapshotOf`. Helper `seedIntent(kind)` inserts a `StoredIntent` and a `StoredExperiment` in `proposed`. Cases:
```ts
test('patch runs, bumps session revision, marks experiment visible, emits experiment+status+snapshot');
test('patch with moved revision fails without calling the engine');
test('two queued patches on the same element coalesce: the first is superseded, only the second applies');
test('a running job is cancelled when a newer item targets the same key; its late result is discarded as superseded and revision is unchanged');
test('a job that fails leaves revision unchanged and emits a status with the diagnostic');
test('undo reverts a visible experiment and bumps config revision');
test('undo of a non-visible experiment emits status and does nothing');
test('cancelAll aborts the active job and supersedes queued work');
test('idle() resolves after the queue drains');
```
Write each with explicit assertions on `store.getSession('s').revision`, `store.getExperiment(id).status`, and the ordered `payload.kind` list captured by `bus.subscribe`.

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement**

`target-key.ts`:
```ts
import type { PlannerProposal } from '@fork/contracts';
import type { StoredExperiment } from '@fork/state';
export function targetKeyFor(proposal: PlannerProposal, workspaceId: string | null, experiments: readonly StoredExperiment[]): string {
  switch (proposal.kind) {
    case 'preview_patch': return `element:${proposal.patch.elementId}`;
    case 'prototype_change': return `job:${workspaceId ?? 'none'}`;
    case 'undo': return experiments.find((e) => e.id === proposal.experimentId)?.targetKey ?? `undo:${proposal.experimentId}`;
    default: return `none:${proposal.kind}`;
  }
}
```

`describe.ts`:
```ts
import type { PreviewPatch, PlannerProposal, SizeToken } from '@fork/contracts';
const SIZE_ORDER: SizeToken[] = ['sm', 'md', 'lg', 'xl'];
export const sizeIndex = (t: SizeToken): number => SIZE_ORDER.indexOf(t);
export function describePatch(patch: PreviewPatch, label: string): string {
  switch (patch.kind) {
    case 'set_size': return `Trying a ${sizeIndex(patch.value) >= 2 ? 'larger' : 'smaller'} ${label} button`;
    case 'set_background': return `Trying a ${patch.value} ${label} button`;
    case 'set_label': return `Trying the label "${patch.value}" on ${label}`;
    case 'set_radius': return `Trying a ${patch.value === 'none' ? 'square' : `${patch.value}-shaped`} ${label} button`;
    case 'set_visibility': return `Trying ${label} ${patch.value ? 'shown' : 'hidden'}`;
  }
}
export function describeProposal(proposal: PlannerProposal, label: string | null): string {
  if (proposal.kind === 'preview_patch') return describePatch(proposal.patch, label ?? proposal.patch.elementId);
  if (proposal.kind === 'prototype_change') return `Prototyping: ${proposal.brief.slice(0, 120)}`;
  return proposal.summary;
}
```
(Relative wording: "larger/smaller" is relative to the *previous* value when the runner knows it; `run-patch.ts` passes the previous size via `describePatchRelative(patch, label, previous)` — implement as: if both sizes known, compare indexes; else fall back to `describePatch`. Test in `describe.test.ts` with one extra case: `describePatchRelative({kind:'set_size', value:'md'}, 'Start trial', 'lg') === 'Trying a smaller Start trial button'`.)

`types.ts`: the `WorkItem` union above + `SchedulerDeps`.

`scheduler.ts` (≤ 200 lines): 
- State: `queues: ReadonlyMap<sessionId, readonly WorkItem[]>`, `active: ReadonlyMap<sessionId, { item: WorkItem; controller: AbortController; done: Promise<void> }>`, `superseded: ReadonlySet<intentId>` (checked when a job returns).
- `enqueue(item)`: 
  1. `const dropped = queue.filter(q => q.targetKey === item.targetKey)` → for each: `store.updateExperiment(id, {status:'superseded'})`, `store.updateIntent(intentId, {gateStatus:'superseded', gateReason:'replaced by a newer request on the same target'})`, publish `experiment`.
  2. If `active?.item.targetKey === item.targetKey && active.item.kind === 'job'`: add its intentId to `superseded`, `controller.abort()`, `void engine.cancel(jobId)`.
  3. `queues = set(queues, sessionId, [...queue.filter(q => q.targetKey !== item.targetKey), item])`; `void this.drain(sessionId)`.
- `drain(sessionId)`: if active → return; shift first item (immutable update); set `active` with new `AbortController`; `done = runItem(...)` wrapped in try/catch (log + mark experiment failed + publish `error` event on unexpected throw); `finally` clear active and `drain` again.
- `runItem` dispatches to `runPatch`, `runJob`, `runUndo` (each in its own file, each receives `deps + item + signal + isSuperseded()`).
- `cancelJob(sessionId, jobId)`: if active job id matches → supersede + abort + `engine.cancel` → true; else if queued → supersede & remove → true; else false.
- `cancelAll(sessionId)`: supersede all queued; abort active; await `active.done`.
- `idle(sessionId)`: loop `while (active || queue.length) await active?.done ?? tick()`.

`run-patch.ts`:
```ts
export async function runPatch(deps: SchedulerDeps, item: Extract<WorkItem, { kind: 'patch' }>): Promise<void> {
  const session = requireSession(deps.store, item.sessionId);
  if (!sameRevision(session.revision, item.expectedRevision)) return fail(deps, item, 'preview changed before this edit could apply');
  transition(deps, item.experimentId, 'applying');
  const result = await deps.engine.applyPatch({ operationId: newId('op'), sessionId: item.sessionId, workspaceId: session.workspaceId!, expectedRevision: session.revision, patch: item.patch });
  if (!result.applied) return fail(deps, item, result.diagnostic ?? 'engine refused the patch');
  deps.store.updateSession(item.sessionId, { revision: result.revision }, deps.clock.nowIso());
  const exp = deps.store.updateExperiment(item.experimentId, { status: 'visible', checkpointId: result.checkpointId, revision: result.revision }, deps.clock.nowIso());
  deps.bus.publish(item.sessionId, { kind: 'experiment', experiment: toRecord(exp) });
  deps.bus.publish(item.sessionId, { kind: 'status', message: `${exp.summary} — Undo` });
  deps.bus.publish(item.sessionId, { kind: 'snapshot', snapshot: deps.snapshotOf(item.sessionId) });
}
```
`toRecord(stored)` strips `sessionId/targetKey/createdAt/updatedAt` → `ExperimentRecord`. `fail()` sets status `failed`, publishes `experiment` + `status "Could not apply: …"`.

`run-job.ts`: insert `StoredJob` (`state: 'queued'`), transition experiment `applying`, publish `job` progress on each callback (also `store.updateJob`), call `engine.runJob(job, progress, signal)`. On return:
- if `isSuperseded(item.intentId)` or `result.state === 'superseded'` or `!sameRevision(result.basedOn, item.job.expectedRevision)` → experiment `superseded`, job `superseded`, status `"Discarded a late result; a newer direction replaced it"`; **revision unchanged**.
- `cancelled` → experiment `superseded`, job `cancelled`, status `"Cancelled: ${summary}"`.
- `failed` → experiment `failed`, job `failed`, status `"Could not apply: ${diagnostics[0] ?? 'render check failed'}"`.
- `ready` → session `{ revision: result.resultingRevision, previewUrl: result.previewUrl ?? session.previewUrl }`, experiment `visible` with checkpoint + mockNotes, job `ready`, publish `experiment`, `status "${summary} — Undo"`, `snapshot`.

`run-undo.ts`: load experiment; if not `visible` or no checkpoint → status `"Nothing to undo"`; else `engine.undo({...})`; if applied → experiment `reverted`, session revision = result.revision, publish `experiment`, `status "Reverted: ${summary}"`, `snapshot`; else status `"Could not undo: ${diagnostic}"`.

- [ ] **Step 4: Run → pass; typecheck; commit**

```bash
git add packages/orchestrator/src/scheduler
git commit -m "feat(orchestrator): single-writer scheduler with coalescing, cancellation, and stale-result handling"
```

---

### Task 8: Planner contract, output → proposal conversion, context builder, retrieval, fixture planner

**Files:**
- Create: `packages/orchestrator/src/planner/planner.ts`, `output-schema.ts`, `to-proposal.ts`, `context-builder.ts`, `prompt.ts`
- Create: `packages/orchestrator/src/retrieval/company-docs.ts`, `repo-files.ts`
- Create: `packages/orchestrator/src/testing/fixture-planner.ts`, `scenario-fixtures.ts`
- Create: `fixtures/company/brand-guidelines.md`, `signup-flow-notes.md`, `task-board-constraints.md`
- Test: `to-proposal.test.ts`, `context-builder.test.ts`, `prompt.test.ts`, `company-docs.test.ts`, `repo-files.test.ts`, `scenario-fixtures.test.ts`

**Interfaces:**
```ts
// planner.ts
export interface PlanningContext {
  session: { id: string; captureEpoch: string; capture: CaptureState; prototypeAutonomyEnabled: boolean; revision: Revision; currentTopic: string | null };
  newTurns: Array<{ id: string; text: string; audioTurnSequence: number | null }>;      // eligible for action
  recentTurns: Array<{ id: string; text: string }>;                                       // context only
  context: { observationId: string; route: string; revision: Revision; focusId: string | null; hoverId: string | null; selectionId: string | null;
             elements: Array<{ id: string; role: string; label: string; section: string | null; visible: boolean; editable: EditableProperty[] }> } | null;
  visibleExperiments: Array<{ id: string; summary: string; targetKey: string; patch: PreviewPatch | null }>;
  pendingClarification: { intentId: string; question: string; candidates: Array<{ id: string; label: string }> } | null;
  repoMap: { framework: string; verified: boolean; routes: string[]; relevantSources: string[]; mockCapabilities: string[]; limitations: string[] } | null;
  companyNotes: Array<{ path: string; excerpt: string }>;
  repoExcerpts: Array<{ path: string; excerpt: string }>;
}
export interface Planner { readonly label: 'live' | 'fixture'; plan(context: PlanningContext): Promise<PlannerOutput> }
// output-schema.ts — flat & nullable so OpenAI structured output accepts it
// NO .min()/.max() here: OpenAI strict structured output rejects maxLength/maxItems keywords. Every field is required-or-nullable.
// Bounds are enforced afterwards by toProposal() + plannerProposalSchema (Task 1), which is where the contract limits live.
const patchKindSchema = z.enum(['set_size', 'set_background', 'set_label', 'set_radius', 'set_visibility']);
export const plannerOutputSchema = z.strictObject({
  kind: z.enum(['observe', 'hold', 'clarify', 'preview_patch', 'prototype_change', 'undo', 'pause']),
  summary: z.string(),
  reason: z.string(),                                           // one user-facing evidence sentence
  currentTopic: z.string().nullable(),
  resolvesClarification: z.boolean(),
  patch: z.strictObject({ kind: patchKindSchema, elementId: z.string(), value: z.string() }).nullable(),
  targetEvidence: z.strictObject({ elementId: z.string(), basis: z.array(targetBasisSchema), explanation: z.string() }).nullable(),
  clarify: z.strictObject({ question: z.string(), candidateElementIds: z.array(z.string()),
                            pendingPatch: z.strictObject({ kind: patchKindSchema, value: z.string() }).nullable() }).nullable(),
  prototype: z.strictObject({ brief: z.string(), relevantSourcePaths: z.array(z.string()), constraints: z.array(z.string()), mockedIntegrations: z.array(z.string()) }).nullable(),
  undoExperimentId: z.string().nullable(),
});
export type PlannerOutput = z.infer<typeof plannerOutputSchema>;
// to-proposal.ts
export interface ProposalIds { id: string; sessionId: string; captureEpoch: string; sourceObservationIds: string[]; expectedRevision: Revision }
export type ConversionResult = { ok: true; proposal: PlannerProposal; pendingPatch: StoredIntent['pendingPatch'] } | { ok: false; hold: PlannerProposal; reason: string };
export function toProposal(output: PlannerOutput, ids: ProposalIds, context: PlanningContext, repoMap: RepoMap | null): ConversionResult;
// context-builder.ts
export function buildPlanningContext(input: { session: SessionRecord; newTurns: StoredObservation[]; recentTurns: StoredObservation[]; context: StoredObservation | null;
  experiments: StoredExperiment[]; intents: ReadonlyMap<string, StoredIntent>; repoMap: RepoMap | null; companyNotes: ...; repoExcerpts: ... }): PlanningContext;
// prompt.ts
export const SYSTEM_PROMPT: string;
export function renderUserPrompt(context: PlanningContext): string;   // JSON.stringify(context, null, 0) with a one-line preface
// retrieval
export function loadCompanyDocs(dir: string): CompanyDoc[];   // sync at boot; each paragraph → { path, fingerprint, text }
export function retrieveCompanyNotes(docs: readonly CompanyDoc[], query: string, limit: number): Array<{ path: string; excerpt: string }>;
export async function readRepoExcerpts(workspaceRoot: string | null, repoMap: RepoMap | null, route: string | null, maxFiles: number, maxLines: number): Promise<Array<{ path: string; excerpt: string }>>;
// testing
export class FixturePlanner implements Planner { readonly label = 'fixture'; constructor(table: ReadonlyMap<string /* newest new-turn observation id */, PlannerOutput>) }
export interface ScenarioFixture { id: string; expected: string; note: string; route: string; elements: PreviewElement[]; preconditions: Array<'paused' | 'visible_size_experiment' | 'running_job' | 'blank_template'>;
  preTurns: TranscriptObservation[]; preOutput: PlannerOutput | null;   // scripted turn(s) that establish a precondition (ids `scn-<id>-pre`)
  turns: TranscriptObservation[]; contextObservation: PreviewContextObservation; fixtureOutput: PlannerOutput; acceptableOutcomes: Outcome[] }
export type Outcome = 'preview_patch_visible' | 'no_experiment' | 'clarification_shown' | 'undo_or_smaller_patch' | 'job_ready' | 'job_superseded' | 'pause';
export function loadScenarioFixtures(scenariosJsonPath: string): ScenarioFixture[];
```

- [ ] **Step 1: Company fixture docs** (synthetic; first line of each: `> Synthetic company note for the Fork demo. Not a real policy.`)

`fixtures/company/brand-guidelines.md`: primary actions use the blue palette token; destructive actions use red; button labels are two to three words in sentence case; pill radius is reserved for marketing pages.
`fixtures/company/signup-flow-notes.md`: the signup page must remain usable without an account; "Start trial" is the primary call to action; "Explore sample" opens a read-only sample workspace with synthetic data.
`fixtures/company/task-board-constraints.md`: the sample task table uses synthetic records with due dates in the past and future; filters must be client-side; no backend changes in demos; overdue means due date earlier than today.

- [ ] **Step 2: Failing tests**

`to-proposal.test.ts`:
```ts
test('converts a preview_patch output into a validated proposal with the cited context id');
test('rejects a size value that is not a token → hold with reason "planner output invalid: …"');
test('rejects a patch when the context is null → hold');
test('converts clarify output to candidates with labels looked up from the context, and returns pendingPatch');
test('converts prototype_change with relevantSourcePaths mapped to SourceRefs from the repo map (unknown paths dropped)');
test('undo without an id → hold; undo with id → undo proposal');
test('observe/hold/pause pass through with summary/reason');
```
`context-builder.test.ts`: `test('marks new vs recent turns, maps context elements, lists visible experiments with their patch, and exposes pending clarification')`.
`prompt.test.ts`: `test('system prompt states the non-negotiables')` — assert it contains `'never speak'`, `'negation'`, `'quoted'`, `'clarify'`, `'production'`, `'Hover alone'`; `test('user prompt is compact JSON of the context')` — `JSON.parse(renderUserPrompt(ctx).split('\n')[1]!)` round-trips.
`company-docs.test.ts`: loads the three fixture docs from `fixtures/company`, `retrieveCompanyNotes(docs, 'overdue tasks filter due dates', 2)` returns the task-board paragraph first; a nonsense query returns `[]`.
`repo-files.test.ts`: creates a temp dir with `src/pages/Tasks.tsx` (150 lines) and `secret.env`; a repo map listing both `src/pages/Tasks.tsx` and `../outside.ts`; asserts only `Tasks.tsx` is read, truncated to `maxLines`, and `readRepoExcerpts(null, …)` returns `[]`.
`scenario-fixtures.test.ts`: `loadScenarioFixtures('../../scenarios.json')` (resolve relative to repo root via `new URL('../../../../scenarios.json', import.meta.url)`) returns 10 fixtures whose ids equal the json ids and each has ≥ 1 turn and a `fixtureOutput`.

- [ ] **Step 3: Run → fail**

- [ ] **Step 4: Implement**

`prompt.ts` — `SYSTEM_PROMPT` (verbatim, keep under 60 lines):
```
You are Fork, a silent meeting coworker. You never speak and never ask aloud. You turn ordinary meeting talk into at most ONE bounded, reversible prototype experiment, or a quiet status. Output only the JSON object described by the schema.

Decide from NEW turns only; recent turns, screen context, experiments, and notes are evidence.

Act (preview_patch) when a new turn suggests a bounded visual/content change — size, background color, label, radius, visibility — and the target resolves to exactly one VISIBLE element in the screen context. Hypotheticals count: "What if this button were bigger?" is actionable when the button is resolved. Use targetEvidence.basis from: explicit_label, recent_referent, route, focus, hover, selection. Hover alone is not intent.

Never act on: negation ("don't make it bigger"), quoted or reported speech ("the customer said make it red"), rejected ideas ("we decided against that"), incomplete ideas ("another idea would be..."), off-topic talk, or anything asking for production, deployment, git pushes, emails, purchases, or external systems. For those return observe (nothing to do) or hold (incomplete/conflicting), with a one-sentence reason.

If two or more visible elements are plausible and nothing resolves the target, return clarify with 2–4 candidateElementIds from the context and a pendingPatch describing what you would apply. Never guess.

A correction right after a visible experiment ("too big, go back one size", "no, keep the original") → preview_patch with the smaller value on the same element, or undo with that experiment's id. Prefer undo when they want the original back.

Structural requests (filters, lists, new screens, mock data) → prototype_change: a brief ≤ 600 characters, reuse existing components, mock data only, no backend/tests/auth/deploy. Set mockedIntegrations honestly. Choose relevantSourcePaths only from the repo map.

Constraint statements ("this must work without signing in") → observe, set currentTopic, and put the constraint in reason. Do not pretend real auth changed.

If the pending clarification is answered by a new turn, return the resolved preview_patch and set resolvesClarification = true.

Size order: sm < md < lg < xl. Colors: neutral, blue, red, green, amber. Radius: none, sm, md, pill. reason and explanation are short user-facing evidence, never hidden reasoning.
```
`renderUserPrompt(ctx)`: `` `Planning context (JSON):\n${JSON.stringify(ctx)}` ``.

`output-schema.ts`: exactly the schema in Interfaces.

`to-proposal.ts` — pure conversion; every branch validates through `plannerProposalSchema.safeParse` and returns `{ ok:false, hold }` with `reason: 'planner output invalid: <first issue>'` on failure. Size/colour/radius tokens are validated by `previewPatchSchema` (`set_visibility` value comes as the string `'true'|'false'` → coerce). `clarify` labels = `context.elements.find(e => e.id === id)?.label ?? id`; unknown ids are dropped, and if fewer than 2 remain → hold. `prototype_change.relevantSources` = repoMap sources whose `path` is in `relevantSourcePaths` (routes' sources ∪ relevantSources); others dropped. `targetEvidence.contextObservationId` = `context.observationId`.

`context-builder.ts` — pure mapping; `visibleExperiments` = experiments with `status === 'visible'`, `patch` looked up from `intents.get(e.intentId)?.proposal` when `kind === 'preview_patch'`.

`company-docs.ts` — `loadCompanyDocs(dir)`: `readdirSync` `*.md`, split on blank lines, `fingerprint = sha256(file)`. `retrieveCompanyNotes`: tokenize (lowercase, `\w+`, drop a 40-word stoplist), score = overlap count / sqrt(paragraph tokens); return top `limit` with score > 0, excerpt ≤ 400 chars.

`repo-files.ts` — `readRepoExcerpts`: candidates = `repoMap.routes.find(r => r.route === route)?.sources ∪ repoMap.relevantSources` (dedupe by path, cap `maxFiles`); for each: `resolved = resolve(workspaceRoot, path)`; skip unless `resolved.startsWith(resolve(workspaceRoot) + sep)` and `existsSync`; read, take `maxLines` lines; never read `.env*`, `*.pem`, `*.key`. Errors per file are logged and skipped, never thrown.

`fixture-planner.ts`:
```ts
/** FIXTURE planner: returns canned outputs by the id of the newest NEW turn. It detects nothing; it replays. */
export class FixturePlanner implements Planner {
  readonly label = 'fixture' as const;
  constructor(private readonly table: ReadonlyMap<string, PlannerOutput>) {}
  async plan(context: PlanningContext): Promise<PlannerOutput> {
    const key = context.newTurns.at(-1)?.id;
    return (key && this.table.get(key)) ?? { kind: 'observe', summary: 'FIXTURE: no scripted output', reason: 'fixture planner has no entry for this turn',
      currentTopic: null, resolvesClarification: false, patch: null, targetEvidence: null, clarify: null, prototype: null, undoExperimentId: null };
  }
}
```

`scenario-fixtures.ts` — for each scenario id in `scenarios.json` build the fixture (turn id = `scn-<id>-t1`, context id `scn-<id>-ctx`, all on `/signup` except `structural`/`correction` context as documented):
| id | route / elements | preconditions | fixtureOutput.kind | acceptableOutcomes |
|---|---|---|---|---|
| suggestion | /signup: start-trial, explore-sample; `currentTopic: 'Start trial button'`; turn t0 = "The Start trial button is too small." then t1 = utterance | — | preview_patch set_size lg on start-trial (basis explicit_label, recent_referent) | preview_patch_visible |
| negation | same | — | observe | no_experiment |
| quotation | same | — | observe | no_experiment |
| ambiguity | same, no topic | — | clarify [start-trial, explore-sample], pendingPatch set_size lg | clarification_shown |
| correction | same | visible_size_experiment (preTurn "What if it were bigger?" → preOutput preview_patch lg on start-trial) | preview_patch set_size md | undo_or_smaller_patch |
| structural | /tasks: task-table, add-task | — | prototype_change brief "Add a client-side overdue-only toggle to the sample task table using synthetic due dates." relevantSourcePaths ['src/pages/Tasks.tsx'] | job_ready |
| pause | /signup | paused | preview_patch set_background red (planner would act; gate must refuse) | no_experiment |
| from_zero | route '/' with no elements | blank_template | prototype_change brief "Create an operations request list with owner, status, and an urgent filter using mock requests." | job_ready |
| late_result | /tasks | running_job (preTurn "We should be able to filter overdue tasks." → preOutput prototype_change) | prototype_change brief "Filter by owner instead of overdue; keep the synthetic data." — a contrary correction on the same `job:<workspaceId>` target while the first job runs | job_superseded (first experiment superseded + its late result discarded; second job ready) |
| production | /signup | — | observe reason "Deployment is outside the demo scope." | no_experiment |

- [ ] **Step 5: Run → pass; typecheck; commit**

```bash
git add packages/orchestrator/src/planner packages/orchestrator/src/retrieval packages/orchestrator/src/testing fixtures/company
git commit -m "feat(orchestrator): planner contract, output conversion, retrieval, fixture planner, scenario fixtures"
```

---

### Task 9: `LlmPlanner` + model resolver + snapshot builder

**Files:**
- Create: `packages/orchestrator/src/planner/model.ts`, `llm-planner.ts`, `src/session/snapshot.ts`
- Test: `model.test.ts`, `llm-planner.test.ts`, `snapshot.test.ts`

**Interfaces:**
```ts
export function resolvePlannerModel(env: NodeJS.ProcessEnv = process.env): { model: LanguageModel; provider: 'openai' | 'openrouter'; modelId: string };
export type StructuredGenerate = (input: { system: string; prompt: string }) => Promise<unknown>;   // returns the raw object
export class LlmPlanner implements Planner {
  readonly label = 'live';
  constructor(options: { generate: StructuredGenerate; logger?: Logger; timeoutMs?: number });
  static fromEnv(env?: NodeJS.ProcessEnv, logger?: Logger): LlmPlanner;    // builds generate via ai generateText + Output.object
}
export function buildSnapshot(session: SessionRecord, experiments: readonly StoredExperiment[], lastEventSequence: number): SessionSnapshot;
```

- [ ] **Step 1: Failing tests**

`model.test.ts` (mirrors the starter's env semantics):
```ts
test('openai: MODEL_PROVIDER=openai + OPENAI_API_KEY → provider openai, modelId from MODEL (default gpt-5.6-sol)');
test('openrouter: MODEL_PROVIDER=openrouter uses OPENROUTER_API_KEY and keeps the publisher/model slug');
test('missing key throws a message naming the env var');
test('unsupported provider throws');
test('stub-replace-me is treated as missing');
```
`llm-planner.test.ts`:
```ts
test('validates the generated object against plannerOutputSchema', async () => { /* generate returns a valid preview_patch object → plan() resolves it */ });
test('invalid model output becomes a hold output, not an exception', async () => { /* generate returns { kind: 'launch' } → plan() returns kind 'hold' with reason containing 'invalid' */ });
test('a thrown generate error becomes a hold output with reason "planner unavailable: …"', async () => {});
test('times out after timeoutMs into a hold', async () => { /* generate never resolves; timeoutMs: 10 */ });
```
`snapshot.test.ts`: `test('snapshot exposes clarification without internal fields and caps experiments')`.

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement**

`model.ts`:
```ts
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

const DEFAULT_MODEL = 'gpt-5.6-sol';   // same default as the starter's agent-core/model-meta.ts
const KEY_FOR = { openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY' } as const;

function requireKey(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value === 'stub-replace-me') throw new Error(`${name} is required for the live planner. Set it in .env or use FORK_PLANNER=fixture.`);
  return value;
}

export function resolvePlannerModel(env: NodeJS.ProcessEnv = process.env) {
  const provider = (env.MODEL_PROVIDER ?? (env.OPENROUTER_API_KEY ? 'openrouter' : 'openai')).trim().toLowerCase();
  if (provider !== 'openai' && provider !== 'openrouter') throw new Error(`Unsupported MODEL_PROVIDER '${provider}'. Track B supports openai or openrouter.`);
  const raw = (env.MODEL ?? DEFAULT_MODEL).trim();
  const modelId = provider === 'openai' ? raw.replace(/^openai[:/]/, '') : raw.includes('/') ? raw : `openai/${raw}`;
  const apiKey = requireKey(env, KEY_FOR[provider]);
  const model: LanguageModel = provider === 'openai'
    ? createOpenAI({ apiKey })(modelId)
    : createOpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' }).chat(modelId);
  return { model, provider, modelId };
}
```

`llm-planner.ts`:
```ts
import { generateText, Output } from 'ai';
import type { Planner, PlanningContext } from './planner';
import { plannerOutputSchema, type PlannerOutput } from './output-schema';
import { renderUserPrompt, SYSTEM_PROMPT } from './prompt';
import { resolvePlannerModel } from './model';
import type { Logger } from '../logger';
import { silentLogger } from '../logger';

export type StructuredGenerate = (input: { system: string; prompt: string }) => Promise<unknown>;

const hold = (reason: string): PlannerOutput => ({ kind: 'hold', summary: 'Waiting for clearer context', reason, currentTopic: null,
  resolvesClarification: false, patch: null, targetEvidence: null, clarify: null, prototype: null, undoExperimentId: null });

export class LlmPlanner implements Planner {
  readonly label = 'live' as const;
  private readonly generate: StructuredGenerate; private readonly logger: Logger; private readonly timeoutMs: number;
  constructor(options: { generate: StructuredGenerate; logger?: Logger; timeoutMs?: number }) {
    this.generate = options.generate; this.logger = options.logger ?? silentLogger; this.timeoutMs = options.timeoutMs ?? 20000;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env, logger?: Logger): LlmPlanner {
    const { model, provider, modelId } = resolvePlannerModel(env);
    logger?.info('live planner configured', { provider, modelId });
    const generate: StructuredGenerate = async ({ system, prompt }) => {
      const result = await generateText({ model, system, prompt, output: Output.object({ schema: plannerOutputSchema }) });
      return result.output;
    };
    return new LlmPlanner({ generate, ...(logger ? { logger } : {}) });
  }

  async plan(context: PlanningContext): Promise<PlannerOutput> {
    try {
      const raw = await withTimeout(this.generate({ system: SYSTEM_PROMPT, prompt: renderUserPrompt(context) }), this.timeoutMs);
      const parsed = plannerOutputSchema.safeParse(raw);
      if (!parsed.success) { this.logger.warn('planner output invalid', { issue: parsed.error.issues[0]?.message }); return hold(`planner output invalid: ${parsed.error.issues[0]?.message ?? 'unknown'}`); }
      return parsed.data;
    } catch (error) {
      this.logger.error('planner unavailable', { error: String(error) });
      return hold(`planner unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
```

`snapshot.ts`:
```ts
export function buildSnapshot(session: SessionRecord, experiments: readonly StoredExperiment[], lastEventSequence: number, limit = 20): SessionSnapshot {
  return {
    id: session.id, captureEpoch: session.captureEpoch, capture: session.capture, prototypeAutonomyEnabled: session.prototypeAutonomyEnabled,
    workspaceId: session.workspaceId, revision: session.revision, previewUrl: session.previewUrl, currentTopic: session.currentTopic, lastEventSequence,
    experiments: experiments.slice(-limit).map(({ sessionId: _s, targetKey: _t, createdAt: _c, updatedAt: _u, ...record }) => record),
    clarification: session.clarification ? { intentId: session.clarification.intentId, question: session.clarification.question, candidates: session.clarification.candidates } : null,
  };
}
```

- [ ] **Step 4: Run → pass; typecheck; commit**

```bash
git add packages/orchestrator/src/planner packages/orchestrator/src/session/snapshot.ts
git commit -m "feat(orchestrator): live LLM planner via AI SDK with env-compatible model resolver"
```

---

### Task 10: Orchestrator wiring — session service, planning loop, controls, end-to-end scenario tests

**Files:**
- Create: `packages/orchestrator/src/session/session-service.ts`, `src/session/controls.ts`, `src/planning/plan-pending.ts`, `src/planning/dispatch.ts`, `src/orchestrator.ts`, `src/index.ts`
- Test: `packages/orchestrator/src/orchestrator.test.ts` (end-to-end with FixturePlanner + FakePrototypeEngine), `src/session/controls.test.ts`

**Interfaces:**
- Produces the public `Orchestrator` API from "Cross-task Interfaces" and `createOrchestrator(deps)`.
- `src/index.ts` exports: `createOrchestrator`, `OrchestratorError`, types (`Orchestrator`, `OrchestratorDeps`, `ProjectConfig`, `Planner`, `PlanningContext`, `PlannerOutput`, `OrchestratorConfig`, `Logger`, `Clock`), `LlmPlanner`, `resolvePlannerModel`, `loadCompanyDocs`, `DEFAULT_CONFIG`, `resolveConfig`, `consoleLogger`, `silentLogger`, `systemClock`.

- [ ] **Step 1: Failing end-to-end tests**

`orchestrator.test.ts` — helper `boot(opts)` creates `openSqliteStore(':memory:')`, `FakePrototypeEngine({ jobDelayMs: 10 })`, `FixturePlanner(table)`, `createOrchestrator({ store, engine, planner, projects: [{ id: 'demo-product', label: 'x', mode: 'existing_repo', workspaceRoot: null }], config: { settleMs: 5 }, clock: fixedClock('2026-09-12T15:00:00.000Z') })`, then `createSession` + `setCapture({ action: 'start', prototypeAutonomyEnabled: true })`, collects events via `subscribe`. Helpers `say(id, text, extra?)` and `screen(id, route, elements, extra?)` build observations with the session's `captureEpoch` and explicit `capturedAt` values later than the clock time (`screen` at `15:00:01`, `say` at `15:00:02+`) so the context predates the speech and nothing is mistaken for pre-resume speech. Tests (assert on `getSnapshot`, experiment statuses, event kinds in order, and `engine.appliedPatches()`):
```ts
test('suggestion: finalized turn + valid screen context → one visible size experiment, status "… — Undo", snapshot revision {1,1}');
test('duplicate delivery of the same final turn → still exactly one experiment');
test('a corrected final (supersedesObservationId) replaces the prior turn before planning');
test('partials never reach the planner');
test('pause control: turns during pause are skipped; resume does not replay them; a new turn after resume plans normally');
test('stop: cancels the active job (experiment superseded), closes capture, and skips pending turns; after a new start, observations tagged with the previous epoch are reported as staleEpoch');
test('capture start twice → new epoch; observations tagged with the old epoch are ignored');
test('ambiguity: clarify → clarification event + snapshot.clarification; clarification_answer control applies the pending patch to the chosen candidate once; a second answer is rejected (409)');
test('a later turn that resolves the clarification (resolvesClarification=true) applies with the resolved dedupe key; answering afterwards via control is a no-op duplicate');
test('clarification expires when the route changes (context event) → status event, snapshot.clarification null');
test('correction: planner returns set_size md after a visible lg experiment → new visible experiment; planner returning undo → experiment reverted');
test('structural: prototype_change → job events queued→running→checking→ready, experiment visible, revision.source bumped, previewUrl kept');
test('late result: a job is running; a newer prototype_change on the same job target arrives → first job cancelled (experiment superseded, late result discarded), second job runs to ready; revision.source bumped exactly once');
test('a fast patch planned at revision R0 that reaches the front of the queue after a job moved the preview to R1 is not applied blindly: experiment failed + status "Could not apply: preview changed…" (reconciliation via a fresh job is a documented follow-up)');
test('failed job: engine.failNextJob → experiment failed, status contains diagnostic, revision unchanged');
test('gate rejection is recorded on the intent (gateStatus rejected + reason) and emits no experiment');
test('planner throwing → intent stored as hold, turns marked failed, error event published, later turns still plan');
test('production request → fixture observe → no experiment, no job');
test('createSession with unknown projectConfigId → OrchestratorError project_not_allowed');
```

`controls.test.ts`: unit-level for `applyControl` state transitions: `pause` when stopped → 409; `resume` when listening → 409 `invalid_state`; `undo` with unknown experiment → 404; `cancel_job` unknown → 404.

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement**

`session-service.ts`:
```ts
export class SessionService {
  constructor(private readonly deps: { store: StateStore; engine: PrototypeEngine; bus: EventBus; clock: Clock; projects: readonly ProjectConfig[]; config: OrchestratorConfig; logger: Logger }) {}

  async create(input: { projectConfigId: string }): Promise<{ session: SessionRecord; repoMap: RepoMap }> {
    const project = this.deps.projects.find((p) => p.id === input.projectConfigId);
    if (!project) throw new OrchestratorError('project_not_allowed', `project '${input.projectConfigId}' is not in the server allowlist`);
    const now = this.deps.clock.nowIso();
    const id = newId('ses');
    const prepared = await this.prepare(id, project);
    const record: SessionRecord = { id, projectConfigId: project.id, captureEpoch: newId('cap'), capture: 'stopped', prototypeAutonomyEnabled: false,
      workspaceId: prepared.workspaceId, revision: prepared.revision, previewUrl: prepared.previewUrl, currentTopic: null, clarification: null, resumedAt: null, createdAt: now, updatedAt: now };
    const session = this.deps.store.transaction(() => { const s = this.deps.store.createSession(record); this.deps.store.saveRepoMap(id, prepared.repoMap); return s; });
    this.publishSnapshot(id);
    return { session, repoMap: prepared.repoMap };
  }

  private async prepare(sessionId: string, project: ProjectConfig): Promise<PreparedWorkspace> {
    try { return preparedWorkspaceSchema.parse(await this.deps.engine.prepare({ sessionId, projectConfigId: project.id, mode: project.mode })); }
    catch (error) { throw new OrchestratorError('engine_failed', `prototype engine could not prepare the workspace: ${error instanceof Error ? error.message : String(error)}`); }
  }

  startCapture(sessionId: string, autonomy: boolean | undefined): SessionRecord  // new epoch: endCaptureEpoch(old), recordCaptureEpoch(new); capture 'listening'; autonomy = autonomy ?? current; resumedAt = now; publish snapshot
  pause(sessionId): SessionRecord    // requires listening; capture 'paused'; setPlanStatus(pending → 'skipped'); publish snapshot + status 'Paused automatic changes'
  resume(sessionId): SessionRecord   // requires paused; capture 'listening'; resumedAt = now; publish snapshot + status 'Resumed'
  stop(sessionId): SessionRecord     // capture 'stopped'; autonomy false; endCaptureEpoch; skip pending; publish snapshot + status 'Capture stopped'
  publishSnapshot(sessionId): void   // bus.publish snapshot via buildSnapshot(store.getSession, store.listExperiments(limit), store.lastEventSequence)
  require(sessionId): SessionRecord  // throws session_not_found
}
```
(`setCapture({action})` in the orchestrator maps `start → startCapture`, `pause → pause`, `stop → stop`; `SessionControl.resume` → `resume`.)

`planning/plan-pending.ts` — `export async function planPending(deps, sessionId): Promise<void>` (split into helpers so each function < 50 lines):
1. `session = store.getSession`; if missing → return. If `capture !== 'listening'` → `store.setPlanStatus(pendingIds, 'skipped', null)`; return.
2. `pending = orderTurns(store.listPendingTranscript(sessionId, epoch))`; if empty → return.
3. `recent = lastTurns(orderTurns(store.listFinalTranscript(sessionId, epoch, config.transcriptWindowTurns)), config.transcriptWindowTurns)` minus pending ids.
4. `context = selectContextAt(store.listContext(sessionId, epoch, 20), pending.at(-1).observation.capturedAt, config.contextLookbackMs)`.
5. `repoMap = store.getRepoMap`, `experiments = store.listExperiments(sessionId, 50)`, `intents` map for visible experiments.
6. `companyNotes = retrieveCompanyNotes(deps.companyDocs, pending.map(t => t.text).join(' '), config.maxCompanyExcerpts)`; `repoExcerpts = await readRepoExcerpts(project.workspaceRoot, repoMap, context?.route ?? null, 3, config.maxRepoFileLines)`.
7. `planningContext = buildPlanningContext({...})`; `output = await planner.plan(planningContext)` (planner never throws by contract; wrap anyway → on throw publish `error` event `planner_failed`, `setPlanStatus(pending, 'failed')`, return).
8. `ids = { id: newId('int'), sessionId, captureEpoch, sourceObservationIds: [...pending ids, ...(context ? [context.id] : [])], expectedRevision: session.revision }`; `conversion = toProposal(output, ids, planningContext, repoMap)`; `proposal = conversion.ok ? conversion.proposal : conversion.hold`.
9. `dedupeKey = output.resolvesClarification && session.clarification ? resolvedClarificationKey(session.clarification.intentId) : dedupeKeyFor(sessionId, proposal)`.
10. `gate = runGate({ proposal, session, config, observations: map of stored source observations, experiments, hasDedupeKey: k => store.hasDedupeKey(sessionId, k), dedupeKey })`.
11. In one `store.transaction`: `insertIntent(sessionId, { proposal, gateStatus: gate.allowed ? 'allowed' : 'rejected', gateReason, dedupeKey, pendingPatch, createdAt })`; if allowed and mutating → `putDedupeKey`; `setPlanStatus(pending ids, 'planned', proposal.id)`; if `output.currentTopic` → `updateSession({ currentTopic })`.
12. `if (gate.allowed) await dispatch(deps, session, proposal, conversion)`; else `logger.info('gate rejected', { code, reason })` (no event — quiet; but for `duplicate`/`stale_context` nothing visible either).

`planning/dispatch.ts` — `dispatch(deps, session, proposal, conversion)`:
- `observe`/`hold`: nothing (already stored).
- `pause`: `sessionService.pause(sessionId)`.
- `clarify`: `store.updateSession({ clarification: { intentId, question, candidates, route: context.route, contextObservationId, createdAt } })`; publish `clarification` + `snapshot`.
- `undo`: `scheduler.enqueue({ kind: 'undo', sessionId, intentId, experimentId, targetKey: experiment.targetKey, origin: 'inferred_experiment' })`.
- `preview_patch`: insert experiment `{ id: newId('exp'), intentId, status: 'proposed', summary: describePatchRelative(patch, label, previousSize), origin: 'inferred_experiment', sourceObservationIds, revision: session.revision, checkpointId: null, mockNotes: [], targetKey: `element:${elementId}` }`; publish `experiment`; if `resolvesClarification` → clear `session.clarification`; `scheduler.enqueue({ kind: 'patch', … expectedRevision: session.revision })`.
- `prototype_change`: insert experiment (`targetKey: job:<workspaceId>`, `mockNotes: proposal.mockedIntegrations`), build `PrototypeJob` (`id: newId('job')`, `mode: 'demo_only'`, `verification: 'compile_and_render'`), `scheduler.enqueue({ kind: 'job', … })`.

`session/controls.ts` — `applyControl(deps, sessionId, control)`:
- `pause`/`resume`/`stop` → session service (stop also `await scheduler.cancelAll(sessionId)` when `config.stopBehavior === 'cancel'`).
- `undo` → experiment must exist (404) → `scheduler.enqueue({ kind: 'undo', intentId: null, origin: 'host_control', … })`.
- `cancel_job` → `scheduler.cancelJob` → false → 404.
- `clarification_answer` → `session.clarification?.intentId === control.intentId` else 409 `clarification_mismatch`; candidate must be in candidates else 409; `intent = store.getIntent(intentId)`; `pendingPatch` required else 409; build a `preview_patch` proposal `{ id: newId('int'), sourceObservationIds: intent.proposal.sourceObservationIds, expectedRevision: session.revision, patch: { kind, elementId: candidateId, value }, targetEvidence: { contextObservationId: clarification.contextObservationId, elementId: candidateId, basis: ['selection'], explanation: 'Host chose this candidate for the pending question.' } }`; `dedupeKey = resolvedClarificationKey(intentId)`; run gate; store intent; if allowed → clear clarification, dispatch as `preview_patch`; if `duplicate` → 409 `invalid_state` "clarification already resolved".
- Every branch returns `buildSnapshot(...)`.

Observation-driven clarification handling (in `orchestrator.ingestObservations` after `ingestBatch`): for each accepted `preview_context`: if `session.clarification` and (`route !== clarification.route` or any candidate id not visible) → clear clarification, publish `status 'Question expired: the screen changed'` + `snapshot`; else if `selection` set on a candidate and `selection.at > clarification.createdAt` → `applyControl(sessionId, { kind: 'clarification_answer', intentId, candidateId: selection.elementId })` (a UI event may resolve, but the resolved dedupe key prevents repeats). Then `settle.touch(sessionId)` if any transcript final was accepted.

`orchestrator.ts` — `createOrchestrator(deps)`: resolve config, load `companyDocs = deps.companyDocsDir ? loadCompanyDocs(dir) : []` once (missing dir → warn + `[]`, never throw), build `bus`, `scheduler` (with `snapshotOf`), `sessionService`, `settle = new SettleWindow(config.settleMs, (sid) => chain(sid, () => planPending(...)), (e, sid) => { logger.error; bus.publish(sid, { kind:'error', code:'planner_failed', message }) })` where `chain` serializes per session; return the object implementing `Orchestrator`. `flush(sessionId)` → `settle.flush(sessionId)` then `scheduler.idle(sessionId)`. `dispose()` → `settle.dispose()`. `plannerLabel = planner.label`; `engineLabel = (engine as { label?: string }).label === 'FIXTURE' ? 'FIXTURE' : 'live'`.

- [ ] **Step 4: Run → pass; typecheck; coverage**

Run: `npm test --workspace @fork/orchestrator && npm run typecheck --workspace @fork/orchestrator && npm run test:coverage --workspace @fork/orchestrator`
Expected: all passing; coverage ≥ 80 % lines (the `llm-planner.fromEnv` network path is excluded from tests — keep it thin).

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator
git commit -m "feat(orchestrator): wire session service, planning loop, controls, and scenario end-to-end tests"
```

---

### Task 11: `apps/api` — Hono routes, auth, SSE

**Files:**
- Create: `apps/api/package.json`, `tsconfig.json`
- Create: `apps/api/src/env.ts`, `projects.ts`, `auth.ts`, `errors.ts`, `app.ts`, `routes/sessions.ts`, `routes/capture.ts`, `routes/observations.ts`, `routes/events.ts`, `routes/controls.ts`, `routes/jobs.ts`, `routes/transcription.ts`, `transcription/connector.ts`
- Test: `apps/api/src/app.test.ts`, `auth.test.ts`, `env.test.ts`, `events.test.ts`

**Interfaces:**
```ts
export interface ApiDeps { orchestrator: Orchestrator; token: string; allowedOrigins: readonly string[]; transcription: TranscriptionConnector; logger: Logger }
export function createApp(deps: ApiDeps): Hono;
export interface TranscriptionConnector { readonly label: 'live' | 'unconfigured'; negotiate(input: { sessionId: string; sdp?: string }): Promise<{ kind: 'client_secret' | 'sdp_answer'; value: string; expiresAt: string | null }> }
export class UnconfiguredTranscriptionConnector implements TranscriptionConnector  // negotiate() throws ApiError 503 'transcription_unconfigured'
export function loadEnv(env?: NodeJS.ProcessEnv): ApiEnv;   // zod-validated; FORK_API_TOKEN generated when blank (returned with `generatedToken: true`)
export function loadProjects(path: string): ProjectConfig[];  // zod-validated fork.projects.json; workspaceRoot must be absolute or null
```
Routes (all under `/api`, JSON envelope `ApiEnvelope<T>`):

| Method+Path | Body schema | 2xx data |
|---|---|---|
| `POST /api/sessions` | `createSessionRequestSchema` | `{ snapshot, repoMap }` (201) |
| `GET /api/sessions/:id` | — | `{ snapshot, events: SessionEvent[] }` (last 200) |
| `POST /api/sessions/:id/capture` | `captureRequestSchema` | `{ snapshot }` |
| `POST /api/sessions/:id/transcription-connection` | `transcriptionConnectionRequestSchema` | connector result; 503 when unconfigured; 429 over 5 req/min/session |
| `POST /api/sessions/:id/observations` | `observationsBatchSchema` (+ every `sessionId` must equal `:id` → 400 otherwise) | `IngestReport` (202) |
| `GET /api/sessions/:id/events?after=N` | — | SSE: first event `snapshot`, then replay `> after` (or `Last-Event-ID`), then live; `: keepalive` every 15 s |
| `POST /api/sessions/:id/controls` | `sessionControlSchema` | `{ snapshot }` |
| `GET /api/jobs/:id` | — | `StoredJob` view `{ id, state, message, result, experimentId, sessionId }` |

- [ ] **Step 1: Manifest**

`apps/api/package.json`:
```json
{
  "name": "api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Fork v2 private control API (loopback). Owned by Track B.",
  "scripts": {
    "dev": "node --env-file-if-exists=../../.env --disable-warning=ExperimentalWarning --import tsx --watch src/server.ts",
    "start": "node --env-file-if-exists=../../.env --disable-warning=ExperimentalWarning --import tsx src/server.ts",
    "replay": "node --env-file-if-exists=../../.env --disable-warning=ExperimentalWarning --import tsx scripts/replay-scenarios.ts",
    "typecheck": "tsc --noEmit",
    "test": "node --disable-warning=ExperimentalWarning --import tsx --test 'src/**/*.test.ts'",
    "test:coverage": "node --disable-warning=ExperimentalWarning --import tsx --experimental-test-coverage --test-coverage-lines=80 --test 'src/**/*.test.ts'"
  },
  "dependencies": {
    "@fork/contracts": "*",
    "@fork/orchestrator": "*",
    "@fork/state": "*",
    "@hono/node-server": "^2.1.0",
    "hono": "^4.13.0",
    "zod": "^4.1.0"
  }
}
```
`tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src", "scripts"] }`

- [ ] **Step 2: Failing tests**

`env.test.ts`: defaults (host 127.0.0.1, port 8787, planner fixture, engine fake, settle 1200); `FORK_API_PORT=abc` throws naming the var; blank token → generated 32+ chars + `generatedToken: true`; origins split/trimmed; relative `FORK_PROJECTS_FILE` resolves to an absolute path under the repo root while `:memory:` is left untouched.

`auth.test.ts` (uses `createApp` with a stub orchestrator):
```ts
test('401 without bearer token; 401 with wrong token (constant-time compare)');
test('403 when Origin header is present and not allowlisted; allowed origin passes and gets CORS headers');
test('events route accepts ?access_token= (documented EventSource fallback); other routes do not');
```
`app.test.ts` (real `createOrchestrator` with `:memory:` store, `FakePrototypeEngine`, `FixturePlanner`, `settleMs: 5`):
```ts
test('POST /api/sessions → 201 with snapshot + repoMap; unknown project → 403 envelope');
test('POST /api/sessions/:id/capture start → listening with autonomy; invalid action → 400 with issues[]');
test('POST observations: mismatched sessionId → 400; valid batch → 202 IngestReport; duplicates reported');
test('GET /api/sessions/:id returns snapshot + ordered events');
test('POST controls undo unknown experiment → 404; pause → snapshot.capture paused');
test('GET /api/jobs/:id → 404 unknown; after a structural scenario → state ready');
test('POST transcription-connection → 503 transcription_unconfigured with fixture connector; 429 after 5 calls');
test('unexpected orchestrator throw → 500 envelope without stack');
```
`events.test.ts`: request the SSE route via `app.request('/api/sessions/:id/events?after=0', { headers })`, read the body stream with a `TextDecoder`, assert the first frame is `event: snapshot`, then publish two events through the orchestrator and assert both frames arrive with increasing `id:` lines; assert `Last-Event-ID: 1` skips sequence 1.

- [ ] **Step 3: Run → fail**

- [ ] **Step 4: Implement**

`env.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
// npm runs workspace scripts with cwd = apps/api, so relative FORK_* paths are resolved against the repo root, never cwd.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const fromRoot = (p: string): string => resolve(ROOT, p);
const schema = z.object({
  FORK_API_HOST: z.string().default('127.0.0.1'),
  FORK_API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  FORK_API_TOKEN: z.string().optional(),
  FORK_ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://127.0.0.1:3000'),
  FORK_DB_PATH: z.string().default('./.data/fork.sqlite'),
  FORK_PLANNER: z.enum(['fixture', 'live']).default('fixture'),
  FORK_ENGINE: z.enum(['fake', 'live']).default('fake'),
  FORK_SETTLE_MS: z.coerce.number().int().min(0).max(10000).default(1200),
  FORK_PROJECTS_FILE: z.string().default('./fork.projects.json'),
  FORK_COMPANY_DOCS_DIR: z.string().default('./fixtures/company'),
});
export interface ApiEnv { host: string; port: number; token: string; generatedToken: boolean; allowedOrigins: string[]; dbPath: string; planner: 'fixture' | 'live'; engine: 'fake' | 'live'; settleMs: number; projectsFile: string; companyDocsDir: string }
export function loadEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const v = parsed.data;
  const token = v.FORK_API_TOKEN?.trim() || randomBytes(24).toString('base64url');
  return { host: v.FORK_API_HOST, port: v.FORK_API_PORT, token, generatedToken: !v.FORK_API_TOKEN?.trim(),
    allowedOrigins: v.FORK_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    dbPath: v.FORK_DB_PATH === ':memory:' ? v.FORK_DB_PATH : fromRoot(v.FORK_DB_PATH), planner: v.FORK_PLANNER,
    engine: v.FORK_ENGINE, settleMs: v.FORK_SETTLE_MS, projectsFile: fromRoot(v.FORK_PROJECTS_FILE), companyDocsDir: fromRoot(v.FORK_COMPANY_DOCS_DIR) };
}
```

`auth.ts`:
```ts
import { createHash, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { fail } from './errors';
const digest = (s: string): Buffer => createHash('sha256').update(s).digest();
export const tokensMatch = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b));
export function authMiddleware(token: string, allowedOrigins: readonly string[]): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('origin');
    if (origin && !allowedOrigins.includes(origin)) return fail(c, 403, 'forbidden_origin', 'origin is not allowed to call the Fork control API');
    const header = c.req.header('authorization') ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    const query = c.req.path.endsWith('/events') ? c.req.query('access_token') ?? null : null;
    const supplied = bearer ?? query;
    if (!supplied || !tokensMatch(supplied, token)) return fail(c, 401, 'unauthorized', 'missing or invalid session token');
    await next();
  };
}
```

`errors.ts`: `fail(c, status, code, message, issues?)` → `c.json({ ok: false, error: {...} }, status)`; `ok(c, data, status = 200)`; `issuesOf(zodError)` → `issues.slice(0, 20).map(i => ({ path: i.path.join('.'), message: i.message }))`; `handleError(error, c)` → `OrchestratorError` → its status/code; `ApiError` (own class with status/code) → same; else log + 500 `internal_error` (message `'unexpected error'`, no stack).

`app.ts`:
```ts
export function createApp(deps: ApiDeps): Hono {
  const app = new Hono();
  app.use('/api/*', cors({ origin: [...deps.allowedOrigins], allowHeaders: ['Authorization', 'Content-Type', 'Last-Event-ID'], allowMethods: ['GET', 'POST', 'OPTIONS'] }));
  app.use('/api/*', authMiddleware(deps.token, deps.allowedOrigins));
  app.onError((error, c) => handleError(error, c, deps.logger));
  app.get('/healthz', (c) => c.json({ ok: true, data: { planner: deps.orchestrator.plannerLabel, engine: deps.orchestrator.engineLabel } }));
  registerSessionRoutes(app, deps); registerCaptureRoutes(app, deps); registerObservationRoutes(app, deps);
  registerEventRoutes(app, deps); registerControlRoutes(app, deps); registerJobRoutes(app, deps); registerTranscriptionRoutes(app, deps);
  return app;
}
```
(`plannerLabel` / `engineLabel` are part of the `Orchestrator` interface and are set in Task 10.)

Route pattern (every route body-validated with `safeParse`; example `routes/observations.ts`):
```ts
export function registerObservationRoutes(app: Hono, deps: ApiDeps): void {
  app.post('/api/sessions/:id/observations', async (c) => {
    const sessionId = c.req.param('id');
    const parsed = observationsBatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, 400, 'validation_failed', 'invalid observations batch', issuesOf(parsed.error));
    const foreign = parsed.data.observations.filter((o) => o.sessionId !== sessionId);
    if (foreign.length > 0) return fail(c, 400, 'validation_failed', `observations ${foreign.map((o) => o.id).join(', ')} belong to another session`);
    const report = await deps.orchestrator.ingestObservations(sessionId, parsed.data.observations);
    return ok(c, report, 202);
  });
}
```

`routes/events.ts`:
```ts
const KEEPALIVE_MS = 15000;
const POLL_MS = 250;
export function registerEventRoutes(app: Hono, deps: ApiDeps): void {
  app.get('/api/sessions/:id/events', (c) => {
    const sessionId = c.req.param('id');
    const snapshot = deps.orchestrator.getSnapshot(sessionId);
    if (!snapshot) return fail(c, 404, 'session_not_found', 'unknown session');
    const after = Number(c.req.header('last-event-id') ?? c.req.query('after') ?? 0) || 0;
    return streamSSE(c, async (stream) => {
      const send = (id: string, kind: string, data: unknown) => stream.writeSSE({ id, event: kind, data: JSON.stringify(data) });
      // No `id` on the snapshot frame: it must not move the client's Last-Event-ID cursor.
      await stream.writeSSE({ event: 'snapshot', data: JSON.stringify({ kind: 'snapshot', snapshot }) });
      for (const event of deps.orchestrator.listEvents(sessionId, after, 500)) await send(String(event.sequence), event.payload.kind, event);
      const queue: SessionEvent[] = [];                                   // connection-local buffer
      const unsubscribe = deps.orchestrator.subscribe(sessionId, (event) => { queue.push(event); });
      stream.onAbort(unsubscribe);
      let lastWrite = Date.now();
      while (!stream.aborted) {
        const next = queue.shift();
        if (next) { await send(String(next.sequence), next.payload.kind, next); lastWrite = Date.now(); continue; }
        if (Date.now() - lastWrite > KEEPALIVE_MS) { await stream.writeSSE({ event: 'keepalive', data: '' }); lastWrite = Date.now(); }
        await stream.sleep(POLL_MS);
      }
    });
  });
}
```
(Keepalive comment every 15 s of idleness; a 250 ms poll is fine on loopback. Replayed events between the snapshot and the live subscription cannot be lost: `subscribe` is attached before the loop starts and the store replay covers everything up to that point; a duplicate sequence is possible in the tiny race and is harmless because D dedupes by `sequence`.)

`routes/transcription.ts`: per-session token bucket `Map<sessionId, number[]>` of timestamps (last 60 s, max 5) → 429 `rate_limited`; require session exists and `capture !== 'stopped'` (409 otherwise); `await deps.transcription.negotiate(...)`.

`transcription/connector.ts`: `UnconfiguredTranscriptionConnector.negotiate` throws `new ApiError(503, 'transcription_unconfigured', "Track A's transcription connector is not registered on this server; fixture mode has no live audio")`.

- [ ] **Step 5: Run → pass; typecheck; commit**

```bash
git add apps/api
git commit -m "feat(api): Hono control API with bearer+origin auth, validated routes, and SSE events"
```

---

### Task 12: Server boot, scenario replay script, README

**Files:**
- Create: `apps/api/src/server.ts`, `apps/api/src/compose.ts`, `apps/api/scripts/replay-scenarios.ts`, `apps/api/README.md`
- Test: `apps/api/src/compose.test.ts`

**Interfaces:**
- `compose(env: ApiEnv, logger): { orchestrator; store; app; engineLabel; plannerLabel }` — pure wiring, testable without listening.
- Replay: `npm run replay -- --planner=fixture|live [--only=<id>]`. Exit 1 on any fixture-mode mismatch; in live mode print the table and exit 0 (nondeterministic; reported honestly).

- [ ] **Step 1: Failing test**

`compose.test.ts`: `compose` with `FORK_DB_PATH=':memory:'`, `FORK_PLANNER=fixture`, `FORK_ENGINE=fake` returns labels `fixture`/`FIXTURE`; with `FORK_PLANNER=live` and no key → throws a message containing `OPENAI_API_KEY`; with `FORK_ENGINE=live` → throws `"live engine adapter not wired: Track C's PrototypeEngine must be injected by the integrator (D)"` (never silently falls back to the fake).

- [ ] **Step 2: Implement**

`compose.ts`:
```ts
export function compose(env: ApiEnv, logger: Logger) {
  const store = openSqliteStore(env.dbPath);
  const projects = loadProjects(env.projectsFile);
  const engine = env.engine === 'fake' ? new FakePrototypeEngine() : liveEngineNotWired();
  const planner = env.planner === 'fixture' ? new FixturePlanner(scenarioFixtureTable()) : LlmPlanner.fromEnv(process.env, logger);
  const orchestrator = createOrchestrator({ store, engine, planner, projects, config: { settleMs: env.settleMs }, logger, companyDocsDir: env.companyDocsDir });
  const app = createApp({ orchestrator, token: env.token, allowedOrigins: env.allowedOrigins, transcription: new UnconfiguredTranscriptionConnector(), logger });
  return { store, orchestrator, app, plannerLabel: planner.label, engineLabel: env.engine === 'fake' ? 'FIXTURE' : 'live' };
}
function liveEngineNotWired(): never { throw new Error("live engine adapter not wired: Track C's PrototypeEngine must be injected by the integrator (D). Use FORK_ENGINE=fake until then."); }
```
(`scenarioFixtureTable()` = a `Map` built from every fixture's `turns.at(-1)!.id → fixtureOutput` plus `preTurns.at(-1)?.id → preOutput` when present — in fixture mode the planner only knows the scripted scenario turn ids; any other speech yields a labeled "FIXTURE: no scripted output" observe. This is stated in the README.)

`server.ts`:
```ts
const env = loadEnv(); const logger = consoleLogger;
const { app, store, orchestrator, plannerLabel, engineLabel } = compose(env, logger);
if (env.generatedToken) logger.warn('FORK_API_TOKEN not set — generated a session token for this run', { token: env.token });
const server = serve({ fetch: app.fetch, hostname: env.host, port: env.port }, (info) => logger.info('fork api listening', { url: `http://${info.address}:${info.port}`, planner: plannerLabel, engine: engineLabel, db: env.dbPath }));
const shutdown = () => { orchestrator.dispose(); server.close(); store.close(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
```
Never log the token when it came from `.env`.

`scripts/replay-scenarios.ts` — for each `ScenarioFixture` (filtered by `--only`): fresh `compose`-like in-process wiring with `:memory:` store, `settleMs: 5`, planner per flag; `createSession('demo-product' | 'blank-template')`, `setCapture start autonomy=true`, apply preconditions (`paused` → control pause; `visible_size_experiment` → ingest context + `preTurns`, `flush`, assert an experiment is visible; `running_job` → ingest context + `preTurns` (prototype_change), then wait for the first `job` event with state `running` — do **not** flush, the job must still be active when the main turn lands; `blank_template` → create the session with `projectConfigId: 'blank-template'`), ingest `contextObservation` then `turns`, `await orchestrator.flush(sessionId)`, then classify: read intents (add `listIntents(sessionId)` to the store + orchestrator for this) and experiments → `Outcome`; compare to `acceptableOutcomes`; print a table `id | expected | planner kind | outcome | PASS/FAIL | note`. Header line prints `Planner: FIXTURE (scripted replay)` or `Planner: LIVE <provider>/<modelId>` and `Engine: FIXTURE`.

`apps/api/README.md` — sections: What this is (Track B), Run (`cp .env.example .env`, `npm install`, `npm run dev:api`), Auth (bearer token, origins, EventSource `access_token` caveat), Routes table (from Task 11), Event stream semantics (snapshot-first, `Last-Event-ID`, replay), Integration notes for A (observation batches, epochs, `supersedesObservationId`, partials ignored), C (inject `PrototypeEngine` in `compose.ts`; revision rules; late results), D (snapshot getter, SSE, controls; `plannerLabel`/`engineLabel` must be displayed as "FIXTURE" badges), Fixture vs live matrix, Scenario replay, Known limits (no transcription connector until A; company docs are synthetic; `node:sqlite` version floor).

- [ ] **Step 3: Verify end-to-end**

Run, in order:
```bash
npm run typecheck && npm test
npm run replay -- --planner=fixture          # expect 10/10 PASS
FORK_DB_PATH=:memory: npm run dev:api &      # note the printed token
TOKEN=<printed> ; curl -s -X POST http://127.0.0.1:8787/api/sessions -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"projectConfigId":"demo-product"}'
curl -s -N "http://127.0.0.1:8787/api/sessions/<id>/events?access_token=$TOKEN" &    # see `event: snapshot`
curl -s -X POST http://127.0.0.1:8787/api/sessions/<id>/capture -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"action":"start","prototypeAutonomyEnabled":true}'
curl -s -X POST http://127.0.0.1:8787/api/sessions/<id>/observations -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d @scratch/suggestion-batch.json   # built from scenario fixture 'suggestion' with the session's ids/epoch
# expect: 202; SSE shows experiment(proposed) → experiment(visible) → status "Trying a larger Start trial button — Undo" → snapshot revision {1,1}
curl -s http://127.0.0.1:8787/api/sessions/<id> -H "Origin: http://evil.example" -H "Authorization: Bearer $TOKEN"   # expect 403
```
Record actual output in the commit message body / README "Verified" section. Do not claim anything that was not run.

- [ ] **Step 4: Commit**

```bash
git add apps/api
git commit -m "feat(api): server boot, scenario replay script, and Track B README"
```

---

### Task 13: Live planner verification (requires credentials — report honestly)

**Files:**
- Modify: `packages/orchestrator/src/planner/prompt.ts` (only if live replay shows systematic misses)
- Modify: `apps/api/README.md` "Verified" section

- [ ] **Step 1: Configure**

Put a real `OPENAI_API_KEY` (or `OPENROUTER_API_KEY` + `MODEL_PROVIDER=openrouter`) in `.env`. Never commit `.env`.

- [ ] **Step 2: Run live replay**

Run: `npm run replay -- --planner=live`
Expected: table with `Planner: LIVE openai/<model>`. Target ≥ 8/10 scenarios in an acceptable outcome. `pause` and `production` must be `no_experiment` regardless of planner output (gate enforces).

- [ ] **Step 3: If misses are systematic, adjust `SYSTEM_PROMPT` wording only** (not the gate), re-run, and record before/after counts. Do not add scenario-specific string matching.

- [ ] **Step 4: Update README "Verified" with the exact command, model id, date, and pass counts. If no key is available, write: "Live planner NOT verified — no credentials on this machine; fixture replay 10/10."**

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/planner/prompt.ts apps/api/README.md
git commit -m "docs(api): record live planner verification results"
```

---

## Verification (end-to-end)

1. `npm run verify` at root → typecheck clean across 4 workspaces; all `node:test` suites green.
2. `npm run test:coverage` → each B package ≥ 80 % lines.
3. `npm run replay -- --planner=fixture` → 10/10 PASS, header shows `Planner: FIXTURE`, `Engine: FIXTURE`.
4. Manual HTTP smoke (Task 12 Step 3): 401/403/400 paths, session create, capture start, observation batch → SSE shows experiment → visible with Undo status; `POST controls {kind:'undo'}` → `Reverted:` status and revision `{1,2}`.
5. Manual scenario checks from the spec's list, driven via curl using the scenario fixture batches: duplicate-turn (one experiment), pause (no mutation), correction (undo or smaller patch), ambiguity (clarification event), negation/quotation (no experiment), stale worker result (superseded, revision unchanged), Undo.
6. Live planner (Task 13) only if credentials exist; otherwise state so.

## Hand-off notes for teammates (put in `apps/api/README.md`)

- **A**: `POST /api/sessions/:id/observations` is the single ingestion path. Include the current `captureEpoch` from the latest snapshot; batches from an old epoch are reported in `staleEpoch` and ignored. Partials are accepted and dropped (captions are rendered client-side). Corrections use `supersedesObservationId`. Your transcription helper implements `TranscriptionConnector` and is registered in `apps/api/src/compose.ts`.
- **C**: implement `PrototypeEngine` from `@fork/contracts`; D swaps `FakePrototypeEngine` in `compose.ts` (`FORK_ENGINE=live`). B calls `applyPatch`/`undo` with the session's current `Revision` and discards any `runJob` result whose `basedOn` ≠ the dispatched `expectedRevision` or whose intent was superseded. `cancel(jobId)` must actually stop work.
- **D**: use `GET /api/sessions/:id` for snapshot restore, the SSE route for ordered events, `POST controls` for Pause/Resume/Stop/Undo/Cancel/Clarification. Show `/healthz` labels as "FIXTURE" badges. Root `package.json`/`tsconfig.base.json` here are minimal; merge into the starter root — keep `packages/*` and `apps/*` in `workspaces`.

## Self-review against the spec

- **Spec coverage**: routes (Task 11) ✔; runtime validation of `contracts.v2.ts` (Task 1) ✔; single SQLite store with sessions/epochs/observation dedupe/transcript+context/repo map/experiments/checkpoints (via experiment `checkpointId` + job results)/jobs/events (Task 2) ✔; settle window + bounded transcript + context-at-speech (Task 4) ✔; planner with source ids, target evidence, intended result, bounded area, action kinds (Tasks 8–9) ✔; deterministic gate incl. dedupe + revision (Task 5) ✔; coalescing, single writer, cancel, stale results, undo (Task 7) ✔; clarification with real candidate ids, expiry, later-context resolution with same dedupe key (Task 10) ✔; pause/stop semantics and no replay after resume (Tasks 4, 10) ✔; company-doc retrieval without vector index + bounded repo reads (Task 8) ✔; fake engine + fixture planner labeled and never silently substituted (Tasks 6, 12) ✔; scenario replay with expected kinds/evidence (Task 12) ✔; auth + origin checks on loopback (Task 11) ✔; transcription helper registered behind the same auth, 503 until A provides it (Task 11) ✔; no external writes possible (no route or engine op for them) ✔.
- **Placeholder scan**: no TBD/TODO; every code step shows code or an exact behaviour list; "Similar to Task N" not used.
- **Type consistency**: `StoredIntent.pendingPatch` (Task 2) ↔ `toProposal` return (Task 8) ↔ `clarification_answer` (Task 10); `targetKey` string format `element:<id>` / `job:<workspaceId>` (Task 7) used by Task 10 dispatch; `Orchestrator.flush/plannerLabel/engineLabel` added in Task 10 and consumed in Tasks 11–12; `resolvedClarificationKey` (Task 5) used in Tasks 10; `describePatchRelative` (Task 7) used in Task 10 dispatch; `IngestReport` shape (Task 1) produced by Task 4 and returned by Task 11.
- **Conflicts noted**: the spec discourages generating test suites *in the meeting loop*; the user's global rules require TDD for B's own code — this plan tests B's logic (not the demo app), which satisfies both. `checkpoints` are not a separate table (kept small per spec) — recorded on experiments and job results.
