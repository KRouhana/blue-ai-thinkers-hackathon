import { generateText, Output } from 'ai';
import { silentLogger, type Logger } from '../logger';
import { holdOutput, plannerOutputSchema, type PlannerOutput } from './output-schema';
import type { Planner, PlanningContext } from './planner';
import { renderUserPrompt, SYSTEM_PROMPT } from './prompt';
import { resolvePlannerModel } from './model';

export type StructuredGenerate = (input: { system: string; prompt: string }) => Promise<unknown>;

export interface LlmPlannerOptions {
  generate: StructuredGenerate;
  logger?: Logger;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); },
    );
  });
}

/**
 * The single structured planner service. Every caller (transcript stream, Slack handler) uses it;
 * there is no second planner and no persona swarm. It never throws: an unusable model response
 * becomes a `hold`, so the meeting continues quietly instead of erroring.
 */
export class LlmPlanner implements Planner {
  readonly label = 'live' as const;

  private readonly generate: StructuredGenerate;
  private readonly logger: Logger;
  private readonly timeoutMs: number;

  constructor(options: LlmPlannerOptions) {
    this.generate = options.generate;
    this.logger = options.logger ?? silentLogger;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env, logger: Logger = silentLogger): LlmPlanner {
    const { model, provider, modelId } = resolvePlannerModel(env);
    logger.info('live planner configured', { provider, modelId });
    const generate: StructuredGenerate = async ({ system, prompt }) => {
      const result = await generateText({ model, system, prompt, output: Output.object({ schema: plannerOutputSchema }) });
      return result.output;
    };
    return new LlmPlanner({ generate, logger });
  }

  async plan(context: PlanningContext): Promise<PlannerOutput> {
    try {
      const raw = await withTimeout(this.generate({ system: SYSTEM_PROMPT, prompt: renderUserPrompt(context) }), this.timeoutMs);
      const parsed = plannerOutputSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
      const issue = parsed.error.issues[0];
      this.logger.warn('planner output invalid', { path: issue?.path.join('.'), message: issue?.message });
      return holdOutput(`planner output invalid: ${issue?.message ?? 'unrecognised shape'}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('planner unavailable', { error: message });
      return holdOutput(`planner unavailable: ${message}`);
    }
  }
}
