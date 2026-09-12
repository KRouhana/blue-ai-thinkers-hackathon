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

The sample task data was explicitly requested for this local interaction check. Code generation, authentication, terminal execution, file edits, Vite, browser checks, and Undo were live. A typed driver request supplied the intent; audio, planner, and Slack were not simulated and were not claimed to be connected.

## Remaining qualification in progress

- Existing-project onboarding with dirty/untracked source and original-file fingerprints.
- Deliberately failed render and verified checkpoint recovery.
- Final shutdown/process cleanup and final revision of the A/B/D handoff.

## Integration boundary

A's actual collector bundle, B's actual planner/scheduler/state, and D's actual meeting shell/Slack are not present on this branch. Their adapter hooks and consumption instructions are in HANDOFF.md. An integrated speech-to-preview claim requires those workflows to connect and run the same scenario with real meeting input.

Only the documented local Mac / React-Vite stack is qualified. Other existing projects must pass their own preparation and interaction checks. These results do not establish arbitrary-repository support or real external backend integrations.
