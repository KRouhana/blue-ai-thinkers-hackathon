import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// npm runs workspace scripts with cwd = apps/api, so relative FORK_* paths resolve from the repo root.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const fromRoot = (path: string): string => resolve(ROOT, path);

const schema = z.object({
  FORK_API_HOST: z.string().default('127.0.0.1'),
  FORK_API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  FORK_API_TOKEN: z.string().optional(),
  FORK_ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://127.0.0.1:3000'),
  FORK_DB_PATH: z.string().default('./.data/fork.sqlite'),
  FORK_PLANNER: z.enum(['fixture', 'live']).default('fixture'),
  FORK_ENGINE: z.enum(['fake', 'live']).default('fake'),
  FORK_SETTLE_MS: z.coerce.number().int().min(0).max(10000).default(1200),
  FORK_PROJECTS_FILE: z.string().default('./fork.projects.json'),
  FORK_COMPANY_DOCS_DIR: z.string().default('./fixtures/company'),
});

export interface ApiEnv {
  host: string;
  port: number;
  token: string;
  generatedToken: boolean;
  allowedOrigins: string[];
  dbPath: string;
  planner: 'fixture' | 'live';
  engine: 'fake' | 'live';
  settleMs: number;
  projectsFile: string;
  companyDocsDir: string;
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment: ${detail}`);
  }
  const values = parsed.data;
  const supplied = values.FORK_API_TOKEN?.trim();
  return {
    host: values.FORK_API_HOST,
    port: values.FORK_API_PORT,
    token: supplied || randomBytes(24).toString('base64url'),
    generatedToken: !supplied,
    allowedOrigins: values.FORK_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
    dbPath: values.FORK_DB_PATH === ':memory:' ? values.FORK_DB_PATH : fromRoot(values.FORK_DB_PATH),
    planner: values.FORK_PLANNER,
    engine: values.FORK_ENGINE,
    settleMs: values.FORK_SETTLE_MS,
    projectsFile: fromRoot(values.FORK_PROJECTS_FILE),
    companyDocsDir: fromRoot(values.FORK_COMPANY_DOCS_DIR),
  };
}
