import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';
import { test } from 'node:test';
import { loadEnv } from './env';

test('defaults keep the control API on loopback with the fixture planner and engine', () => {
  const env = loadEnv({});
  assert.equal(env.host, '127.0.0.1');
  assert.equal(env.port, 8787);
  assert.equal(env.planner, 'fixture');
  assert.equal(env.engine, 'fake');
  assert.equal(env.settleMs, 1200);
  assert.deepEqual(env.allowedOrigins, ['http://localhost:3000', 'http://127.0.0.1:3000']);
});

test('a blank token is generated for the run and flagged as generated', () => {
  const generated = loadEnv({});
  assert.equal(generated.generatedToken, true);
  assert.ok(generated.token.length >= 32, `token too short: ${generated.token.length}`);
  const supplied = loadEnv({ FORK_API_TOKEN: ' supplied-token ' });
  assert.equal(supplied.generatedToken, false);
  assert.equal(supplied.token, 'supplied-token');
});

test('an unparsable port fails with the variable name', () => {
  assert.throws(() => loadEnv({ FORK_API_PORT: 'abc' }), /FORK_API_PORT/);
  assert.throws(() => loadEnv({ FORK_PLANNER: 'magic' }), /FORK_PLANNER/);
});

test('origins are split and trimmed', () => {
  assert.deepEqual(loadEnv({ FORK_ALLOWED_ORIGINS: ' http://a , http://b ,' }).allowedOrigins, ['http://a', 'http://b']);
});

test('relative paths resolve from the repo root, and :memory: is left alone', () => {
  const env = loadEnv({ FORK_PROJECTS_FILE: './fork.projects.json', FORK_DB_PATH: ':memory:', FORK_COMPANY_DOCS_DIR: './fixtures/company' });
  assert.ok(isAbsolute(env.projectsFile), env.projectsFile);
  assert.match(env.projectsFile, /fork\.projects\.json$/);
  assert.ok(isAbsolute(env.companyDocsDir));
  assert.equal(env.dbPath, ':memory:');
  assert.ok(isAbsolute(loadEnv({ FORK_DB_PATH: './.data/fork.sqlite' }).dbPath));
});
