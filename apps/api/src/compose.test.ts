import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { silentLogger } from '@fork/orchestrator';
import { compose } from './compose';
import { loadEnv } from './env';

const baseEnv = () => loadEnv({ FORK_DB_PATH: ':memory:', FORK_API_TOKEN: 'compose-test-token' });
// This repo checkout itself, canonicalized the same way C's engine guards its runtime root.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

test('the default composition is labelled fixture end to end', async () => {
  const composed = await compose(baseEnv(), silentLogger);
  assert.equal(composed.plannerLabel, 'fixture');
  assert.equal(composed.engineLabel, 'FIXTURE');
  assert.equal(composed.orchestrator.plannerLabel, 'fixture');
  composed.orchestrator.dispose();
  composed.store.close();
});

test('the live engine is really Track C\'s: it enforces C\'s own runtime-root guard', async () => {
  const env = { ...baseEnv(), engine: 'live' as const, engineRuntimeRoot: REPO_ROOT };
  // C's LocalPrototypeEngine.create refuses a runtimeRoot inside the Fork repo itself
  // (INVALID_WORKSPACE); reaching that specific, real C-side error proves this composes
  // a genuine C engine instance rather than a stub, without needing a full prepare() run.
  await assert.rejects(compose(env, silentLogger), /INVALID_WORKSPACE/);
});

test('asking for the live planner without credentials names the missing variable', async () => {
  const env = { ...baseEnv(), planner: 'live' as const };
  const saved = { provider: process.env.MODEL_PROVIDER, openai: process.env.OPENAI_API_KEY, router: process.env.OPENROUTER_API_KEY };
  process.env.MODEL_PROVIDER = 'openai';
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    await assert.rejects(compose(env, silentLogger), /OPENAI_API_KEY/);
  } finally {
    if (saved.provider === undefined) delete process.env.MODEL_PROVIDER; else process.env.MODEL_PROVIDER = saved.provider;
    if (saved.openai !== undefined) process.env.OPENAI_API_KEY = saved.openai;
    if (saved.router !== undefined) process.env.OPENROUTER_API_KEY = saved.router;
  }
});

test('the composed app serves the health check with the wired labels', async () => {
  const composed = await compose(baseEnv(), silentLogger);
  const response = await composed.app.request('/healthz');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()), { ok: true, data: { planner: 'fixture', engine: 'FIXTURE' } });
  composed.orchestrator.dispose();
  composed.store.close();
});
