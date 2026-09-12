// Manual local input through the real B planner and C worker; this is not microphone capture.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

async function main() {
  const words = process.argv.slice(2);
  const sessionFlag = words.indexOf('--session');
  let sessionId;
  if (sessionFlag >= 0) [ , sessionId ] = words.splice(sessionFlag, 2);
  else sessionId = JSON.parse(await readFile('.data/local-session.json', 'utf8')).sessionId;
  if (!/^ses_[\w-]+$/.test(sessionId ?? '')) throw new Error('Pass --session with the session ID from the local page URL.');
  const text = words.join(' ').trim();
  if (!text || text.length > 4000) throw new Error('Usage: npm run say -- [--session ses_...] "A change to the sample prototype"');
  const origin = new URL(process.env.FORK_API_BASE ?? 'http://127.0.0.1:8787');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.protocol !== 'http:') throw new Error('Manual input is restricted to the local HTTP control API.');
  if (!process.env.FORK_API_TOKEN) throw new Error('FORK_API_TOKEN is missing from .env.');
  const headers = { Authorization: `Bearer ${process.env.FORK_API_TOKEN}`, 'Content-Type': 'application/json' };
  async function request(suffix, body) {
    const response = await fetch(`${origin.origin}/api/sessions/${sessionId}${suffix}`, {
      headers, method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error?.message ?? `Local API returned ${response.status}`);
    return result.data;
  }
  let { snapshot } = await request('');
  if (snapshot.capture !== 'listening' || !snapshot.prototypeAutonomyEnabled) {
    ({ snapshot } = await request('/capture', { action: 'start', prototypeAutonomyEnabled: true }));
  }
  const result = await request('/observations', { observations: [{
    id: randomUUID(), sessionId, captureEpoch: snapshot.captureEpoch, capturedAt: new Date().toISOString(), version: 1,
    kind: 'transcript', phase: 'final', providerItemId: randomUUID(), audioTurnSequence: Date.now(), orderReliable: true,
    streamId: 'manual-local-input', text, speaker: { label: null, verified: false },
  }] });
  console.log(`Manual text accepted: ${result.accepted}. Watch the local preview and npm run dev terminal for the actual result.`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
