# Fork Track B — silent orchestrator

The private control plane for Fork: **state, contextual intent, the deterministic action gate, and
the single-writer scheduler**. This process is the only authoritative writer of session state and
the only thing allowed to schedule a change to the demo workspace.

Owned by Track B: `apps/api/`, `packages/contracts/`, `packages/orchestrator/`, `packages/state/`,
`fixtures/company/`. Track A sends observations, Track C executes changes, Track D renders state and
owns the root workspace integration.

```
A transcript + preview context ─▶ POST /observations
                                      │  settle window (configurable, default 1200 ms)
                                      ▼
                            contextual planner (one structured service)
                                      │
                            deterministic gate (after inference)
                                      │
                     single-writer scheduler ──▶ C's PrototypeEngine
                                      │
                            ordered SessionEvent stream (SSE) ──▶ D
```

## Run it

```bash
cp .env.example .env          # from the repo root; no model key needed for fixture mode
npm install
npm run dev:api               # http://127.0.0.1:8787
```

The boot log names what is actually wired:

```json
{"level":"info","message":"fork control api listening","url":"http://127.0.0.1:8787",
 "planner":"fixture","engine":"FIXTURE","db":"/…/.data/fork.sqlite"}
```

`GET /healthz` reports the same two labels. **If it says `FIXTURE`, nothing real was generated.**

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `FORK_API_HOST` / `FORK_API_PORT` | `127.0.0.1` / `8787` | Loopback bind. Do not expose this port. |
| `FORK_API_TOKEN` | *(generated)* | Shared secret for A/C/D. When unset, a token is generated and printed once at boot. |
| `FORK_ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Browser origins allowed to call the API. |
| `FORK_DB_PATH` | `./.data/fork.sqlite` | SQLite file, or `:memory:`. Relative paths resolve from the repo root. |
| `FORK_PLANNER` | `fixture` | `fixture` = scripted replay, no model call. `live` = real model via `MODEL_PROVIDER`. |
| `FORK_ENGINE` | `fake` | `fake` = labelled in-memory engine. `live` = C's adapter (see below). |
| `FORK_SETTLE_MS` | `1200` | How long the room must stop talking before a planning pass runs. |
| `FORK_PROJECTS_FILE` | `./fork.projects.json` | Server-side project allowlist. |
| `FORK_COMPANY_DOCS_DIR` | `./fixtures/company` | Synthetic company notes used for retrieval. |

Model settings reuse the starter kit's names exactly (`MODEL_PROVIDER`, `MODEL`, `OPENAI_API_KEY`,
`OPENROUTER_API_KEY`), so one root `.env` configures both the kit and Fork.

## Routes

All routes are under `/api`, require `Authorization: Bearer <FORK_API_TOKEN>`, and return
`{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message", "issues"? } }`.

| Method + path | Body | Returns |
|---|---|---|
| `POST /api/sessions` | `{ projectConfigId }` | `201 { snapshot, repoMap }` |
| `GET /api/sessions/:id` | — | `{ snapshot, events }` (last 200 events) |
| `POST /api/sessions/:id/capture` | `{ action: start\|pause\|stop, prototypeAutonomyEnabled? }` | `{ snapshot }` |
| `POST /api/sessions/:id/transcription-connection` | `{ sdp? }` | short-lived credential; `503` until A registers a connector; 5/min/session |
| `POST /api/sessions/:id/observations` | `{ observations: Observation[1..100] }` | `202 IngestReport` |
| `GET /api/sessions/:id/events` | — | SSE: `snapshot` first, then ordered replay, then live |
| `POST /api/sessions/:id/controls` | `SessionControl` | `{ snapshot }` |
| `GET /api/jobs/:id` | — | the worker's actual job state and result |
| `GET /healthz` | — | `{ planner, engine }` (no token required) |

`projectConfigId` selects a **server-configured** project. A path supplied by a browser, transcript,
or model is never accepted.

### Security boundary

Loopback is not authorization — an untrusted page in the host's browser can reach `127.0.0.1`. So
every call needs the token, and any request carrying an `Origin` header must carry an allowlisted
one (`403 forbidden_origin` otherwise). `EventSource` cannot set headers, so **the event stream
alone** also accepts `?access_token=`; every other route rejects it.

There is no route that pushes, deploys, creates an issue, sends mail, or writes to any external
system. Session prototype autonomy covers reversible changes to one disposable workspace and nothing
else.

### Event stream semantics

The stream opens with a `snapshot` frame that carries **no** SSE `id`, so a reconnect never skips
events the client has not seen. Every persisted event then arrives with its per-session `sequence`
as the SSE `id`. Reconnect with `Last-Event-ID` (or `?after=`) to replay from a cursor; a keepalive
comment is sent after 15 s of silence. A replayed event can repeat once in a narrow race — dedupe by
`sequence`.

## Integration notes

**Track A — observations.** `POST /api/sessions/:id/observations` is the single ingestion path.

- Include the `captureEpoch` from the latest snapshot. Observations from an older epoch come back in
  `staleEpoch` and are ignored, so a reconnect cannot replay old speech into new code actions.
- `phase: "partial"` deltas are accepted and dropped (`ignoredPartials`); render captions yourself.
  Only finalized turns are eligible for planning.
- A corrected segment carries `supersedesObservationId`; the superseded turn stops being eligible.
- Observation `id` is the idempotency key and is globally unique. Re-delivery is reported in
  `duplicates` and changes nothing.
- Re-emit a `preview_context` observation whenever the preview changes. The gate refuses a patch that
  cites a screen snapshot older than the current preview revision (`stale_context`), which is exactly
  what stops a stale DOM override from overwriting newer layout.
- Speech captured before the session resumed is stored and skipped, never planned.
- Your authenticated negotiation helper implements `TranscriptionConnector`
  (`src/transcription/connector.ts`) and is registered in `src/compose.ts`. Until then that route
  reports `503 transcription_unconfigured` — a setup blocker, never fake text.

**Track C — engine.** Implement `PrototypeEngine` from `@fork/contracts`, then swap
`FakePrototypeEngine` in `src/compose.ts` and set `FORK_ENGINE=live`. Requesting `live` without a
wired adapter throws at boot rather than falling back to the fake.

- B calls `applyPatch` / `undo` with the session's current `Revision` and expects an honest
  `applied: false` when it no longer matches.
- B discards any `runJob` result whose `basedOn` differs from the dispatched `expectedRevision`, or
  whose intent was superseded while the job ran: the experiment becomes `superseded`, the preview
  revision is untouched, and the status line says a late result was discarded.
- `cancel(jobId)` must actually stop the worker; B also aborts the `AbortSignal` it passed.
- Only one job runs per session at a time; queued work on the same target is coalesced.

**Track D — UI and Slack.** Use `GET /api/sessions/:id` to restore after reconnect, the SSE route for
ordered events, and `POST /api/sessions/:id/controls` for Pause, Resume, Stop, Undo, Cancel, and the
clarification answer. Show the `/healthz` labels as badges — a `FIXTURE` run must look like one.
Root `package.json` / `tsconfig.base.json` here are deliberately minimal; merge them into the
starter root and keep `packages/*` and `apps/*` in `workspaces`.

## Scenario replay

```bash
npm run replay -- --planner=fixture      # deterministic; exits non-zero on regression
npm run replay -- --planner=live         # real model; a report, not a gate
npm run replay -- --only=structural
```

Fixture mode replays `scenarios.json` through the **real** orchestrator (ingest → settle → planner →
gate → scheduler → engine) with a scripted planner and the labelled fixture engine. In that mode the
planner only knows the scripted scenario turns; any other speech yields a labelled
`FIXTURE: no scripted output`.

## Verified (2026-09-12)

Live on this machine, Node v25.6.1:

- `npm run typecheck && npm test` — 4 workspaces, **195 tests passing**, 0 failing
  (contracts 16, state 8, orchestrator 133, api 38).
- `npm run test:coverage` line coverage: contracts 100%, state 96.6%, orchestrator 90.1%, api 83.8%.
- `npm run replay -- --planner=fixture` — **10/10** scenarios reached an acceptable outcome:
  `suggestion` preview_patch visible · `negation`/`quotation`/`production` no experiment ·
  `ambiguity` clarification shown · `correction` smaller patch · `structural`/`from_zero` job ready ·
  `pause` refused before planning · `late_result` first job superseded.
- Real HTTP round trip against `npm run start` on `127.0.0.1:8799`:
  - no token → `401`; `Origin: http://evil.example` → `403`; unknown route → `404`
  - `POST /api/sessions` → session created, `revision {source:1,config:0}`
  - `POST …/capture {action:"start",prototypeAutonomyEnabled:true}` → `listening`, autonomy `true`
  - `POST …/observations` (3 observations) → `202 {"accepted":3,"duplicates":[],"staleEpoch":[],"ignoredPartials":0}`
  - snapshot after the settle window → `revision {source:1,config:1}`,
    `currentTopic "Start trial button"`, one `visible` experiment
    "Trying a larger Start trial button", status `Trying a larger Start trial button — Undo`
  - SSE stream delivered `snapshot` (no id) then `experiment` ×3, `status`, `snapshot`
  - `POST …/controls {kind:"undo"}` → `200`, experiment `reverted`, `revision {source:1,config:2}`,
    status `Reverted: Trying a larger Start trial button`

**Not verified:** the live planner path (`FORK_PLANNER=live`) — no model credentials are present on
this machine, so no model call has been made. The code path is implemented and unit-tested against a
stubbed generator; it has not been run against a real model. The live engine path
(`FORK_ENGINE=live`) is unwired by design until Track C delivers its adapter. No Slack, Codex, or
audio integration is exercised by this track.

## Known limits

- `node:sqlite` requires Node ≥ 22.13 (the store fails at startup with a clear message otherwise).
- Company notes in `fixtures/company/` are synthetic and labelled as such in their first line.
- Repository excerpts are read on demand from an allowlisted workspace root only, capped at a few
  files and lines, and credential-shaped filenames are never read.
- `Exa` is not used: no private transcript or code is sent to a search provider.
- Reconciling a fast patch that lost a revision race is reported as a failure with a visible reason;
  automatic re-planning of that patch onto the newer revision is deliberately out of scope for now.
