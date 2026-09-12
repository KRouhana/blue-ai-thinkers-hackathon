import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePlannerModel } from './model';

test('openai: an explicit provider plus key resolves the configured model id', () => {
  const resolved = resolvePlannerModel({ MODEL_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', MODEL: 'gpt-test' });
  assert.equal(resolved.provider, 'openai');
  assert.equal(resolved.modelId, 'gpt-test');
});

test('openai: a provider prefix in MODEL is stripped and the kit default applies when MODEL is absent', () => {
  assert.equal(resolvePlannerModel({ MODEL_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', MODEL: 'openai:gpt-test' }).modelId, 'gpt-test');
  assert.equal(resolvePlannerModel({ MODEL_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', MODEL: 'openai/gpt-test' }).modelId, 'gpt-test');
  assert.equal(resolvePlannerModel({ OPENAI_API_KEY: 'sk-test' }).modelId, 'gpt-5.6-sol');
});

test('openrouter: an OpenRouter key selects it and publisher slugs are preserved', () => {
  const bare = resolvePlannerModel({ OPENROUTER_API_KEY: 'sk-or-test', MODEL: 'gpt-test' });
  assert.equal(bare.provider, 'openrouter');
  assert.equal(bare.modelId, 'openai/gpt-test');
  const slug = resolvePlannerModel({ MODEL_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-or-test', MODEL: 'meta-llama/llama-test:free' });
  assert.equal(slug.modelId, 'meta-llama/llama-test:free');
});

test('a missing or placeholder key fails with the variable name', () => {
  assert.throws(() => resolvePlannerModel({ MODEL_PROVIDER: 'openai' }), /OPENAI_API_KEY/);
  assert.throws(() => resolvePlannerModel({ MODEL_PROVIDER: 'openai', OPENAI_API_KEY: 'stub-replace-me' }), /OPENAI_API_KEY/);
  assert.throws(() => resolvePlannerModel({ MODEL_PROVIDER: 'openrouter' }), /OPENROUTER_API_KEY/);
});

test('an unsupported provider is a configuration error, not a silent fallback', () => {
  assert.throws(() => resolvePlannerModel({ MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test' }), /Unsupported MODEL_PROVIDER/);
});
