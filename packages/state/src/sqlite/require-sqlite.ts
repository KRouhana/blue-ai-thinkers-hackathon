import { DatabaseSync } from 'node:sqlite';

const MIN = { major: 22, minor: 13 };

/** node:sqlite is unflagged from Node 22.13 / 23.4; older runtimes fail here with a clear message. */
export function assertSqliteSupported(version: string = process.version): void {
  const [major = 0, minor = 0] = version.replace(/^v/, '').split('.').map(Number);
  const ok = major > MIN.major || (major === MIN.major && minor >= MIN.minor);
  if (!ok) {
    throw new Error(`node:sqlite requires Node >= ${MIN.major}.${MIN.minor}; running ${version}. Use nvm/fnm to switch.`);
  }
}

export function openDatabase(path: string): DatabaseSync {
  assertSqliteSupported();
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return db;
}
