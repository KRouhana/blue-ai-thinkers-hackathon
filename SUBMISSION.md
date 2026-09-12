# Fork integration — provenance and capability record

## Product

Fork is intended to participate in a Slack Huddle, understand a team’s evolving brainstorm, and build/present an interactive demo using mock data. Track D connects the Slack surface, local meeting workspace, and teammates’ capture/orchestration/preview services.

## Inherited infrastructure

- Agents, Everywhere starter: managed CopilotKit Channels architecture, native card APIs, pinned Channels/runtime pairing and deduped AG-UI dependency convention. Preserved documentation/license lives in `docs/starter`.
- Supplied Fork planning documents and proposed `contracts.v2.ts`: team ownership, session events, controls, revision and experiment types.
- Standard TypeScript, Node.js, React/Vite, and Zod dependencies. Their presence is not a claim that the sponsor service connections are live.

## New Track D work

- Meeting workspace with an isolated large preview, activity/build state, local session notice, explicit capture availability, reversible controls, clarification, and visible connection/error states.
- D-facing adapters for B’s HTTP/SSE session service, A’s capture lifecycle, and C’s constrained preview messages; validation and event recovery at the integration boundaries.
- Managed Channels Slack session cards and control/recap flow, linked by persisted thread/session/host identifiers and guarded host actions.
- Local development launcher, configuration example, integration tests, and teammate handoff instructions. Teammates’ core implementations are not replaced.

## Prepared demonstration assets

The Orbit task board is a neutral, prepared fixture with mock tasks and an interactive overdue filter. Its larger-button, color-correction, build/check/ready, clarification, and failure events are deterministic fixtures advanced by an explicit button. No code-generation work or inference occurred when those fixture events were emitted. Fixture badges must remain visible in recordings using this fallback.

## Live capabilities and setup limits

| Capability | Current implementation / verification boundary |
| --- | --- |
| Local D workspace and prepared preview | Runnable fixture mode; local checks exercise UI and adapter behavior |
| B session API and orchestration | Client boundary implemented; teammate service and credentials required |
| A microphone/meeting capture and transcription | Adapter boundary implemented; default explicitly unavailable |
| C Codex source builds, checkpoints, and real preview | Contract consumer implemented; teammate worker required |
| Real Slack delivery | Native Channels integration implemented; actual account setup and reply must be verified separately |
| Recap | Reconstructed by fresh Slack recap/stop request; unsolicited delayed delivery not claimed |
| Slack Huddle participant, speaker identity, autonomous sharing | Not connected or verified; Slack exposes no media-participant API. Remains a human screen-share |
| Google Meet participant (camera showing the live prototype) | `apps/meet-bot`: joins via the third-party Recall.ai meeting-bot API, webpage-as-camera. Requires a Recall account, a public tunnel for the presenter URL, and host admission of the guest; not end-to-end verified against a live Meet call in this checkout (no Recall API key available) |
| Public preview or deployment | None; links identify the local operator’s machine |
| Real demo databases/services | None by default; prepared mock data only |

Do not report microphone/Slack/Codex connections, speaker coverage, autonomous Huddle sharing, latency, or build times as demonstrated without recording the corresponding real verification. Root automated checks verify code behavior, not those external integrations. Keep `.env`, local thread mappings, tokens, and any company source out of public submissions.
