# Fork v2 demo: the meeting becomes the prototype

This is a proposed script, not evidence the implementation already works.

## Preflight

Use one configured Slack workspace/channel, the demo Mac, an authorized model connection, and a prepared neutral frontend template plus a separate small existing web application. Use synthetic company documents/data. Check actual workspace Huddle participant limits. Start the companion, enable the scoped prototype session after notice, and have one person share its browser window in the Huddle.

Default to co-located room audio. For remote attendees, verify the system/app-audio input separately; headphones are not captured by a normal room mic. Do not claim a bot joined the Huddle. Show no API tokens or production applications on screen.

## Main scenario: an existing product

Open the target's signup/sample-workspace view. Let Fork collect the route, two button labels, and relevant component references. Keep the subject of conversation clear without selecting an element merely to make the demo work.

Engineer: "The Start trial button is too small compared to everything around it. What if it were bigger?"

Expected: a size experiment appears, with a small Undo label. No name or command addressed to Fork. No voice response. The action should be explained by the real visible button name and context, not a scripted string-to-output shortcut.

Manager: "That is too big. Let's go back one size."

Expected: a grounded correction, not a second unrelated code generation job.

Engineer: "The sample workspace would be more useful if we could filter those tasks to overdue ones. We can use example dates for now."

Expected: a real coding job produces an interactive mock-data overdue filter in the local application. No external API, tests, or production backend is generated. Show the actual build state and only show success after the preview renders.

Manager: "Could that other button be red?"

Expected: if the referent is genuinely ambiguous, a quiet on-screen question with candidates; otherwise a small experiment with a grounded target. Do not force a question merely for the script and do not guess to make the demo look flawless.

Engineer: "I mean the Explore sample button."

Expected: pending ambiguity resolves without a wake word. The experiment is still not marked approved for production.

Stop the session. Slack receives a concise recap: experiments tried, latest preview, constraints discovered, and which behavior is mocked. Optional ticket draft remains a draft until explicitly approved.

## Secondary scenario: from zero

Select a new blank prepared template.

"We're imagining an operations request board: show a list with owners and status, and let us filter urgent requests. Use mock requests."

Expected: the planner waits for the complete scoped idea, then builds one view with mock data. The prepared framework should be disclosed; the actual request board must be generated in the live run or explicitly identified as a recorded run.

## Negative and recovery checks

Use off-topic talk, a quoted suggestion that is rejected, a negation, and a pause. None should cause an unwanted edit. Try an unsupported backend integration and expect a labeled mock/limitation, not an invented success. Confirm Undo and recovery from a failed compile.

The product's success is not "the agent always edits something." It is that it makes relevant experiments without being addressed, and remains quiet or visibly uncertain when context is insufficient.
