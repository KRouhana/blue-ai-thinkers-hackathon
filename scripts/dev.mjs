import { spawn } from 'node:child_process';

const mode = process.env.FORK_MODE || 'fixture';
if (!['fixture', 'live'].includes(mode)) throw new Error('FORK_MODE must be fixture or live.');
const commands = [{ label: 'meeting', args: ['run', 'dev', '--workspace', 'meeting'] }];
if (mode === 'fixture') commands.push({ label: 'fixture preview', preview: true, args: ['exec', '--workspace', 'meeting', '--', 'vite', 'fixtures', '--host', '127.0.0.1', '--port', '4173', '--strictPort'] });
else {
  for (const [key, label] of [['FORK_API_WORKSPACE', 'session API'], ['FORK_PREVIEW_WORKSPACE', 'prototype preview']]) {
    const workspace = process.env[key];
    if (workspace) {
      if (!/^(@[\w.-]+\/)?[\w.-]+$/.test(workspace)) throw new Error(`${key} must be an npm workspace name.`);
      commands.push({ label, preview: key === 'FORK_PREVIEW_WORKSPACE', args: ['run', 'dev', '--workspace', workspace] });
    } else console.log(`[fork] ${label}: start your teammate’s service separately, or set ${key}.`);
  }
}
if (process.env.FORK_SLACK_ENABLED === 'true') commands.push({ label: 'Slack', args: ['run', 'dev', '--workspace', 'channel'] });
else console.log('[fork] Slack listener disabled. Set FORK_SLACK_ENABLED=true after managed Channels setup.');
console.log(`[fork] ${mode.toUpperCase()} mode · meeting http://127.0.0.1:3000`);
if (mode === 'fixture') console.log('[fork] Prepared fixture events only. No live microphone, Slack meeting, model, or Codex connection.');

const children = [];
const previewEnvironment = Object.fromEntries(['PATH', 'TMPDIR', 'TEMP', 'TMP', 'TERM', 'LANG', 'NODE_ENV'].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
let closing = false;
function shutdown(code) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  }
  const deadline = setTimeout(() => {
    for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  }, 3000);
  deadline.unref();
}
for (const command of commands) {
  if (closing) break;
  console.log(`[fork] Starting ${command.label}.`);
  // Generated previews must not inherit API tokens or managed Channel credentials.
  const child = spawn('npm', command.args, { stdio: 'inherit', env: command.preview ? previewEnvironment : process.env, detached: true });
  children.push(child);
  child.once('error', error => { console.error(`[fork] ${command.label} failed to start: ${error.message}`); shutdown(1); });
  child.once('exit', (code, signal) => {
    if (closing) return;
    console.error(`[fork] ${command.label} exited (${signal || code}); stopping sibling processes.`);
    shutdown(code && code > 0 ? code : 1);
  });
}
process.once('SIGINT', () => shutdown(130));
process.once('SIGTERM', () => shutdown(143));
