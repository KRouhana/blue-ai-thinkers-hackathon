import { z } from 'zod';

export const idSchema = z.string().min(1).max(200);
export const isoTimeSchema = z.iso.datetime({ offset: true });
export const sizeTokenSchema = z.enum(['sm', 'md', 'lg', 'xl']);
export const colorTokenSchema = z.enum(['neutral', 'blue', 'red', 'green', 'amber']);
export const radiusTokenSchema = z.enum(['none', 'sm', 'md', 'pill']);
export const editablePropertySchema = z.enum(['size', 'background', 'label', 'radius', 'visible']);

export const revisionSchema = z.strictObject({
  source: z.number().int().min(0),
  config: z.number().int().min(0),
});

const WINDOWS_DRIVE = /^[a-zA-Z]:/;

/** Workspace-relative, forward-slash only, no traversal. Never an unrestricted host path. */
export function isWorkspaceRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || WINDOWS_DRIVE.test(path)) return false;
  return !path.split('/').some((segment) => segment === '..');
}

export const workspacePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(isWorkspaceRelativePath, { message: 'path must be workspace-relative with no traversal' });

export const sourceRefSchema = z.strictObject({
  kind: z.enum(['repo', 'document']),
  path: workspacePathSchema,
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  fingerprint: z.string().min(1).max(200),
  excerpt: z.string().max(2000).optional(),
});
