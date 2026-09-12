import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { ProjectConfig } from '@fork/orchestrator';
import { z } from 'zod';

const projectSchema = z.strictObject({
  id: z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lowercase, digits, and single hyphens'),
  label: z.string().min(1).max(200),
  mode: z.enum(['blank_template', 'existing_repo']),
  /** An absolute host path chosen during setup, or null for a prepared/fixture workspace. */
  workspaceRoot: z.string().min(1).nullable(),
});

const fileSchema = z.strictObject({ projects: z.array(projectSchema).min(1).max(50) });

/**
 * The project allowlist is server configuration, not a runtime argument: nothing a browser,
 * transcript, or model supplies can widen it.
 */
export function loadProjects(path: string): ProjectConfig[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read the project allowlist at ${path}: ${detail}`);
  }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid project allowlist at ${path}: ${detail}`);
  }
  for (const project of parsed.data.projects) {
    if (project.workspaceRoot !== null && !isAbsolute(project.workspaceRoot)) {
      throw new Error(`Project '${project.id}' must use an absolute workspaceRoot or null, got '${project.workspaceRoot}'`);
    }
  }
  const ids = new Set(parsed.data.projects.map((project) => project.id));
  if (ids.size !== parsed.data.projects.length) throw new Error(`Duplicate project ids in ${path}`);
  return parsed.data.projects;
}
