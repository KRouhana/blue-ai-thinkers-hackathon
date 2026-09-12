# Fork v2: four-person, silent meeting coworker

This pack supersedes the earlier three-person voice-assistant plan. It contains implementation prompts and proposed application interfaces, not a working application or verified live integrations.

## The product we are now building

A team talks normally in a meeting. Fork listens with permission, combines the conversation with what is on the prototype screen and relevant repository context, and quietly creates reversible demo changes on a local Mac. No wake word. No push-to-talk for the normal experience. No spoken replies in the MVP. Synthetic data and simulated integrations are encouraged and visibly labeled.

Fork can begin from a blank frontend template or continue an allowlisted existing repository. It works on a disposable demo copy, never the original application or production systems. A prototype suggestion is not a team decision or permission to ship.

Slack is the entry point and shared record. The Mac companion captures audio and runs/shows the prototype. For the first demo, a human shares that browser window into the Slack Huddle. This pack does not claim a normal Slack bot joins Huddles or receives their media.

## The four assignments

| Owner | Track prompt | Owned implementation |
|---|---|---|
| A | `01-audio-and-perception-codex.md` | Audio capture, transcription-only adapter, screen-context collector |
| B | `02-silent-orchestrator-codex.md` | Shared contracts/API/state, contextual intent, repository/document retrieval, scheduling |
| C | `03-local-prototype-worker-codex.md` | Demo repository boot, live edits, local Codex worker, preview bridge and rollback |
| D | `04-slack-workspace-integration-codex.md` | CopilotKit Slack, meeting shell, root integration and demo setup |

B owns shared API/types; D owns root workspace files, lockfile, and merge integration. A and C implement packages against the supplied interfaces, independently of the live backend. D imports A's components rather than rewriting capture.

## How to start in parallel

Commit these files under `docs/parallel-v2/` on the team's common baseline. Each teammate uses a separate clone or worktree on one branch:

- `feat/audio-perception`
- `feat/silent-orchestrator`
- `feat/local-prototyper`
- `feat/slack-workspace`

Read `00-shared-contract.md`, then the assigned prompt. B installs `contracts.v2.ts` in the app's contracts package and adds runtime validation. Do not paste all four prompts into four agents and ask each to build everything.

A uses a recorded/synthetic event sink. B uses a fake builder. C uses fixture build jobs. D uses a clearly labeled fixture event source. None of these fakes may silently replace a failed live integration.

Use `CODEX-UPDATE.md` to redirect an already-running Codex session. Preserve working code from v1 where compatible; do not re-scaffold or delete teammates' work.

## First integrated slice

A finalized typed transcript plus real page context -> B chooses a target -> C changes a registered button -> D displays the update and Undo. No wake word and no required selection click. A adds actual speech to this same path. Then integrate one real Codex structural change.

## What we deliberately cut

No TTS, full meeting-provider bot, automatic screen-share controller, autonomous production deployment, mandatory two-option decision flow, vector database, full Trello board, mandatory test generation, or ticket-system dependency in the demo loop. GitHub ticket drafting is an optional end-of-meeting step. Real issue creation still requires explicit authenticated approval.

No promises of arbitrary-app compatibility or instantaneous structural code generation. Ship a real local demonstration on a documented supported frontend stack.

Read `DEMO.md` for the demonstration and `SOURCES.md` for checked primary references.
