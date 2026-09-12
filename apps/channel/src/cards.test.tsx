import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToIR } from '@copilotkit/channels';
import { renderSlackMessage } from '@copilotkit/channels/slack/render';
import { resultCard, workspaceLink } from './cards';

test('native Slack cards label local links, mocks and pending control outcomes', () => {
  const card = resultCard({ kind: 'session', recap: true, requested: 'stop', snapshot: {
    id: 'session-one', captureEpoch: 'e', capture: 'listening', prototypeAutonomyEnabled: true,
    workspaceId: 'workspace', revision: { source: 1, config: 2 }, previewUrl: 'http://127.0.0.1:4173',
    currentTopic: 'A task manager <!here> [ping](!here)', lastEventSequence: 3, clarification: null,
    experiments: [{ id: 'change', intentId: 'intent', status: 'visible', summary: 'Add overdue filter', origin: 'inferred_experiment', sourceObservationIds: [], revision: { source: 1, config: 2 }, checkpointId: 'checkpoint', mockNotes: ['Tasks are sample data'] }],
  } }, 'http://127.0.0.1:3000', async () => undefined);
  const rendered = renderSlackMessage(renderToIR(card));
  const serialized = JSON.stringify(rendered);
  assert.ok(rendered.blocks.length > 0);
  assert.match(serialized, /Fork · session recap/);
  assert.match(serialized, /Stop requested/);
  assert.match(serialized, /Tasks are sample data/);
  assert.match(serialized, /Other attendees cannot reach that Mac through this localhost link/);
  assert.match(serialized, /http:\/\/127\.0\.0\.1:3000\/\?session=session-one/);
  assert.doesNotMatch(serialized, /4173|checkpoint/);
  assert.doesNotMatch(serialized, /<!here/);
  assert.match(serialized, /&lt;!here&gt;/);
});

test('host workspace links cannot target public services or contain credentials', () => {
  assert.throws(() => workspaceLink('https://public.example', 'id'), /local host/);
  assert.throws(() => workspaceLink('http://token@localhost:3000', 'id'), /Invalid/);
  assert.throws(() => workspaceLink('http://localhost:3000?token=secret', 'id'), /Invalid/);
  assert.equal(new URL(workspaceLink('http://localhost:3000', 'a/b')).searchParams.get('session'), 'a/b');
});
