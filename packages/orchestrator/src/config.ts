import { z } from 'zod';

export const configSchema = z.strictObject({
  settleMs: z.number().int().min(0).max(10000),
  transcriptWindowTurns: z.number().int().min(1).max(50),
  contextLookbackMs: z.number().int().min(0).max(60000),
  maxBriefChars: z.number().int().min(1).max(600),
  maxLabelChars: z.number().int().min(1).max(60),
  maxRelevantSources: z.number().int().min(0).max(8),
  maxCompanyExcerpts: z.number().int().min(0).max(5),
  maxRepoFileLines: z.number().int().min(1).max(400),
  snapshotExperiments: z.number().int().min(1).max(100),
  allowedOperations: z.array(z.enum(['preview_patch', 'prototype_change', 'undo', 'pause', 'clarify'])),
  stopBehavior: z.enum(['cancel', 'drain']),
});

export type OrchestratorConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: OrchestratorConfig = {
  settleMs: 1200,
  transcriptWindowTurns: 12,
  contextLookbackMs: 15000,
  maxBriefChars: 600,
  maxLabelChars: 60,
  maxRelevantSources: 8,
  maxCompanyExcerpts: 2,
  maxRepoFileLines: 120,
  snapshotExperiments: 20,
  allowedOperations: ['preview_patch', 'prototype_change', 'undo', 'pause', 'clarify'],
  stopBehavior: 'cancel',
};

export function resolveConfig(partial: Partial<OrchestratorConfig>): OrchestratorConfig {
  const result = configSchema.safeParse({ ...DEFAULT_CONFIG, ...partial });
  if (!result.success) {
    const detail = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid orchestrator config: ${detail}`);
  }
  return result.data;
}
