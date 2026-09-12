# Track D - Slack, meeting workspace, and integration

Read `00-shared-contract.md` first. Implement only D on `feat/slack-workspace`.

## Goal and ownership

Make the four tracks feel like one silent coworker. Slack starts/records the session. A browser workspace on the Mac shows the live prototype while a human shares it in the Huddle. Do not build a videoconference platform or fake bot participant.

Own `apps/channel/`, `apps/meeting/`, root workspace/scripts/lockfile, and integration docs. B owns API/contracts, A audio/perception components, and C preview/builder. Import their packages instead of rewriting them. Coordinate contract changes with B and avoid changing colleagues' directories.

## Preserve the starter

Inspect git status and existing implementation. Preserve all useful v1 work. If no app exists, use the official Agents, Everywhere starter kit rather than a new unrelated scaffold.

Read its README, AGENTS.md, hackathon materials, apps/channel/README.md, and .agents/skills/build-channels-agent/SKILL.md before touching Slack. Follow actual installed APIs. Keep the pinned/deduped dependency pairing; do not independently upgrade CopilotKit packages. Channels JSX is not ordinary browser React.

Existing managed Channels setup is the default. Do not add a second Bolt bot or separate authentication flow unless required by a verified integration limitation. Run the maintained setup instructions and distinguish account setup from a successful real Slack reply. Never print credentials.

## Meeting shell

Build a single large preview surface with a narrow activity strip/sidebar. Import A's capture lifecycle controls and components. Show the actual capture source, listening/paused state, current experiment, compile/build status, mock-data badge, and quiet clarification choices.

Always provide Pause, Resume, Undo, Stop, and an explicit way to cancel an active structural change. No audible replies. No wake-word UI. No required manual selection for ordinary edits. Optional click-to-identify is allowed for unresolved ambiguity.

On first local start show the participant notice and scope: "Fork can make reversible changes to this demo workspace. It will not change the original repository or deploy anything." The host grants this once. Start microphone capture locally with real permissions; a remote Slack control does not bypass those permissions.

The preview iframe is isolated from the trusted controller. Validate origin/source and use the narrow shared bridge. Do not pass credentials, auth capabilities, or arbitrary code through postMessage. Subscribe to B's ordered events; restore a snapshot after reconnect. A renderer-ready acknowledgment is not proof a real backend integration works.

Preserve the working preview through errors where possible. A small "Trying a larger Start trial button - Undo" status makes proactive changes understandable without breaking conversation. Keep transcript captions optional/collapsible so the demo remains the focus.

## Slack experience

Use native CopilotKit cards for start/open session, status, pause, and a concise end-of-meeting recap. Create one linked session per intended thread and avoid flooding it with every transcript segment or pixel change.

Persist only necessary channel/thread/message identifiers using supported APIs. Verify any delayed posting/updating mechanism rather than holding delivery-scoped objects forever. When unavailable, a fresh status request should reconstruct the latest state.

Post a clearly labeled local-host link for the Mac operator. Do not tell other attendees that localhost reaches the same machine. The demonstration path is human Huddle screen share. A remote public preview link is optional and must expose only sanitized preview content, never B's control/API routes or a source-revealing dev server without deliberate protection.

No unofficial Huddle audio API, automated bot screen-sharing claim, hidden user login, or fake participant in a UI. Document that normal Slack calls metadata APIs are not media transport. Four actual Huddle participants may require a suitable workspace plan; check current Slack limits during setup.

## Integrator responsibilities

Merge the shared baseline and B's contract first, then integrate each minimal slice rather than waiting for completed components. Own final root manifests and lockfile. Preserve everyone's unrelated uncommitted work. Use file-specific staging in a shared working tree; separate worktrees are preferred.

Create one documented development command to start the trusted controller, Slack listener, meeting shell, and preview adapter as appropriate. Keep the processes alive on the local Mac during the demo; show account/permission failures instead of silent mocks. Separate control and preview origins. Do not publish credentials or company code in a public submission.

Use clearly labeled fixture events while teammates work. Remove fixture mode from the actual live demonstration or explicitly label a fallback. End-of-meeting ticket draft is optional; only build live issue creation if the existing implementation is already usable and requires authenticated exact-payload approval.

## Demo and acceptance

Run the sequence in DEMO.md: ordinary unaddressed speech -> grounded visual change -> correction -> mocked structural feature -> recap. Let a person share the actual preview browser window in Slack. Verify that listeners can see it and that capture covers the people claimed.

Report microphone/Slack/Codex connections that were actually live, supported repository stack, actual local access method, and remaining setup limits. Update README/SUBMISSION to distinguish inherited infrastructure, prepared neutral fixtures, and new event work. Do not invent build times or verification results.
