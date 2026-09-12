import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { access, readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { error, safeText } from './types.js';

export const packageRoot = fileURLToPath(new URL('../../../../', import.meta.url));
export const assetsRoot = path.join(packageRoot, 'dist/assets');
export const builtRoot = path.join(packageRoot, 'dist');
export const require = createRequire(import.meta.url);
export function cleanEnv(temp: string): Record<string, string> {
  return { PATH: `${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`, LANG: 'en_US.UTF-8', TMPDIR: temp, CI: '1', NO_COLOR: '1' };
}
export async function findCodex(override?: string): Promise<string> {
  if (override) { await access(override); return realpath(override); }
  const platform = `${process.platform}-${process.arch}`;
  const triple = process.platform === 'darwin' ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin` : `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl`;
  const pkg = path.dirname(require.resolve(`@openai/codex-${platform}/package.json`));
  return path.join(pkg, 'vendor', triple, 'bin', 'codex');
}
export async function readableRuntimePaths(dependencyRoot: string): Promise<string[]> {
  const paths = [process.execPath, path.dirname(path.dirname(process.execPath)), builtRoot, path.join(packageRoot, 'node_modules'), dependencyRoot];
  // Homebrew Node links its runtime libraries from versioned Cellar packages.
  try { paths.push(await realpath('/opt/homebrew/Cellar'), '/opt/homebrew/opt'); } catch { /* nvm/system Node does not need Homebrew. */ }
  try { paths.push(await realpath('/opt/homebrew/etc/openssl@3/openssl.cnf')); } catch { /* Optional Homebrew OpenSSL runtime configuration. */ }
  return [...new Set(await Promise.all(paths.map(p => realpath(p))))];
}
export function profileOverride(source: string, readable: string[]): string {
  const entries: Record<string, string> = { ':minimal': 'read', [source]: 'write' };
  for (const p of readable) entries[p] = 'read';
  entries[path.join(source, 'node_modules')] = 'read';
  entries[path.join(source, 'package.json')] = 'read';
  for (const name of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', '.codex', '.agents', '.git']) entries[path.join(source, name)] = 'read';
  return 'permissions.fork_worker.filesystem={' + Object.entries(entries).map(([k, v]) => `${JSON.stringify(k)}=${JSON.stringify(v)}`).join(',') + '}';
}

export function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
function groupAlive(pid: number): boolean {
  try { process.kill(-pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function terminate(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; }
  for (let i = 0; i < 20 && groupAlive(child.pid); i++) await delay(100);
  if (groupAlive(child.pid)) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; }
    for (let i = 0; i < 20 && groupAlive(child.pid); i++) await delay(100);
  }
  if (groupAlive(child.pid)) throw error('PROCESS_STILL_RUNNING', 'Could not prove worker process group stopped. Workspace must remain blocked.');
}
export function childEntry(relative: string): string { return path.join(builtRoot, relative); }
export function spawnWorker(file: string, cwd: string, temp: string): ChildProcess {
  return spawn(process.execPath, [file], { cwd, env: cleanEnv(temp), detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
}

/** Seatbelt also contains the generated Vite code; it may listen only on its assigned loopback port. */
export async function spawnPreview(args: { source: string; meta: string; temp: string; readable: string[]; port: number; dependencyRoot: string; collectorPath?: string }): Promise<ChildProcess> {
  if (process.platform !== 'darwin') throw error('UNSUPPORTED_HOST', 'The initial preview isolation profile supports macOS only.');
  const quote = (s: string) => JSON.stringify(s);
  const profile = `(version 1)
(deny default)
(allow process-exec process-fork sysctl-read mach-lookup)
(allow signal (target self))
(allow file-read-metadata)
(allow file-read* (literal "/"))
(allow file-read* (subpath "/System") (subpath "/usr") (subpath "/bin") (subpath "/sbin") (subpath "/dev") (subpath "/private/etc") (subpath "/Library/Apple"))
(allow file-read* ${[args.source, args.meta, ...(args.collectorPath ? [args.collectorPath] : []), ...args.readable].map(p => `(subpath ${quote(p)})`).join(' ')})
(allow file-write* (subpath ${quote(path.join(args.source, '.fork-cache'))}) (subpath ${quote(args.temp)}) (literal "/dev/null"))
(allow network-bind (local ip "localhost:${args.port}"))
(allow network-inbound (local ip "localhost:${args.port}"))
(allow network-outbound (remote ip "localhost:${args.port}"))
`;
  await mkdir(args.temp, { recursive: true });
  const policyPath = path.join(args.temp, 'preview.sb');
  await writeFile(policyPath, profile, { mode: 0o600 });
  return spawn('/usr/bin/sandbox-exec', ['-f', policyPath, process.execPath, childEntry('packages/prototype-engine/src/preview-server.js'), JSON.stringify(args)], {
    cwd: args.source, env: cleanEnv(args.temp), detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
}

export async function sandboxPreflight(codex: string, source: string, codexHome: string, readable: string[]): Promise<void> {
  const probe = spawn(codex, ['sandbox', '-C', source, '-P', 'fork_worker', '-c', profileOverride(source, readable), '-c', 'permissions.fork_worker.network.enabled=false', process.execPath, '-e',
    'const fs=require("fs");fs.writeFileSync(".fork-cache/probe","ok");try{fs.readFileSync(process.argv[1]);process.exit(23)}catch(e){if(e.code!=="EACCES"&&e.code!=="EPERM")process.exit(24)}', path.join(codexHome, 'auth.json')],
    { cwd: source, env: { ...cleanEnv(path.join(source, '.fork-cache')), HOME: os.homedir(), CODEX_HOME: codexHome }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let output = '';
  probe.stderr?.on('data', b => { output = (output + b).slice(-5000); });
  const timer = setTimeout(() => { void terminate(probe); }, 15_000);
  try {
    const [code] = await once(probe, 'exit');
    if (code !== 0) throw error('SANDBOX_UNAVAILABLE', `Worker isolation preflight failed (${code}): ${safeText(output)}`);
  } finally { clearTimeout(timer); await terminate(probe); }
}
