# C: local prototype engine

C turns B's resolved request into a real local Codex source edit and a verified localhost preview. It includes a small command driver so C can be exercised while A/B/D are being integrated. The driver uses the same engine and real SDK; it contains no simulated worker.

Start with [HANDOFF.md](./HANDOFF.md) for the A/B/D interfaces and [VERIFICATION.md](./VERIFICATION.md) for observed acceptance results.

## Run independently

Requirements: macOS, Node 22.12 or later, a working Codex login, and network access for model inference. Runtime and model processes are local; inference is remote. No Docker daemon is required. The SDK includes its pinned Codex executable.

From the repository root:

```sh
npm --prefix packages/prototype-engine ci --ignore-scripts
npm --prefix packages/prototype-engine run build
npm --prefix packages/prototype-engine run browser:install
npm --prefix packages/prototype-engine run local
```

Inside the local driver:

```text
prepare
job Add a searchable list of four sample tasks, with case-insensitive filtering and an empty state. Preserve StartButton and its configuration behavior.
status
patch start-button lg
undo
diff
cancel
quit
```

Wait for each mutation to finish. `cancel` may be entered while a job runs. Output is JSON lines: `prepared`, `event`, `progress`, `result`, `patch`, `undo`, `workspace`, `diff`, or `error`. Open the exact `previewUrl` returned by prepare; its loopback port is allocated dynamically. Preview content persists in the printed private `sourcePath`. `quit` closes the worker/browser/server and releases its lock.

`ready` means C checked compilation/module loading and browser rendering. It does not claim every requested interaction or external integration works. Exercise the actual changed interaction before marking product behavior accepted.

## Existing repository / explicit configuration

Provide a local JSON configuration file and keep it out of Git. It contains host-selected paths, never paths inferred from speech:

```json
{
  "runtimeRoot": "/private/tmp/fork-meeting",
  "hostOrigin": "http://localhost:3000",
  "projects": [
    { "id": "blank" },
    {
      "id": "existing",
      "sourcePath": "/absolute/path/to/reviewed-react-vite-project",
      "dependencyPath": "/absolute/path/to/reviewed-react-vite-project/node_modules",
      "route": "/"
    }
  ],
  "jobTimeoutMs": 180000,
  "renderTimeoutMs": 20000
}
```

```sh
npm --prefix packages/prototype-engine run local -- --config /absolute/path/to/c.local.json
```

Then `prepare existing meeting-001`. Existing projects need installed dependencies and a root `index.html`; C executes its controlled Vite server, not the repository's startup/install hooks. It ignores project `vite.config.*` and `.env` files. Projects requiring custom aliases/plugins, SSR, a backend, external services, or another framework are not qualified by this release. A failure is reported; C does not silently swap in a mock.

Optional host configuration: `model`, `codexPath` (a compatible executable), `codexHome` (an existing authenticated Codex home), `browserExecutable`, and `collectorScriptPath` (A's self-contained browser module). User Codex configuration and rules are ignored for this worker so unrelated tools/providers are not inherited. Credentials remain in the configured Codex home; generated shell commands cannot read it. C does not modify your login or Codex settings.

The default runtime directory is the OS temporary directory plus `fork-c-<uid>`. Choose a durable host-owned `runtimeRoot` outside Fork and outside the original project if you want work to outlive OS temporary-file cleanup. C copies permitted source files, including dirty/untracked source; the original checkout is untouched. Dependency directories are mounted read-only by symlink, not copied or modified. Common credential files/content are excluded; the host must still review a project before onboarding it.

## Scope and practical limits

- One C process per runtime root and one active mutation. B owns its queue. Another mutation fails with `WORKSPACE_BUSY`.
- Initial source limits: 3000 files, 2 MB per file, 40 MB total. Maximum 100 completed operations per session bounds checkpoint storage. Keep/export the source and start a new session when needed.
- Undo restores the latest applicable checkpoint; undoing an Undo acts as redo. It is not an arbitrary historical merge/revert tool.
- Commands have no network and cannot modify manifests, lockfiles, dependency directories, or unrelated host files. Dependencies must be provisioned during setup.
- Generated preview processes have read-only source access, writable caches, and only their own loopback listener. Browser CSP blocks external connections, framing, and form submissions.
- Source changes use actual HMR and may briefly expose partial edits. The UI must show editing/checking/restoring, not promise atomic visual promotion.
- Changes are retained in the private prepared source directory. `getChanges`/`diff` exposes a local before/after artifact. Committing or copying changes to the original project remains a deliberate host operation.
- Do not expose the dev server publicly. B owns authentication/origin validation for all control requests. The preview has no mutation API.

## Troubleshooting

`SANDBOX_UNAVAILABLE`: run from a normal host terminal and inspect the error. Nested sandboxes may refuse native sandbox creation. Do not disable C's sandbox or use full-access flags.

`CODEX_FAILED` / auth error: verify login with the configured Codex executable/home. Desktop login alone is not proof; a real C job is the acceptance check.

`WORKSPACE_CONFLICT`: someone changed the disposable source outside C. Preserve the directory and prepare a new session; C deliberately will not reset over unknown edits.

`STALE_REVISION` / `STALE_SOURCE`: B must refresh state/context and re-evaluate the request. Do not blindly update the revision on an old intent.

`RECOVERY_REQUIRED`: stop any old owned worker process first. On a safe restart, prepare the same session/project to restore an interrupted checkpoint. Ambiguous live processes are not killed by PID guesswork. An unrecoverable render failure blocks further mutations.

No tests or test suites are included. Development verification uses typechecking, the actual engine, browser interactions, and explicitly recorded manual fault injection.
