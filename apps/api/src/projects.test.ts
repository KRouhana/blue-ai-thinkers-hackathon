import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadProjects } from './projects';

const REPO_ALLOWLIST = fileURLToPath(new URL('../../../fork.projects.json', import.meta.url));

function write(contents: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), 'fork-projects-')), 'fork.projects.json');
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return path;
}

test('the repository allowlist loads and offers both preparation modes', () => {
  const projects = loadProjects(REPO_ALLOWLIST);
  assert.deepEqual(projects.map((project) => project.id).sort(), ['blank-template', 'demo-product']);
  assert.ok(projects.every((project) => project.workspaceRoot === null));
});

test('a missing or unparsable file fails loudly with its path', () => {
  assert.throws(() => loadProjects('/nonexistent/fork.projects.json'), /Could not read the project allowlist/);
  assert.throws(() => loadProjects(write('{ not json')), /Could not read the project allowlist/);
});

test('a relative workspaceRoot is rejected: setup supplies absolute paths', () => {
  const path = write({ projects: [{ id: 'demo', label: 'Demo', mode: 'existing_repo', workspaceRoot: './somewhere' }] });
  assert.throws(() => loadProjects(path), /absolute workspaceRoot/);
});

test('unknown fields, bad ids, and duplicates are rejected', () => {
  assert.throws(() => loadProjects(write({ projects: [{ id: 'demo', label: 'D', mode: 'existing_repo', workspaceRoot: null, extra: 1 }] })), /Invalid project allowlist/);
  assert.throws(() => loadProjects(write({ projects: [{ id: '../escape', label: 'D', mode: 'existing_repo', workspaceRoot: null }] })), /Invalid project allowlist/);
  assert.throws(() => loadProjects(write({ projects: [] })), /Invalid project allowlist/);
  const duplicate = { id: 'demo', label: 'D', mode: 'existing_repo' as const, workspaceRoot: null };
  assert.throws(() => loadProjects(write({ projects: [duplicate, duplicate] })), /Duplicate project ids/);
});

test('an absolute workspaceRoot is accepted for an existing repository', () => {
  const path = write({ projects: [{ id: 'real', label: 'Real', mode: 'existing_repo', workspaceRoot: '/Users/demo/app' }] });
  assert.equal(loadProjects(path)[0]?.workspaceRoot, '/Users/demo/app');
});
