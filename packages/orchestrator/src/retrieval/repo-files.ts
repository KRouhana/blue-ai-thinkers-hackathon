import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { RepoMap } from '@fork/contracts';
import { isWorkspaceRelativePath } from '@fork/contracts';

/** Never read credential-shaped files, even if a repo map lists one. */
const SECRETISH = /(^|\/)\.env($|\.)|\.env$|\.pem$|\.key$|\.p12$|(^|\/)(secrets?|credentials)\b/i;

function candidatePaths(repoMap: RepoMap, route: string | null): string[] {
  const routeSources = route ? repoMap.routes.find((entry) => entry.route === route)?.sources ?? [] : [];
  const paths = [...routeSources, ...repoMap.relevantSources].map((source) => source.path);
  return [...new Set(paths)].filter((path) => isWorkspaceRelativePath(path) && !SECRETISH.test(path));
}

function insideWorkspace(root: string, path: string): string | null {
  const workspace = resolve(root);
  const target = resolve(workspace, path);
  return target === workspace || target.startsWith(workspace + sep) ? target : null;
}

/**
 * Reads a few small, allowlisted excerpts on demand. The whole repository is never loaded,
 * and a path that escapes the workspace is dropped rather than resolved.
 */
export async function readRepoExcerpts(
  workspaceRoot: string | null,
  repoMap: RepoMap | null,
  route: string | null,
  maxFiles: number,
  maxLines: number,
): Promise<Array<{ path: string; excerpt: string }>> {
  if (!workspaceRoot || !repoMap || maxFiles <= 0) return [];
  const selected = candidatePaths(repoMap, route).slice(0, maxFiles);
  const excerpts = await Promise.all(selected.map(async (path) => {
    const absolute = insideWorkspace(workspaceRoot, path);
    if (!absolute) return null;
    try {
      const contents = await readFile(absolute, 'utf8');
      return { path, excerpt: contents.split('\n').slice(0, maxLines).join('\n') };
    } catch {
      return null;
    }
  }));
  return excerpts.filter((excerpt): excerpt is { path: string; excerpt: string } => excerpt !== null);
}
