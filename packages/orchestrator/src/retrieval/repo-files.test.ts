import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { RepoMap } from '@fork/contracts';
import { readRepoExcerpts } from './repo-files';

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'fork-repo-'));
  mkdirSync(join(root, 'src', 'pages'), { recursive: true });
  writeFileSync(join(root, 'src', 'pages', 'Tasks.tsx'), Array.from({ length: 150 }, (_, index) => `line ${index + 1}`).join('\n'));
  writeFileSync(join(root, 'secret.env'), 'OPENAI_API_KEY=should-never-be-read');
  return root;
}

const repoMap = (paths: string[]): RepoMap => ({
  workspaceId: 'demo-1', origin: 'existing_repo', fingerprint: 'f', framework: { name: 'react-vite', verified: true },
  routes: [{ route: '/tasks', sources: paths.map((path) => ({ kind: 'repo', path, fingerprint: 'abc' })) }],
  relevantSources: [], mockCapabilities: [], limitations: [],
});

test('reads only the route sources that stay inside the workspace, truncated to the line budget', async () => {
  const root = workspace();
  const excerpts = await readRepoExcerpts(root, repoMap(['src/pages/Tasks.tsx', '../outside.ts', '/etc/passwd']), '/tasks', 3, 10);
  assert.deepEqual(excerpts.map((excerpt) => excerpt.path), ['src/pages/Tasks.tsx']);
  assert.equal(excerpts[0]?.excerpt.split('\n').length, 10);
  assert.match(excerpts[0]?.excerpt ?? '', /^line 1\n/);
});

test('never reads credential-shaped files even when the map lists them', async () => {
  const root = workspace();
  const excerpts = await readRepoExcerpts(root, repoMap(['secret.env']), '/tasks', 3, 10);
  assert.deepEqual(excerpts, []);
});

test('a missing file is skipped, not fatal', async () => {
  const root = workspace();
  const excerpts = await readRepoExcerpts(root, repoMap(['src/pages/Missing.tsx']), '/tasks', 3, 10);
  assert.deepEqual(excerpts, []);
});

test('no workspace root or no repo map yields no excerpts', async () => {
  assert.deepEqual(await readRepoExcerpts(null, repoMap(['src/pages/Tasks.tsx']), '/tasks', 3, 10), []);
  assert.deepEqual(await readRepoExcerpts(workspace(), null, '/tasks', 3, 10), []);
});

test('falls back to the map-level relevant sources when the route is unknown', async () => {
  const root = workspace();
  const map: RepoMap = { ...repoMap([]), relevantSources: [{ kind: 'repo', path: 'src/pages/Tasks.tsx', fingerprint: 'abc' }] };
  const excerpts = await readRepoExcerpts(root, map, '/unknown', 3, 5);
  assert.deepEqual(excerpts.map((excerpt) => excerpt.path), ['src/pages/Tasks.tsx']);
});

test('the file budget is respected', async () => {
  const root = workspace();
  mkdirSync(join(root, 'src', 'extra'), { recursive: true });
  for (const name of ['a.tsx', 'b.tsx', 'c.tsx']) writeFileSync(join(root, 'src', 'extra', name), 'content');
  const map = repoMap(['src/extra/a.tsx', 'src/extra/b.tsx', 'src/extra/c.tsx']);
  assert.equal((await readRepoExcerpts(root, map, '/tasks', 2, 5)).length, 2);
});
