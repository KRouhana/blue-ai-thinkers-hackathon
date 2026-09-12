# Track A - continuous audio and screen perception

Read `00-shared-contract.md` first. Implement only A on `feat/audio-perception`.

## Goal

Supply a silent planner with reliable finalized speech and structured evidence about the prototype currently visible. We need continuous listening after host enablement, not a command recognizer or speaking agent.

Own `packages/perception/` and optionally `apps/mac-capture/`. D owns the meeting React application and will import your capture controls and collector. B owns the API. C owns preview runtime/source mapping. Do not create competing roots or a second backend.

## Build order

1. Define a capture adapter that sends typed observations through an injected sink. Supply an explicit fixture mode so it runs without the backend.
2. Implement actual browser microphone capture with visible status and transcription-only streaming. No TTS, voice replies, wake-word detection, or push-to-talk requirement.
3. Export small start/pause/stop and microphone-status components for D. Retain an optional typed transcript input as a visibly labeled debugging fallback.
4. Implement the preview-context collector and coordinate its injection with C. D hosts the preview bridge. The collector emits evidence, never mutations.
5. Exercise real room speech. Only then attempt remote system-audio support if needed.

## Transcription

Use current official OpenAI Realtime transcription docs and installed SDK types. Choose a configurable transcription model supported by the team's actual credentials. The current guide recommends `gpt-live-transcribe`; verify availability and do not silently replace an unavailable live service with fake text. Do not copy an older speech-to-speech session configuration.

Use provider-supported WebRTC/browser negotiation or a server WebSocket audio pipeline. B registers your authenticated server helper for short-lived connection setup. Long-lived API credentials stay server-side. Scope and rate-limit the setup endpoint. Do not put account API keys in frontend environment variables.

Show deltas as captions only. Emit finalized turns with provider item ID, local audio-turn sequence, segment version, capture epoch, and received timestamp. Use the provider's actual item/turn relationships to restore audio order, not completion arrival order. Do not fabricate a sequence from arbitrary item-ID strings. Report uncertainty if ordering cannot be recovered.

Handle reconnect, duplicate finals, delayed finals, silence, mic disconnect, and capture-session changes. Old buffered speech must not become new actions after Pause/Resume. A corrected segment carries its prior ID/revision instead of looking like a brand-new suggestion.

Speaker identity is optional and unverified. Current realtime transcription must not be assumed to return speaker labels, word timings, or confidence. Use capture timestamps and unknown speaker labels honestly. We do not need to identify the AVP to edit a demo.

## Screen-context collector

Collect only inside the demo preview, not arbitrary browsing activity. Emit the displayed route, viewport, bounded visible element records, accessible names/text, roles, bounding boxes, nearby section labels, and stable element IDs when available. Never collect password values, tokens, hidden input values, or unrelated tabs.

Include focus, hover, and recent selection with timestamps. Selection is optional, not mandatory. Collect on route/meaningful DOM/focus changes and throttle/debounce noisy updates. Use C's registry/source references where available; do not invent source files from a DOM element.

Use a strict versioned postMessage bridge with exact origin/source checks. Send a bounded payload, not a full document dump. B chooses targets. Hover is one clue, not a command. Optional preview-only screenshots are a fallback, not continuous desktop video.

## Real meeting audio

For the default co-located demo, use one room microphone on the host Mac. Provide clear capture indication and participant notice; retain no raw audio by default. Document what leaves the machine for transcription.

A browser microphone alone does not capture remote voices played through headphones. For a remote Huddle, implement a permissioned Mac system/app-audio adapter using a verified ScreenCaptureKit path or configured audio input device. Confirm the host OS and permissions; do not promise generic browser tab/system-audio capture works on all Mac browsers. Keep local-mic and remote-audio tracks separated or mix once with timestamps; avoid counting echo twice.

This optional helper is not a Slack bot. Do not automate a user account or pretend the Slack Calls API supplies media.

## Hand-off and acceptance

Give D your component imports, lifecycle functions, and event sink signature. Give B example ordered final turns and context snapshots conforming to v2. No server DB writes, code generation, or planner decisions in A.

Demonstrate real continuous speech without saying Fork, correct captions, no audible response, stop actually closing audio, and a timestamped page/element snapshot. Use manual scenarios and the existing typecheck; no requirement to generate a test suite.

Report live audio verification separately from fixture mode. Missing credentials or OS permissions are explicit setup blockers, not success.
