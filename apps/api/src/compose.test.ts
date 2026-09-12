import assert from 'node:assert/strict';
import { test } from 'node:test';
import { silentLogger } from '@fork/orchestrator';
import { compose } from './compose';
import { loadEnv } from './env';

const baseEnv = () => loadEnv({ FORK_DB_PATH: ':memory:', FORK_API_TOKEN: 'compose-test-token' });

test('the default composition is labelled fixture end to end', () => {
  const composed = compose(baseEnv(), silentLogger);
  assert.equal(composed.plannerLabel, 'fixture');
  assert.equal(composed.engineLabel, 'FIXTURE');
  assert.equal(composed.orchestrator.plannerLabel, 'fixture');
  composed.orchestrator.dispose();
  composed.store.close();
});

test('asking for the live engine fails loudly instead of falling back to the fake', () => {
  const env = { ...baseEnv(), engine: 'live' as const };
  assert.throws(() => compose(env, silentLogger), /live engine adapter not wired/);
});

test('asking for the live planner without credentials names the missing variable', () => {
  const env = { ...baseEnv(), planner: 'live' as const };
  const saved = { provider: process.env.MODEL_PROVIDER, openai: process.env.OPENAI_API_KEY, router: process.env.OPENROUTER_API_KEY };
  process.env.MODEL_PROVIDER = 'openai';
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    assert.throws(() => compose(env, silentLogger), /OPENAI_API_KEY/);
  } finally {
    if (saved.provider === undefined) delete process.env.MODEL_PROVIDER; else process.env.MODEL_PROVIDER = saved.provider;
    if (saved.openai !== undefined) process.env.OPENAI_API_KEY = saved.openai;
    if (saved.router !== undefined) process.env.OPENROUTER_API_KEY = saved.router;
  }
});

test('the composed app serves the health check with the wired labels', async () => {
  const composed = compose(baseEnv(), silentLogger);
  const response = await composed.app.request('/healthz');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()) as unknown, { ok: true, data: { planner: 'fixture', engine: 'FIXTURE' } });
  composed.orchestrator.dispose();
  composed.store.close();
});
