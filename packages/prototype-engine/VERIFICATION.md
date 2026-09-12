# C manual verification

Date: 2026-09-12. Host: macOS arm64. Runtime observed during the live driver: Node 26.7.0; Codex SDK/runtime 0.154.0; Vite 7.3.6; React 19.3.0; Playwright/Chromium provisioning 1.63.0. Authentication: an actual job succeeded using the host's existing ChatGPT login. No credentials or user Codex settings were changed.

No tests or test suites were written. Verification used the compiled engine, its local driver, real Codex jobs, the engine's render verifier, and manual in-app-browser interaction.

## Live results

| Check | Observed result |
| --- | --- |
| Build/typecheck | `npm --prefix packages/prototype-engine run build` and `run typecheck` passed. |
| Dependency install | Pinned package install completed with zero vulnerabilities reported by npm at installation time. |
| Worker isolation | Native sandbox preflight wrote only to the prepared cache and denied reading the configured Codex credential file. Homebrew runtime library/loader allowances were corrected without allowing the user's home. |
| Blank preview | Prepared a neutral template, started an isolated loopback Vite server, and verified compile/render at revision `{source:0,config:0}`. |
| Real source generation | Job `e6385ba7-8f38-4842-b6d1-cf9a07bbdba7` edited `src/main.jsx` to add a searchable four-item sample list; result was ready at `{source:1,config:0}`. |
| Generated behavior | Manual browser input `REVIEW` showed only “Review prototype”; `no-such-task` showed the empty state; clearing the input restored all four items. |
| Follow-up | Job `55832f48-7259-4cd1-9ef9-19d7fb2ac094` added a live count to the same source/workspace. Browser showed “4 of 4 tasks,” then “1 of 4 tasks” when filtering. |
| Source Undo | Undo restored the prior searchable list without the count, with a new monotonic source/config revision. |
| Restart persistence | Closed and restarted C; prepare recovered the same workspace/source and revisions, with a new actual loopback port. The generated search feature remained present. |
| Real cancellation after edits | Job `1a90146b-5ebb-4e83-8e83-6d3d09661ac9` changed the heading and started a real `sleep 120` command. Cancel was accepted; execution stopped, checkpoint restoration rendered, and the job settled as cancelled at `{source:6,config:3}`. A process-name-only check found no remaining worker Codex binary or sleep process; unrelated desktop Codex processes remained untouched. |
| Persistent fast patch | Operation `manual-size-lg-1` produced `{source:6,config:4}`. Browser computed padding was `18px 28px`, including after reload. |
| Fast-patch Undo | Undo restored computed padding to `12px 20px`; the generated list remained present. |
| Duplicate request | Resending the identical `manual-size-lg-1` request returned the original result/checkpoint/revision without another edit. |
| Conflicting ID | Reusing that ID for a different size produced `OPERATION_CONFLICT`. |
| Stale request | A new operation using the previous revision produced `STALE_REVISION`. |
| Existing project | Prepared an actual local Git repository containing the previously generated React/Vite app, dirty source/CSS, and an untracked note. All seven original-file fingerprints remained identical after preparation, patch failure, and rollback; Git still showed the original dirty/untracked state. This was a controlled local onboarding input, not a claim of qualifying an arbitrary production repository. |
| Copy exclusions | The prepared copy retained dirty CSS and the untracked note, and excluded `.git` and the local `.env` marker. |
| Failed render / rollback | The existing-project input contained a deliberate runtime exception for the `xl` size. The real browser detected failure; operation `8f09726d-69db-400e-bde4-8e342e320cff` returned `applied:false`, restored a verified working preview at `{source:3,config:5}`, and a subsequent `lg` patch succeeded. |
| Recovery after restart | Restarting the earlier blocked runtime restored its recorded checkpoint and rendered at `{source:2,config:3}`. Interrupted operation IDs are fenced from automatic replay. |
| Actual Codex repair | During job `b3f957b3-45d2-49e6-a014-58ac55fab128`, a one-off syntax error was manually injected into the disposable source. The visible browser showed Vite's compile-error overlay. C detected HTTP 500/failed rendering, invoked one real Codex repair, and verified the repaired page at `{source:9,config:5}`. The browser showed the requested “Live workspace” heading and intact task list. |
| Preview bridge / D connector | A temporary loopback iframe inspection page imported C's actual `connectPreview` export. It received `fork.preview.rendered` and `fork.preview.context` at `{source:9,config:5}`, with the correct workspace ID and one registered element. The real app rendered inside the separate-origin sandboxed iframe. The inspection page was explicitly labeled as not connected to A/B/D. |
| Shutdown | `quit` completed after closing both prepared previews and the verification browser. The engine lock was removed and zero owned PID records remained. The temporary iframe-inspection listener was also stopped. |

The sample task data was explicitly requested for this local interaction check. Code generation, authentication, terminal execution, file edits, Vite, browser checks, and Undo were live. A typed driver request supplied the intent; audio, planner, and Slack were not simulated and were not claimed to be connected.

## Fixes found by the manual pass

- Homebrew Node needed explicit runtime library/config read paths, and the preview loader needed to open the filesystem root. Those runtime allowances were added while preserving home/credential restrictions.
- Vite's asynchronous file watcher briefly served stale modules after rollback. C now waits for an explicit child-process module-cache invalidation acknowledgment before opening its verification page. The deliberately failed patch was repeated and recovered successfully after this fix.
- A broad key-redaction pattern incorrectly masked `task-search`. It was restricted to credential-like token lengths and boundaries.

The deliberate syntax/runtime faults were manual failure injection, not spontaneous model failures or simulated successful integrations. Source repair and config rollback were both exercised; exhaustion of the repair attempt followed by source rollback was not separately forced. Hard power loss, arbitrary process-detachment attacks, quota exhaustion, and a long meeting soak remain unqualified beyond the bounded recovery/deadline implementation.

Final build and typecheck passed after the fixes. No test/spec files or suites were added. C is ready for integration within the documented local Mac / React-Vite scope; the full A-D meeting flow remains the next acceptance gate.

## Integration boundary

A's actual collector bundle, B's actual planner/scheduler/state, and D's actual meeting shell/Slack are not present on this branch. Their adapter hooks and consumption instructions are in HANDOFF.md. An integrated speech-to-preview claim requires those workflows to connect and run the same scenario with real meeting input.

Only the documented local Mac / React-Vite stack is qualified. Other existing projects must pass their own preparation and interaction checks. These results do not establish arbitrary-repository support or real external backend integrations.
