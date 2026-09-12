/** @jsxRuntime automatic */
/** @jsxImportSource @copilotkit/channels */
import { Actions, Button, Context, Header, Message, Section, type InteractionContext } from '@copilotkit/channels';
import type { Result, Command } from './service';

export type Click = (command: Command, context: InteractionContext) => Promise<void>;
// Snapshot text may originate from discussion/model output. Render it as content,
// never as Slack mention/link syntax that can notify people or conceal a URL.
function safeSummary(value: string, limit: number) {
  return value.slice(0, limit).replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function workspaceLink(base: string, sessionId: string) {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid FORK_MEETING_URL.');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('FORK_MEETING_URL must address the local host workspace.');
  url.searchParams.set('session', sessionId);
  return url.href;
}

export function helpCard(click: Click) {
  return <Message>
    <Header>Fork · session controls</Header>
    <Section>Mention Fork with start, open, status, pause, stop, or recap. Only the configured session host can start or control a session.</Section>
    <Actions><Button style="primary" onClick={context => click('start', context)}>Start / open session</Button></Actions>
    <Context>Slack messaging is connected separately from Huddles. Joining a Huddle and agent-controlled screen sharing are not available in this adapter.</Context>
  </Message>;
}

export function resultCard(result: Result, meetingUrl: string, click: Click) {
  if (result.kind === 'help') return helpCard(click);
  const session = result.snapshot;
  const changes = session.experiments.slice(-5);
  const mocks = [...new Set(session.experiments.flatMap(change => change.mockNotes))].slice(0, 4);
  const requestPending = result.requested && session.capture !== (result.requested === 'stop' ? 'stopped' : 'paused');
  return <Message>
    <Header>{result.recap ? 'Fork · session recap' : 'Fork · meeting workspace'}</Header>
    <Section>{`Capture: ${session.capture}. Automatic demo changes: ${session.prototypeAutonomyEnabled ? 'enabled' : 'disabled'}.`}</Section>
    {requestPending && <Section>{`${result.requested === 'stop' ? 'Stop' : 'Pause'} requested; the service has not confirmed the final capture state. Request status to refresh.`}</Section>}
    <Section>{session.currentTopic ? `Current topic: ${safeSummary(session.currentTopic, 300)}` : 'Waiting for meeting context.'}</Section>
    {result.recap && <Section>{changes.length ? changes.map(change => `${change.status}: ${safeSummary(change.summary, 180)}`).join('\n') : 'No prototype changes recorded.'}</Section>}
    {mocks.length > 0 && <Section>{`Mock data / simulated behavior: ${mocks.map(note => safeSummary(note, 150)).join('; ')}`}</Section>}
    <Actions>
      <Button url={workspaceLink(meetingUrl, session.id)}>Open on host Mac</Button>
      <Button onClick={context => click('status', context)}>Refresh status</Button>
      <Button onClick={context => click('pause', context)}>Pause</Button>
      <Button style="danger" onClick={context => click('stop', context)}>Stop / recap</Button>
    </Actions>
    <Context>For the operator on the demo Mac only. Other attendees cannot reach that Mac through this localhost link. Capture requires local permission and the participant notice; a Slack button does not activate a microphone.</Context>
  </Message>;
}

export function errorCard(message: string) {
  return <Message><Header>Fork · action unavailable</Header><Section>{message}</Section><Context>Mention Fork with status to retry. No successful action is implied by this message.</Context></Message>;
}
