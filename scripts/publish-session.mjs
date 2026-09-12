#!/usr/bin/env node
// End-of-session publish: takes C's generated prototype workspace (a directory C
// prepared/edited, e.g. via its local driver's `prepare`/`job` commands) and
// pushes it to a new branch here, then opens a GitHub Issue linking to it so the
// brainstorm's output isn't lost when the meeting ends.
//
// Manual/CLI today: D has no live handle on C's workspace path without B, which
// doesn't exist yet. Once B exists it owns calling this (or the equivalent logic)
// automatically at session end; until then, run this by hand with the workspace
// directory C's driver printed (see packages/prototype-engine's `prepare` result).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
  const get = flag => { const i = argv.indexOf(flag); return i === -1 ? undefined : argv[i + 1]; };
  const workspace = get('--workspace');
  if (!workspace) throw new Error('Usage: npm run publish-session -- --workspace <C workspace source dir> [--title "..."] [--dry-run]');
  if (!existsSync(workspace)) throw new Error(`No such directory: ${workspace}`);
  return { workspace: path.resolve(workspace), title: get('--title') || `Fork session prototype — ${new Date().toISOString().slice(0, 10)}`, dryRun: argv.includes('--dry-run') };
}

function git(args, options = {}) { return execFileSync('git', args, { encoding: 'utf8', ...options }).trim(); }
function ghCli(args) { return execFileSync('gh', args, { encoding: 'utf8' }).trim(); }

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const slug = options.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'session';
  const branch = `session/${slug}-${Date.now()}`;
  const targetDir = `sessions/${slug}`;

  console.log(`Source workspace: ${options.workspace}`);
  console.log(`Target branch:    ${branch}`);
  console.log(`Target path:      ${targetDir}/`);
  if (options.dryRun) { console.log('\n--dry-run: stopping before any git/gh mutation.'); return; }

  const repoRoot = git(['rev-parse', '--show-toplevel']);
  const startBranch = git(['branch', '--show-current']);
  const status = git(['status', '--porcelain']);
  if (status) throw new Error('Working tree has uncommitted changes. Commit or stash before publishing a session.');

  const worktreeDir = mkdtempSync(path.join(tmpdir(), 'fork-publish-'));
  try {
    git(['worktree', 'add', '-b', branch, worktreeDir, startBranch], { cwd: repoRoot });
    const destination = path.join(worktreeDir, targetDir);
    cpSync(options.workspace, destination, { recursive: true, filter: src => !/(^|\/)(node_modules|\.git|\.fork-cache)(\/|$)/.test(src) });
    git(['add', targetDir], { cwd: worktreeDir });
    const diff = git(['status', '--porcelain'], { cwd: worktreeDir });
    if (!diff) throw new Error('Nothing to publish: the workspace has no files (or only excluded ones).');
    git(['commit', '-m', `Fork session prototype: ${options.title}`], { cwd: worktreeDir });
    git(['push', '-u', 'origin', branch], { cwd: worktreeDir });
    console.log(`Pushed ${branch}.`);

    const issueUrl = ghCli(['issue', 'create', '--title', options.title, '--body',
      `Fork built this prototype during a brainstorming session and pushed it here so the output isn't lost.\n\n**Branch:** \`${branch}\`\n**Path:** \`${targetDir}/\`\n\nNext steps: review the generated code, decide whether to merge/iterate on it, then close this issue.`]);
    console.log(`Opened issue: ${issueUrl}`);
  } finally {
    try { git(['worktree', 'remove', '--force', worktreeDir], { cwd: repoRoot }); } catch { /* best-effort cleanup */ }
    rmSync(worktreeDir, { recursive: true, force: true });
  }
}

void main().catch(error => { console.error(error.message || error); process.exit(1); });
