# C handoff to A, B, and D

Branch: `feat/local-prototyper`. C owns the local execution engine, prepared source copy, checkpoint artifacts, Codex subprocess, and preview server. C does not choose meeting intent, own session state, capture audio, post Slack messages, or build another meeting UI.

The canonical adapter shape is the supplied root `contracts.v2.ts`, imported through C's `src/types.ts`. This implementation does not change shared contracts or any other track's files. The legacy `mode: "demo_only"` value is retained for compatibility: execution and edits are real, but permissions remain scoped to the local prepared project.

## B: consume the engine

Build C first, then add `@fork/prototype-engine` as the local workspace dependency using D's root package manager. Until root integration lands, direct import of the built entry also works:

```ts
import { createPrototypeEngine } from '@fork/prototype-engine';
// Temporary standalone path from the repository root:
// ./packages/prototype-engine/dist/packages/prototype-engine/src/index.js

const engine = await createPrototypeEngine({
  runtimeRoot: hostConfig.runtimeRoot,
  hostOrigin: hostConfig.meetingOrigin,
  projects: hostConfig.projects,
  collectorScriptPath: hostConfig.collectorBundle,
  // B owns the event sequence and durable journal. C's sequence is local diagnostic ordering.
  onEvent(event) {
    publishStatusForWorkspace(event.workspaceId, event.message);
  },
  isCurrent: job => scheduler.isCurrent(job.id, job.intentId),
});

const prepared = await engine.prepare({
  sessionId,
  projectConfigId: 'blank',
  mode: 'blank_template',
});
// Persist prepared.workspaceId, revision, previewUrl, and repoMap in B's authoritative store.

const result = await engine.runJob({
  id: jobId,
  experimentId,
  sessionId,
  workspaceId: prepared.workspaceId,
  intentId,
  expectedRevision: prepared.revision,
  brief: 'Add a searchable list to this page.',
  relevantSources: [], // Or current C-provided source refs with their exact file fingerprints.
  constraints: ['Keep the existing navigation.'],
  mockedIntegrations: [], // Declare simulations only when explicitly requested; never fake a connection.
  mode: 'demo_only',
  verification: 'compile_and_render',
}, progress => {
  persistAndPublishJobProgress(progress); // Existing WorkerProgress fits payload.kind='job'.
}, abortSignal);
```

The callbacks above are illustrative B services, not exports from C. They should enqueue bounded status delivery without throwing or performing slow synchronous work. `onEvent` adds command/file detail; the existing shared output union can carry its human-readable text through `kind: "status"`. Agree with D before adding a richer shared event schema.

### Methods and outputs

| Method | What to consume |
| --- | --- |
| `prepare(request)` | Actual `workspaceId`, source/config revision, verified source fingerprints, preview URL, readiness. Idempotent for the same session/project configuration. |
| `runJob(job, progress, signal?)` | Actual worker progress and final `PrototypeResult`: state, based/resulting revisions, checkpoint, changed files, URL, diagnostics, and declared simulations. |
| `applyPatch(request)` | Persisted config edit. `applied` is true only after a browser check confirms the component rendered the requested value. |
| `undo(request)` | Latest-checkpoint restoration, with a new monotonic revision. Checkpoint IDs are workspace-bound. B must also verify host/session ownership because the supplied Undo request has no sessionId. |
| `cancel(jobId)` | `{accepted:true}` acknowledges cancellation only. Wait for `runJob` to settle after process termination/restoration. |
| `getWorkspace(workspaceId)` | C extension: current snapshot plus private source path, startup description, last checkpoint, render evidence, and registered element-to-source mappings. |
| `getChanges(workspaceId, checkpointId)` | C extension: local before/after file contents, capped at 100 KB per side. Private host/review use only. |
| `close()` | Cancel active work, finish restoration, stop owned processes/browser, release the runtime lock. |

An operation ID is scoped to its workspace. Identical completed requests return their recorded result. Reusing an ID with different content is rejected. Failed/recovered changes can advance revisions even when content returns to an earlier checkpoint. Always reconcile `resultingRevision`; do not set it to the old revision after Undo.

B serializes source edits, config patches, and Undo. C rejects overlap rather than building another queue. On correction, B invalidates the current intent, requests cancellation, waits for C to settle, refreshes the revision/context, then dispatches the new request. `isCurrent` also prevents an obsolete completed job from being accepted.

Pause: B stops new dispatches and permits the current job to finish. Cancel: stop active execution and restore. Stop: disable new dispatches, cancel active work, await settlement, and close C if the session is ending. A owns capture shutdown.

Validate all request schemas, session authorization, project choice, origin, and observation/intent evidence in B. C additionally rejects unknown projects, session mismatches, stale revisions/source refs, unsupported patches, and path escapes. Do not forward raw browser DOM or meeting text as host configuration.

`ready` proves compile/render, not complete behavioral acceptance or backend success. A failed job can return the restored preview URL while its `check` records the failed attempt; use `getWorkspace` for the recovered preview's current check. `previewUrl: null` with recovery diagnostics means the workspace cannot safely continue.

On restart, call `prepare` for the same session/project. C conservatively rejects live old processes and restores a persisted interrupted checkpoint once safe. Retrying an interrupted operation ID returns `INTERRUPTED_OPERATION`; B must reconcile and create a fresh intent rather than replay old speech. Do not delete a live engine lock.

## A: attach real preview context

Provide a self-contained browser ES module as `collectorScriptPath`. C injects it into the preview on the preview's own origin. It must contain no credentials or Node imports; bundle dependencies into the file.

Your collector publishes its bounded snapshot through:

```js
function attach() {
  // Use A's actual collector here. Pass only the preview's bounded element/context metadata.
  const publish = snapshot => window.forkPreview.publishContext(snapshot);
  startYourCollector(publish);
  window.addEventListener('fork.preview.revision', () => recaptureCurrentPreview(publish));
}
if (window.forkPreview) attach();
else window.addEventListener('fork.preview.available', attach, { once: true });
```

`startYourCollector` and `recaptureCurrentPreview` are placeholders for A's own implementation. C supplies the transport, not another generic perception collector. Without A's bundle, C reports only registered template elements as a clearly limited development fallback. Once A publishes, C stops its fallback collection.

Snapshot input: `elements`, `focusId`, optional `hover` and `selection`. Each element has `id`, `role`, `label`, `visible`, `box`, and `editable`. C bounds strings/elements, strips unknown fields/source claims, adds its workspace/revision/instance envelope, and obtains route/viewport from the actual preview. Do not collect input values, passwords, transcript text, or whole-desktop content.

D receives `fork.preview.context`. A adds its real `sessionId`, `captureEpoch`, observation ID/time/version and converts the payload into `PreviewContextObservation` for B. B rejects stale revisions/capture epochs. C's `getWorkspace().registeredElements` supplies configured source mappings with current file fingerprints; DOM source claims are never trusted.

## D: render the preview and activity

```ts
import { connectPreview } from '@fork/prototype-engine/preview';

iframe.src = prepared.previewUrl;
iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
iframe.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'");
const disconnect = connectPreview({
  iframe,
  previewUrl: prepared.previewUrl,
  workspaceId: prepared.workspaceId,
  onMessage(message) {
    if (message.type === 'fork.preview.context') forwardContextToA(message);
    if (message.type === 'fork.preview.error') showPreviewError(message.payload);
    // Rendered messages are untrusted UI evidence, not authority to complete a B job.
  },
});
// Call disconnect() when changing/removing the iframe.
```

The configured `hostOrigin` must exactly match the actual meeting page (`localhost` and `127.0.0.1` are different origins). C's CSP allows that origin to frame the preview. The connector validates `event.origin`, `event.source`, workspace identity, basic envelope shape, and payload size. B still validates observations and revision freshness.

Preview envelopes use `version:1`, `type`, `workspaceId`, `revision`, `operationId`, `instanceId`, and `payload`. Supported outbound types: `fork.preview.context`, `fork.preview.rendered`, `fork.preview.error`. Source/config revision counters are integers; `instanceId` changes with each preview server startup. Payloads contain no control token.

Optional host refresh hint:

```ts
iframe.contentWindow?.postMessage({
  type: 'fork.preview.load-config', workspaceId: prepared.workspaceId,
}, new URL(prepared.previewUrl).origin);
```

This only asks the preview to refresh authoritative metadata. Config mutations always go D → authenticated B control → C `applyPatch`, never through `postMessage`.

Show B's job state and C's activity as escaped text. Render errors may be visible briefly during HMR. Distinguish editing, checking, restoring, and ready; do not translate every bridge render event into job success. Keep terminal output collapsible and bounded. Keep the source path/diff out of the iframe and Slack.

Root integration: add/build C with the existing root toolchain; its standalone npm lock belongs only to C until D integrates dependencies into the root lock. Do not upgrade unrelated starter/CopilotKit dependencies to accommodate C. Startup needs Node, Chromium provisioning, an authenticated Codex home, configured projects, and an exact meeting origin. C does not need another listening control service.

## Fast-patch registration

The blank template registers `start-button` in `src/main.jsx` and consumes `public/fork-config.json` (`{ "elements": { "start-button": { ... } } }`). Existing projects must explicitly implement that config consumption and register their real source path/properties in host configuration; otherwise use source jobs.

The initial token contract is intentionally small: size `sm/md/lg/xl` maps to padding `8/12`, `12/20`, `18/28`, `24/36` px (vertical/horizontal); radius `none/sm/md/pill` maps to `0/4/10/999` px. Palette values are the exact colors in the prepared template. Labels are plain text up to 200 characters; visibility is boolean. C verifies the computed result and rolls back if it did not appear. No arbitrary CSS, selectors, HTML, shell command, or JavaScript is accepted as a fast patch.

## Integration completion

C can be locally qualified while A/B/D are unfinished. The integrated feature is done only after actual speech/context flows through A/B to C, D displays the real preview/progress, and D's correction/cancel/Undo controls affect that same workspace. See VERIFICATION.md for which parts were live versus manually driven; do not infer integrated completion from the local driver.
