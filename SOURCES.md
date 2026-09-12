# Primary references checked for this pack

Checked September 12, 2026. Recheck installed types and the official docs during implementation. Sponsor APIs can evolve. The app routes/types in this pack are our proposed contract, not official endpoints.

1. OpenAI Realtime transcription: https://developers.openai.com/api/docs/guides/realtime-transcription
   Supports transcription-only live audio sessions, deltas/finals, and WebRTC/WebSocket paths. Current guide recommends gpt-live-transcribe. Completion arrival order is not guaranteed; the documented model does not supply speaker labels, word-level timestamps, or confidence scores. Actual model access must be verified.
2. OpenAI transcription overview: https://developers.openai.com/api/docs/guides/transcription
   Distinguishes live transcription from file transcription and speaker-labeled alternatives.
3. Official Codex TypeScript SDK: https://github.com/openai/codex/tree/main/sdk/typescript
   Inspect the README and installed ThreadOptions/Codex options for the actual streaming, workspace, environment, approval, and sandbox surfaces.
4. Codex SDK guide: https://developers.openai.com/codex/sdk
5. Slack Calls API: https://docs.slack.dev/apis/web-api/using-the-calls-api/
   Integrates external-call metadata and join links, not the call's audio transport.
6. Slack Huddle status event: https://docs.slack.dev/reference/events/user_huddle_changed/
   A user status notification, not a media stream.
7. Slack Huddle usage: https://slack.com/help/articles/4402059015315-Use-huddles-in-Slack
   Documents human screen sharing and current participant limits (free: two; paid: up to fifty at this check).
8. Apple ScreenCaptureKit: https://developer.apple.com/documentation/screencapturekit
   Permissioned screen/app/audio capture. Verify OS-specific availability and integration on the actual demo Mac.
9. Vite HMR: https://vite.dev/guide/api-hmr
   The selected template's hot-module-replacement capability; other frameworks need their own supported development workflow.
10. Starter: https://github.com/CopilotKit/agents-everywhere-starter-kit
11. Starter channel setup: https://github.com/CopilotKit/agents-everywhere-starter-kit/blob/main/apps/channel/README.md
12. Starter implementation instructions: https://github.com/CopilotKit/agents-everywhere-starter-kit/blob/main/AGENTS.md
13. CopilotKit native Slack UI: https://docs.copilotkit.ai/slack/rich-messages
14. CopilotKit deployment: https://docs.copilotkit.ai/slack/deploy-and-operate

All behavior policies, team assignments, suggested paths/ports, latency tradeoffs, mock-data rules, and application interfaces are design recommendations, not claims of currently implemented behavior.
