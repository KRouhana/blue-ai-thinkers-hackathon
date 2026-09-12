import { createHash, randomUUID } from 'node:crypto';
import { readdir, lstat, readFile, writeFile, mkdir, rename, copyFile, chmod, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { error, type Manifest } from './types.js';

const excluded = new Set(['node_modules', '.git', '.codex', '.agents', '.fork-cache', 'dist', 'build', '.next', 'coverage']);
const secret = /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pypirc|credentials.*|auth\.json|id_rsa.*|id_ed25519.*)$|\.(?:pem|key|p12|pfx)$/i;
const credentialContent = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{25,}|xox[baprs]-[A-Za-z0-9-]{20,})/;
export const digest = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const id = (): string => randomUUID();
export function validId(value: string): void { if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value)) throw error('INVALID_ID', 'IDs must contain only letters, numbers, underscores, and hyphens.'); }
export function within(root: string, relative: string): string {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => p === '..' || p === '.')) throw error('INVALID_PATH', 'Expected a workspace-relative file path.');
  const result = path.resolve(root, relative);
  if (!result.startsWith(root + path.sep)) throw error('INVALID_PATH', 'Path escapes workspace.');
  return result;
}
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${id()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, file);
}
export async function readJson<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, 'utf8')) as T; }
export async function scan(root: string, onboarding = false): Promise<{ manifest: Manifest; fingerprint: string; excluded: string[] }> {
  const manifest: Manifest = {};
  const skipped: string[] = [];
  let bytes = 0;
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + entry.name;
      if (excluded.has(entry.name)) { skipped.push(relative); continue; }
      if (secret.test(entry.name)) {
        if (!onboarding) throw error('SENSITIVE_FILE', `Unexpected sensitive file: ${relative}`);
        skipped.push(relative); continue;
      }
      const full = path.join(dir, entry.name);
      const info = await lstat(full);
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw error('UNSUPPORTED_LAYOUT', `Symlinks and special files require explicit onboarding: ${relative}`);
      if (info.isDirectory()) await walk(full, relative + '/');
      else {
        bytes += info.size;
        if (info.size > 2_000_000 || bytes > 40_000_000 || Object.keys(manifest).length >= 3000) throw error('PROJECT_TOO_LARGE', 'Initial support is limited to 3000 source files, 2 MB per file, and 40 MB total.');
        const content = await readFile(full);
        if (credentialContent.test(content.toString('utf8'))) {
          if (!onboarding) throw error('SENSITIVE_FILE', `Credential-like content detected in ${relative}.`);
          skipped.push(relative); continue;
        }
        manifest[relative] = { hash: createHash('sha256').update(content).digest('hex'), mode: info.mode & 0o777 };
      }
    }
  }
  await walk(root, '');
  return { manifest, fingerprint: digest(manifest), excluded: skipped };
}
export async function copyManifest(from: string, to: string, manifest: Manifest): Promise<void> {
  await mkdir(to, { recursive: true, mode: 0o700 });
  for (const [relative, info] of Object.entries(manifest)) {
    const destination = within(to, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(within(from, relative), destination);
    await chmod(destination, info.mode);
  }
}
export async function restore(from: string, to: string, manifest: Manifest): Promise<void> {
  for (const entry of await readdir(to)) {
    if (entry !== 'node_modules' && entry !== '.fork-cache') await rm(path.join(to, entry), { recursive: true, force: true });
  }
  await copyManifest(from, to, manifest);
  if ((await scan(to)).fingerprint !== digest(manifest)) throw error('RESTORE_FAILED', 'Restored files do not match their checkpoint.');
}
export function changedFiles(before: Manifest, after: Manifest): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => before[p]?.hash !== after[p]?.hash || before[p]?.mode !== after[p]?.mode).sort();
}
export async function canonical(directory: string): Promise<string> { return realpath(path.resolve(directory)); }
