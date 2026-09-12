import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

/** Same default as the starter kit's agent-core/model-meta.ts. */
const DEFAULT_MODEL = 'gpt-5.6-sol';

const KEY_FOR = { openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY' } as const;

export type PlannerProvider = keyof typeof KEY_FOR;

export interface ResolvedPlannerModel {
  model: LanguageModel;
  provider: PlannerProvider;
  modelId: string;
}

function requireKey(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value || value === 'stub-replace-me') {
    throw new Error(`${name} is required for the live planner. Set it in .env, or run with FORK_PLANNER=fixture.`);
  }
  return value;
}

function resolveProvider(env: NodeJS.ProcessEnv): PlannerProvider {
  const configured = (env.MODEL_PROVIDER ?? (env.OPENROUTER_API_KEY ? 'openrouter' : 'openai')).trim().toLowerCase();
  if (configured !== 'openai' && configured !== 'openrouter') {
    throw new Error(`Unsupported MODEL_PROVIDER '${configured}'. Track B's planner supports openai or openrouter.`);
  }
  return configured;
}

/** Mirrors the starter kit's env contract so one .env configures both the kit and Fork. */
export function resolvePlannerModel(env: NodeJS.ProcessEnv = process.env): ResolvedPlannerModel {
  const provider = resolveProvider(env);
  const raw = (env.MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const apiKey = requireKey(env, KEY_FOR[provider]);

  if (provider === 'openai') {
    const modelId = raw.replace(/^openai[:/]/i, '');
    return { model: createOpenAI({ apiKey })(modelId), provider, modelId };
  }

  // OpenRouter needs a publisher/model slug and its OpenAI-compatible chat endpoint.
  const modelId = raw.includes('/') ? raw : `openai/${raw.replace(/^openai:/i, '')}`;
  const openRouter = createOpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' });
  return { model: openRouter.chat(modelId), provider, modelId };
}
